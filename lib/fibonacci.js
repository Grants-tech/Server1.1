/**
 * lib/fibonacci.js
 * Retracement & extension levels drawn off the most recent significant
 * swing (highest high / lowest low over the lookback window).
 */

const RETRACEMENT_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.786];
const EXTENSION_RATIOS = [1.272, 1.618, 2.0];

function computeFibLevels(candles, lookback = 60) {
  const slice = candles.slice(-lookback);
  let hi = -Infinity;
  let lo = Infinity;
  let hiIdx = -1;
  let loIdx = -1;
  slice.forEach((c, i) => {
    if (c.high > hi) {
      hi = c.high;
      hiIdx = i;
    }
    if (c.low < lo) {
      lo = c.low;
      loIdx = i;
    }
  });

  const uptrendSwing = hiIdx > loIdx; // low came first -> measuring an up-move
  const diff = hi - lo;

  const retracements = RETRACEMENT_RATIOS.map((r) => ({
    ratio: r,
    price: uptrendSwing ? hi - diff * r : lo + diff * r,
  }));

  const extensions = EXTENSION_RATIOS.map((r) => ({
    ratio: r,
    price: uptrendSwing ? hi - diff * r : lo + diff * r,
  }));

  return {
    swingHigh: hi,
    swingLow: lo,
    direction: uptrendSwing ? 'up' : 'down',
    retracements: retracements.map((r) => ({ ...r, price: Number(r.price.toFixed(3)) })),
    extensions: extensions.map((r) => ({ ...r, price: Number(r.price.toFixed(3)) })),
  };
}

module.exports = { computeFibLevels };
