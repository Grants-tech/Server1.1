const { getCandles } = require('./dataProvider');
const { analyzeTimeframe } = require('./analyzer');
const { buildConfluence } = require('./confluence');
const cache = require('./cache');
const { maybeNotify } = require('./signalNotifier');
const { maybeNotifyBounce } = require('./bounceNotifier');
const { getActiveSymbols } = require('./symbols');

/**
 * Runs the full analysis pipeline for a single symbol: fetch candles for
 * all 3 timeframes, analyze each, build the confluence view, cache it,
 * and check both notifier gates. Errors are caught by the caller
 * (runAllAnalyses) so one symbol failing (e.g. a bad API symbol string,
 * a transient data-provider error) never takes down the others.
 */
async function runAnalysisForSymbol(symbolConfig) {
  const { slug, apiSymbol, label, decimals } = symbolConfig;
  const timeframes = ['15m', '1h', '1d'];
  const candleSets = await Promise.all(
    timeframes.map((tf) => getCandles(apiSymbol, tf, 300))
  );

  const perTimeframe = {};
  timeframes.forEach((tf, i) => {
    perTimeframe[tf] = analyzeTimeframe(tf, candleSets[i], decimals);
  });

  const result = buildConfluence(perTimeframe, label, decimals);
  cache.set(slug, result);

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
