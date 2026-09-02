/**
 * lib/patterns.js
 *
 * Lightweight candlestick pattern recognition on the most recent bars.
 * Covers the reversal/continuation patterns most commonly cited in
 * classical TA: engulfing, doji, hammer/hanging man, shooting star/
 * inverted hammer, morning/evening star.
 */

function body(c) {
  return Math.abs(c.close - c.open);
}
function range(c) {
  return c.high - c.low || 1e-9;
}
function upperWick(c) {
  return c.high - Math.max(c.open, c.close);
}
function lowerWick(c) {
  return Math.min(c.open, c.close) - c.low;
}
function isBullish(c) {
  return c.close > c.open;
}
function isBearish(c) {
  return c.close < c.open;
}

function detectPatterns(candles) {
  const found = [];
  if (candles.length < 3) return found;

  const n = candles.length - 1;
  const c0 = candles[n]; // latest
  const c1 = candles[n - 1];
  const c2 = candles[n - 2];

  // Doji: body is a tiny fraction of the range
  if (body(c0) / range(c0) < 0.1) {
    found.push({ name: 'doji', bias: 'neutral', bar: 'last' });
  }

  // Bullish / Bearish engulfing
  if (isBearish(c1) && isBullish(c0) && c0.close >= c1.open && c0.open <= c1.close) {
    found.push({ name: 'bullish_engulfing', bias: 'bullish', bar: 'last_2' });
  }
  if (isBullish(c1) && isBearish(c0) && c0.open >= c1.close && c0.close <= c1.open) {
    found.push({ name: 'bearish_engulfing', bias: 'bearish', bar: 'last_2' });
  }

  // Hammer (small body near top, long lower wick) / Shooting star (small body near bottom, long upper wick)
  if (lowerWick(c0) > body(c0) * 2 && upperWick(c0) < body(c0)) {
    found.push({ name: 'hammer', bias: 'bullish', bar: 'last' });
  }
  if (upperWick(c0) > body(c0) * 2 && lowerWick(c0) < body(c0)) {
    found.push({ name: 'shooting_star', bias: 'bearish', bar: 'last' });
  }

  // Morning star: bearish, small-body (indecision), strong bullish closing above midpoint of first candle
  if (
    isBearish(c2) &&
    body(c1) / range(c1) < 0.4 &&
    isBullish(c0) &&
    c0.close > (c2.open + c2.close) / 2
  ) {
    found.push({ name: 'morning_star', bias: 'bullish', bar: 'last_3' });
  }
  // Evening star: mirror
  if (
    isBullish(c2) &&
    body(c1) / range(c1) < 0.4 &&
    isBearish(c0) &&
    c0.close < (c2.open + c2.close) / 2
  ) {
    found.push({ name: 'evening_star', bias: 'bearish', bar: 'last_3' });
  }

  return found;
}

module.exports = { detectPatterns };
