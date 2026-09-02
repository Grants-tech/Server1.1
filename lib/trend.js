/**
 * lib/trend.js
 *
 * Implements the price-structure side of classical (Dow Theory) analysis:
 *  - swing high / swing low detection (fractal method)
 *  - trend classification from the sequence of swings
 *      uptrend   = higher highs (HH) + higher lows (HL)
 *      downtrend = lower highs (LH) + lower lows (LL)
 *      range     = mixed / no clear sequence
 *  - support & resistance zones derived from clustering swing points
 */

function findSwings(candles, strength = 2) {
  const swings = [];
  for (let i = strength; i < candles.length - strength; i++) {
    const window = candles.slice(i - strength, i + strength + 1);
    const high = candles[i].high;
    const low = candles[i].low;
    const isSwingHigh = window.every((c) => c.high <= high);
    const isSwingLow = window.every((c) => c.low >= low);
    if (isSwingHigh) swings.push({ index: i, type: 'high', price: high, time: candles[i].time });
    if (isSwingLow) swings.push({ index: i, type: 'low', price: low, time: candles[i].time });
  }
  return swings;
}

function classifyTrend(swings) {
  const highs = swings.filter((s) => s.type === 'high').slice(-3);
  const lows = swings.filter((s) => s.type === 'low').slice(-3);

  let higherHighs = false;
  let higherLows = false;
  let lowerHighs = false;
  let lowerLows = false;

  if (highs.length >= 2) {
    higherHighs = highs[highs.length - 1].price > highs[highs.length - 2].price;
    lowerHighs = highs[highs.length - 1].price < highs[highs.length - 2].price;
  }
  if (lows.length >= 2) {
    higherLows = lows[lows.length - 1].price > lows[lows.length - 2].price;
    lowerLows = lows[lows.length - 1].price < lows[lows.length - 2].price;
  }

  let trend = 'range';
  if (higherHighs && higherLows) trend = 'uptrend';
  else if (lowerHighs && lowerLows) trend = 'downtrend';
  else if (higherHighs || higherLows) trend = 'weak_uptrend';
  else if (lowerHighs || lowerLows) trend = 'weak_downtrend';

  return {
    trend,
    lastSwingHighs: highs,
    lastSwingLows: lows,
  };
}

/**
 * Cluster swing points into support/resistance zones. Points within
 * `tolerancePct` of each other are merged into a single zone, whose
 * strength = number of touches.
 */
function findSupportResistance(swings, currentPrice, tolerancePct = 0.0015) {
  const zones = [];
  const sorted = [...swings].sort((a, b) => a.price - b.price);

  for (const s of sorted) {
    const existing = zones.find(
      (z) => Math.abs(z.price - s.price) / s.price <= tolerancePct
    );
    if (existing) {
      existing.touches += 1;
      existing.price = (existing.price * (existing.touches - 1) + s.price) / existing.touches;
      existing.types.add(s.type);
    } else {
      zones.push({ price: s.price, touches: 1, types: new Set([s.type]) });
    }
  }

  const withSide = zones.map((z) => ({
    price: Number(z.price.toFixed(3)),
    touches: z.touches,
    side: z.price >= currentPrice ? 'resistance' : 'support',
  }));

  const resistance = withSide
    .filter((z) => z.side === 'resistance')
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);
  const support = withSide
    .filter((z) => z.side === 'support')
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  return { support, resistance };
}

module.exports = { findSwings, classifyTrend, findSupportResistance };
