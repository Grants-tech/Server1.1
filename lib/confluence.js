/**
 * lib/confluence.js
 *
 * Combines the three per-timeframe analyses into one intraday-trading
 * view, following the standard top-down multi-timeframe approach:
 *   1D  -> macro bias / "the tide"        weight 0.45
 *   1H  -> intraday trend / "the wave"    weight 0.35
 *   15m -> entry timing / "the ripple"    weight 0.20
 *
 * Risk/entry decisions now come from lib/conviction.js — a weighted
 * "weight of the evidence" score rather than a rigid AND-gate requiring
 * every factor to line up perfectly (see conviction.js for why that
 * changed).
 */

const WEIGHTS = { '1d': 0.45, '1h': 0.35, '15m': 0.2 };
const { detectBounceSignal } = require('./bounceSignal');
const { computeConviction } = require('./conviction');

function classify(score) {
  if (score >= 40) return 'strong_bullish';
  if (score >= 15) return 'bullish';
  if (score <= -40) return 'strong_bearish';
  if (score <= -15) return 'bearish';
  return 'neutral';
}

const TIER_TO_ACTION = {
  enter: 'enter',
  caution: 'caution',
  watch: 'watch',
  wait: 'wait',
  no_trade: 'no_trade',
};

const TIER_TO_LEVEL = {
  enter: 'low',
  caution: 'medium',
  watch: 'medium',
  wait: 'high',
  no_trade: 'high',
};

/**
 * Builds a human-readable explanation from the conviction breakdown,
 * calling out the weakest 1-2 factors rather than a single canned
 * reason — so it's clear a setup is a "one imperfect factor" situation,
 * not a total contradiction.
 */
function buildRiskComment(conviction) {
  if (conviction.tier === 'no_trade') {
    return 'Score is too close to neutral — no clear directional edge. Wait for a stronger signal.';
  }

  const sorted = [...conviction.factors].sort((a, b) => a.credit - b.credit);
  const weakest = sorted.filter((f) => f.credit < 0.9).slice(0, 2);

  if (conviction.tier === 'enter') {
    return weakest.length
      ? `High-conviction setup (${conviction.score}/100). Minor softness in: ${weakest.map((f) => f.name).join(', ')}.`
      : `High-conviction setup (${conviction.score}/100) — all factors confirm.`;
  }
  if (conviction.tier === 'caution') {
    return `Moderate-conviction setup (${conviction.score}/100). Weaker factors: ${weakest.map((f) => f.name).join(', ')}. Consider reduced size.`;
  }
  if (conviction.tier === 'watch') {
    return `Early-stage/developing setup (${conviction.score}/100) — not yet actionable. Watching: ${weakest.map((f) => f.name).join(', ')}.`;
  }
  return `Low conviction (${conviction.score}/100) — too many unconfirmed factors: ${weakest.map((f) => f.name).join(', ')}.`;
}

/**
 * Builds an entry-zone / stop-loss / take-profit ladder in the style
 * traders typically post, e.g.:
 *   @4593-4589
 *   SL: 4583
 *   TP: 4600  TP: 4610  TP: 4620  TP: Open
 *
 * TP1/TP2/TP3 are 1R/2R/3R from the entry midpoint; "TP: Open" signals
 * letting a final runner ride (trail the stop) beyond TP3 rather than
 * capping the trade with a fixed final target. Populated for 'enter' and
 * 'caution' tiers; 'watch' and below get null (not yet actionable).
 */
