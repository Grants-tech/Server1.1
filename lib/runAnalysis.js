const { getCandles } = require('./dataProvider');
const { analyzeTimeframe } = require('./analyzer');
const { buildConfluence } = require('./confluence');
const cache = require('./cache');
const { maybeNotify } = require('./signalNotifier');
const { maybeNotifyBounce } = require('./bounceNotifier');
const { getActiveSymbols } = require('./symbols');
const { checkAndCloseOpenSignal, logSignal, getOpenSignal } = require('./outcomeStore');

/**
 * Runs the full analysis pipeline for a single symbol: fetch candles for
 * all 3 timeframes, analyze each, build the confluence view, cache it,
 * check both notifier gates, and update the outcome-tracking store.
 * Errors are caught by the caller (runAllAnalyses) so one symbol failing
 * never takes down the others.
 */
async function runAnalysisForSymbol(symbolConfig) {
  const { slug, apiSymbol, label, decimals } = symbolConfig;
  const timeframes = ['15m', '1h', '1d'];
  const candleSets = await Promise.all(
    timeframes.map((tf) => getCandles(apiSymbol, tf, 300))
  );
  const m15Candles = candleSets[0];

  const perTimeframe = {};
  timeframes.forEach((tf, i) => {
    perTimeframe[tf] = analyzeTimeframe(tf, candleSets[i], decimals);
  });

  const result = buildConfluence(perTimeframe, label, decimals);
  cache.set(slug, result);

  // Outcome tracking: first check if an already-open logged trade for
  // this symbol just hit its SL or a TP on these fresh candles, then
  // (if nothing is open) log this cycle's setup if it's actionable.
  try {
    const closed = checkAndCloseOpenSignal(slug, m15Candles);
    if (closed) {
      console.log(`[outcome] ${label} closed: ${closed.outcome} (${closed.note}).`);
    }
    if ((result.risk.action === 'enter' || result.risk.action === 'caution') && !getOpenSignal(slug)) {
      const logged = logSignal({
        slug,
        symbolLabel: label,
        direction: result.tradeSetup.direction,
        tier: result.conviction.tier,
        score: result.conviction.score,
        entryZone: result.tradeSetup.entryZone,
        stopLoss: result.tradeSetup.stopLoss,
        takeProfits: result.tradeSetup.takeProfits,
        entryTime: result.generatedAt,
      });
      if (logged) console.log(`[outcome] ${label} logged new open trade (${logged.tier}, score ${logged.scoreAtEntry}).`);
    }
  } catch (err) {
    console.error(`[outcome] Tracking failed for ${label}:`, err.message);
  }

  try {
    const notifyResult = await maybeNotify(slug, result);
    if (notifyResult.sent) {
      console.log(`[signal] High-confidence trend-following signal emailed for ${label}.`);
    }
  } catch (err) {
    console.error(`[signal] Email notify failed for ${label}:`, err.message);
  }

  try {
    const bounceNotifyResult = await maybeNotifyBounce(slug, result.bounceSignal, result.price, label);
    if (bounceNotifyResult.sent) {
      console.log(`[bounce] Counter-trend bounce signal emailed for ${label}.`);
    }
  } catch (err) {
    console.error(`[bounce] Email notify failed for ${label}:`, err.message);
  }

  return result;
}

/**
 * Runs analysis for every active symbol (see lib/symbols.js), one at a
 * time. Sequential rather than parallel to stay comfortably under Twelve
 * Data's 8 requests/minute free-tier rate limit (4 symbols x 3 timeframes
 * = 12 requests per full cycle).
 */
async function runAllAnalyses() {
  const symbols = getActiveSymbols();
  const results = {};
  for (const symbolConfig of symbols) {
    try {
      results[symbolConfig.slug] = await runAnalysisForSymbol(symbolConfig);
    } catch (err) {
      console.error(`[analysis] Failed for ${symbolConfig.label}:`, err.message);
    }
  }
  return results;
}

// Backwards-compatible single-symbol export (defaults to XAUUSD) — kept so
// nothing else has to change if only one symbol is ever configured.
async function runAnalysis() {
  const symbols = getActiveSymbols();
  const xau = symbols.find((s) => s.slug === 'xauusd') || symbols[0];
  return runAnalysisForSymbol(xau);
}

module.exports = { runAnalysisForSymbol, runAllAnalyses, runAnalysis };