/**
 * lib/bounceSignal.js
 *
 * A SEPARATE, higher-risk signal category from the main trend-following
 * tradeSetup in confluence.js. This one is designed to catch exactly the
 * kind of trade that the strict trend-alignment gate deliberately misses:
 * a sharp reversal off a well-tested support/resistance level, even when
 * it goes AGAINST the higher-timeframe (1H/1D) trend.
 *
 * It requires BOTH of:
 *  - price sitting right at a "key" level (daily or 1H support/resistance,
 *    weighted toward levels with more historical touches)
 *  - a concrete 15m reversal trigger: a bullish/bearish candlestick
 *    pattern AND supporting momentum (RSI extreme + MACD turning)
 *
 * This is intentionally still fairly strict (both conditions, not just
 * one) — it's meant to reduce false positives, not to fire on every
 * approach to a level. It is explicitly flagged as counter-trend /
 * higher-risk in its output so it's never confused with the primary,
 * trend-aligned tradeSetup.
 */

function nearestLevel(levels, price, maxDistance) {
  let best = null;
  let bestDist = Infinity;
  for (const lvl of levels) {
    const dist = Math.abs(lvl.price - price);
    if (dist <= maxDistance && dist < bestDist) {
      best = lvl;
      bestDist = dist;
    }
  }
  return best;
}

function detectBounceSignal(perTimeframe, decimals = 3) {
  const { '15m': m15, '1h': h1, '1d': d1 } = perTimeframe;
  const price = m15.price;
  const atr15 = m15.volatility.atr14 || price * 0.001;
  const proximity = atr15 * 1.0; // must be within ~1x 15m ATR of the level

  const keySupports = [...d1.supportResistance.support, ...h1.supportResistance.support];
  const keyResistances = [...d1.supportResistance.resistance, ...h1.supportResistance.resistance];

  const nearSupport = nearestLevel(keySupports, price, proximity);
  const nearResistance = nearestLevel(keyResistances, price, proximity);

  const bullishPattern = m15.candlestickPatterns.some((p) => p.bias === 'bullish');
  const bearishPattern = m15.candlestickPatterns.some((p) => p.bias === 'bearish');
  // Momentum confirmation deliberately does NOT require MACD to have
  // already flipped — MACD is a lagging, smoothed indicator and won't
  // turn within 1-2 bars of a sharp reversal. RSI at an extreme is the
  // faster-reacting confirmation that actually fits a reversal trigger.
  const bullishMomentumTurn =
    m15.momentum.rsiState === 'oversold' || (m15.momentum.rsi14 != null && m15.momentum.rsi14 < 35);
  const bearishMomentumTurn =
    m15.momentum.rsiState === 'overbought' || (m15.momentum.rsi14 != null && m15.momentum.rsi14 > 65);

  let direction = null;
  let level = null;

  if (nearSupport && bullishPattern && bullishMomentumTurn) {
    direction = 'long';
    level = nearSupport;
  } else if (nearResistance && bearishPattern && bearishMomentumTurn) {
    direction = 'short';
    level = nearResistance;
  }

  if (!direction) return null;

  const h1Direction = h1.score > 10 ? 'long' : h1.score < -10 ? 'short' : 'neutral';
  const counterTrend = h1Direction !== 'neutral' && h1Direction !== direction;

  // Prefer targeting the next real key level(s) in the trade direction;
  // fall back to R-multiples off the entry/stop distance if none exist.
  const zoneWidth = Math.max(atr15 * 0.3, price * 0.0006);
  let entryHigh;
  let entryLow;
  if (direction === 'long') {
    entryHigh = price;
    entryLow = price - zoneWidth;
  } else {
    entryHigh = price + zoneWidth;
    entryLow = price;
  }
  const entryMid = (entryHigh + entryLow) / 2;

  const stopLoss =
    direction === 'long'
      ? Number((level.price - 0.4 * atr15).toFixed(decimals))
      : Number((level.price + 0.4 * atr15).toFixed(decimals));

  const riskDistance = Math.abs(entryMid - stopLoss);
  const sign = direction === 'long' ? 1 : -1;

  const candidateTargets = (direction === 'long' ? keyResistances : keySupports)
    .filter((l) => (direction === 'long' ? l.price > entryMid : l.price < entryMid))
    .sort((a, b) => (direction === 'long' ? a.price - b.price : b.price - a.price))
    .slice(0, 3)
    .map((l) => Number(l.price.toFixed(decimals)));

  const takeProfits =
    candidateTargets.length >= 2
      ? candidateTargets
      : [1, 2, 3].map((r) => Number((entryMid + sign * r * riskDistance).toFixed(decimals)));

  return {
    type: 'counter_trend_bounce',
    counterTrend,
    direction,
    keyLevel: { price: level.price, touches: level.touches, side: level.side },
    entryZone: {
      high: Number(entryHigh.toFixed(decimals)),
      low: Number(entryLow.toFixed(decimals)),
      label: `@${entryHigh.toFixed(decimals)}-${entryLow.toFixed(decimals)}`,
    },
    stopLoss,
    takeProfits,
    runner: 'open',
    reasoning: [
      `Price is testing a ${level.side} level at ${level.price} (${level.touches} prior touch${level.touches > 1 ? 'es' : ''}).`,
      `15m shows a ${direction === 'long' ? 'bullish' : 'bearish'} reversal trigger: candlestick pattern + momentum turn.`,
      counterTrend
        ? '⚠️ This goes AGAINST the 1H trend — higher-risk counter-trend/reversal trade, not a trend-following setup.'
        : 'This aligns with the 1H trend — a trend-following bounce off a key level.',
    ],
    riskWarning:
      'Counter-trend/reversal signal: higher risk than the primary trend-aligned setup. Consider reduced size and tighter management.',
  };
}

module.exports = { detectBounceSignal };
