const { getCandles } = require('./dataProvider');
const { analyzeTimeframe } = require('./analyzer');
const { buildConfluence } = require('./confluence');
const cache = require('./cache');
const { maybeNotify } = require('./signalNotifier');

async function runAnalysis() {
  const timeframes = ['15m', '1h', '1d'];
  const candleSets = await Promise.all(
    timeframes.map((tf) => getCandles(tf, tf === '1d' ? 300 : 300))
  );

  const perTimeframe = {};
  timeframes.forEach((tf, i) => {
    perTimeframe[tf] = analyzeTimeframe(tf, candleSets[i]);
  });

  const result = buildConfluence(perTimeframe);
  cache.set(result);

  try {
    const notifyResult = await maybeNotify(result);
    if (notifyResult.sent) {
      console.log('[signal] High-confidence signal emailed.');
    }
  } catch (err) {
    // Never let an email failure break the analysis cycle.
    console.error('[signal] Email notify failed:', err.message);
  }

  return result;
}

module.exports = { runAnalysis };
