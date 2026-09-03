/**
 * lib/confluence.js
 *
 * Combines the three per-timeframe analyses into one intraday-trading
 * view, following the standard top-down multi-timeframe approach:
 *   1D  -> macro bias / "the tide"        weight 0.45
 *   1H  -> intraday trend / "the wave"    weight 0.35
 *   15m -> entry timing / "the ripple"    weight 0.20
 *
 * This mirrors the top-down approach to multiple timeframe analysis:
 * use the higher timeframe to establish directional bias, the middle
 * timeframe to confirm it, and the lowest timeframe to time entries.
 */

const WEIGHTS = { '1d': 0.45, '1h': 0.35, '15m': 0.2 };
const { detectBounceSignal } = require('./bounceSignal');

function classify(score) {
  if (score >= 40) return 'strong_bullish';
  if (score >= 15) return 'bullish';
  if (score <= -40) return 'strong_bearish';
  if (score <= -15) return 'bearish';
  return 'neutral';
}

/**
 * Decides whether conditions are clean enough to act on, and why not
 * when they aren't. This is deliberately conservative: it's meant to
 * hold you back on marginal/choppy/conflicting setups rather than to
 * find reasons to trade.
 */
function assessRisk(perTimeframe, weightedScore, aligned, overallSignal) {
  const { '15m': m15, '1h': h1, '1d': d1 } = perTimeframe;

  if (overallSignal === 'neutral') {
    return {
      level: 'high',
      action: 'no_trade',
      comment: 'Score is too close to neutral across timeframes — no clear edge. Wait for a stronger signal.',
    };
  }
  if (!aligned) {
    return {
      level: 'high',
      action: 'wait',
      comment: 'Timeframes disagree on direction (15m/1H/Daily are not aligned) — wait for confirmation before entering.',
    };
  }
  if (h1.trend.trendStrength === 'choppy/range' || m15.trend.trendStrength === 'choppy/range') {
    return {
      level: 'high',
      action: 'wait',
      comment: 'ADX indicates a choppy/ranging market on 1H or 15m — wait for a clearer directional trend before entering.',
    };
  }
  if (m15.momentum.rsiState === 'overbought' && weightedScore > 0) {
    return {
      level: 'medium',
      action: 'wait',
      comment: '15m RSI is overbought while the bias is bullish — wait for a pullback rather than chasing price.',
    };
  }
  if (m15.momentum.rsiState === 'oversold' && weightedScore < 0) {
    return {
      level: 'medium',
      action: 'wait',
      comment: '15m RSI is oversold while the bias is bearish — wait for a bounce/pullback rather than chasing price.',
    };
  }
  // Volatility sanity check: if 15m ATR is unusually wide relative to price, stops/targets get noisy.
  const atrPct = m15.volatility.atr14 && m15.price ? m15.volatility.atr14 / m15.price : 0;
  if (atrPct > 0.006) {
    return {
      level: 'medium',
      action: 'caution',
      comment: '15m volatility (ATR) is elevated relative to price — consider reduced size or wait for it to settle.',
    };
  }

  return {
    level: 'low',
    action: 'enter',
    comment: null,
  };
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
 * capping the trade with a fixed final target.
 */
function buildTradeSetup(perTimeframe, weightedScore, risk, decimals) {
  const { '15m': m15 } = perTimeframe;
  const price = m15.price;
  const atr15 = m15.volatility.atr14 || price * 0.001;

  if (risk.action !== 'enter' && risk.action !== 'caution') {
    return {
      direction: null,
      entryZone: null,
      stopLoss: null,
      takeProfits: [],
      runner: null,
      riskComment: risk.comment,
    };
  }

  const direction = weightedScore > 0 ? 'long' : 'short';
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
    riskComment: risk.action === 'caution' ? risk.comment : null,
  };
}

function buildConfluence(perTimeframe, symbolLabel = 'XAU/USD', decimals = 3) {
  const { '15m': m15, '1h': h1, '1d': d1 } = perTimeframe;

  const weightedScore =
    d1.score * WEIGHTS['1d'] + h1.score * WEIGHTS['1h'] + m15.score * WEIGHTS['15m'];

  const overallSignal = classify(weightedScore);

  const aligned =
    Math.sign(d1.score) === Math.sign(h1.score) && Math.sign(h1.score) === Math.sign(m15.score);

  const price = m15.price;

  const risk = assessRisk(perTimeframe, weightedScore, aligned, overallSignal);
  const tradeSetup = buildTradeSetup(perTimeframe, weightedScore, risk, decimals);
  const bounceSignal = detectBounceSignal(perTimeframe, decimals);

  // Simple structure-based invalidation: nearest 15m support/resistance
  // beyond current price, padded by ~0.5x ATR. (Kept for backwards
  // compatibility / quick reference alongside the fuller tradeSetup above.)
  let suggestedStop = tradeSetup.stopLoss;
  let suggestedDirection = tradeSetup.direction;

  const notes = [];
  notes.push(
    `Daily bias is ${d1.signal} (score ${d1.score}); this is the dominant context for the day.`
  );
  notes.push(`1H trend structure: ${h1.trend.structure}, ADX ${h1.trend.adx ?? 'n/a'} (${h1.trend.trendStrength}).`);
  notes.push(`15m momentum: RSI ${m15.momentum.rsi14 ?? 'n/a'} (${m15.momentum.rsiState ?? 'n/a'}), MACD ${m15.momentum.macdState ?? 'n/a'}.`);
  if (aligned) {
    notes.push('All three timeframes agree on direction — higher-conviction setup.');
  } else {
    notes.push('Timeframes are not fully aligned — favor waiting for confirmation or reduced size.');
  }
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