function buildTradeSetup(perTimeframe, conviction, decimals) {
  const { '15m': m15 } = perTimeframe;
  const price = m15.price;
  const atr15 = m15.volatility.atr14 || price * 0.001;

  if (conviction.tier !== 'enter' && conviction.tier !== 'caution') {
    return {
      direction: null,
      entryZone: null,
      stopLoss: null,
      takeProfits: [],
      runner: null,
      riskComment: buildRiskComment(conviction),
    };
  }

  const direction = conviction.direction;
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

  const nearestSupport = m15.supportResistance.support[0];
  const nearestResistance = m15.supportResistance.resistance[0];
  let stopLoss;
  if (direction === 'long') {
    stopLoss = nearestSupport
      ? Number((nearestSupport.price - 0.5 * atr15).toFixed(decimals))
      : Number((entryMid - 1.5 * atr15).toFixed(decimals));
  } else {
    stopLoss = nearestResistance
      ? Number((nearestResistance.price + 0.5 * atr15).toFixed(decimals))
      : Number((entryMid + 1.5 * atr15).toFixed(decimals));
  }

  const riskDistance = Math.abs(entryMid - stopLoss);
  const sign = direction === 'long' ? 1 : -1;
  const takeProfits = [1, 2, 3].map((r) => Number((entryMid + sign * r * riskDistance).toFixed(decimals)));

  return {
    direction,
    entryZone: {
      high: Number(entryHigh.toFixed(decimals)),
      low: Number(entryLow.toFixed(decimals)),
      label: `@${entryHigh.toFixed(decimals)}-${entryLow.toFixed(decimals)}`,
    },
    stopLoss,
    takeProfits,
    runner: 'open',
    riskComment: conviction.tier === 'caution' ? buildRiskComment(conviction) : null,
  };
}

function buildConfluence(perTimeframe, symbolLabel = 'XAU/USD', decimals = 3) {
  const { '15m': m15, '1h': h1, '1d': d1 } = perTimeframe;

  const weightedScore =
    d1.score * WEIGHTS['1d'] + h1.score * WEIGHTS['1h'] + m15.score * WEIGHTS['15m'];

  const overallSignal = classify(weightedScore);

  // Kept for backwards compatibility / a quick "all 3 fully agree" flag —
  // no longer used to gate anything, since conviction scoring replaced
  // that rigid requirement.
  const aligned =
    Math.sign(d1.score) === Math.sign(h1.score) && Math.sign(h1.score) === Math.sign(m15.score);

  const price = m15.price;

  const conviction = computeConviction(perTimeframe, weightedScore);
  const risk = {
    level: TIER_TO_LEVEL[conviction.tier],
    action: TIER_TO_ACTION[conviction.tier],
    comment: conviction.tier === 'enter' && conviction.score >= 90 ? null : buildRiskComment(conviction),
  };
  const tradeSetup = buildTradeSetup(perTimeframe, conviction, decimals);
  const bounceSignal = detectBounceSignal(perTimeframe, decimals);

  const suggestedStop = tradeSetup.stopLoss;
  const suggestedDirection = tradeSetup.direction;

  const notes = [];
  notes.push(
    `Daily bias is ${d1.signal} (score ${d1.score}); this is the dominant context for the day.`
  );
  notes.push(`1H trend structure: ${h1.trend.structure}, ADX ${h1.trend.adx ?? 'n/a'} (${h1.trend.trendStrength}).`);
  notes.push(`15m momentum: RSI ${m15.momentum.rsi14 ?? 'n/a'} (${m15.momentum.rsiState ?? 'n/a'}), MACD ${m15.momentum.macdState ?? 'n/a'}.`);
  notes.push(`Conviction score: ${conviction.score}/100 (${conviction.tier}).`);
  if (m15.candlestickPatterns.length) {
    notes.push(
      `15m candlestick pattern(s) detected: ${m15.candlestickPatterns.map((p) => p.name).join(', ')}.`
    );
  }
  if (risk.comment) {
    notes.push(risk.comment);
  }

  return {
    generatedAt: new Date().toISOString(),
    symbol: symbolLabel,
    price,
    weightedScore: Number(weightedScore.toFixed(2)),
    overallSignal,
    timeframesAligned: aligned,
    conviction,
    suggestedDirection,
    suggestedInvalidation: suggestedStop,
    risk,
    tradeSetup,
    bounceSignal,
    keyLevels: {
      dailySupport: d1.supportResistance.support,
      dailyResistance: d1.supportResistance.resistance,
      h1Support: h1.supportResistance.support,
      h1Resistance: h1.supportResistance.resistance,
      m15Support: m15.supportResistance.support,
      m15Resistance: m15.supportResistance.resistance,
      m15Fibonacci: m15.fibonacci,
    },
    notes,
    disclaimer:
      'Automated technical-analysis output for informational purposes only. Not financial advice. Always confirm with your own risk management before trading.',
    perTimeframe,
  };
}

module.exports = { buildConfluence };
