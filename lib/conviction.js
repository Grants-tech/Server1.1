/**
 * lib/conviction.js
 *
 * Replaces the old all-or-nothing alignment gate with a weighted
 * "weight of the evidence" scoring system — the philosophy Murphy's book
 * actually describes: no single indicator or timeframe has to be
 * perfect. Multiple confirming factors build conviction, and one weak
 * link no longer collapses an otherwise strong setup into a flat "wait".
 * That rigid AND-gate is precisely what causes analysis paralysis —
 * chasing perfect agreement across every rule means real opportunities
 * get thrown out over one borderline reading.
 *
 * Each factor below contributes points (out of 100) toward whichever
 * direction the weighted multi-timeframe score points to. Factors give
 * partial credit for "close but not perfect" readings rather than a
 * hard pass/fail, so a slightly weak 15m alignment costs some points —
 * not the entire signal.
 */

const WEIGHTS = {
  dailyAlignment: 25,
  h1Alignment: 25,
  m15Alignment: 15,
  h1Trending: 10,
  m15NotChoppy: 5,
  momentum: 10,
  volatility: 10,
};
// Weights sum to 100.

function alignmentCredit(tfScore, direction, strongThreshold = 15) {
  const sameSign = (tfScore > 0 && direction === 'long') || (tfScore < 0 && direction === 'short');
  const mag = Math.abs(tfScore);
  if (sameSign && mag >= strongThreshold) return 1; // clearly confirms
  if (sameSign) return 0.6; // leans the same way, just not strongly
  if (mag < strongThreshold) return 0.35; // mild/near-neutral opposition — not a real contradiction
  return 0; // clearly contradicts
}

function computeConviction(perTimeframe, weightedScore) {
  const { '15m': m15, '1h': h1, '1d': d1 } = perTimeframe;

  // The one thing that stays a hard requirement: there has to be SOME
  // directional lean to build a trade around. Below this, there's
  // simply no direction to grade factors against.
  if (Math.abs(weightedScore) < 8) {
    return { direction: null, score: 0, tier: 'no_trade', factors: [] };
  }

  const direction = weightedScore > 0 ? 'long' : 'short';
  const factors = [];

  const push = (name, credit, weight) =>
    factors.push({ name, credit: Number(credit.toFixed(2)), points: Math.round(credit * weight), max: weight });

  push('Daily bias alignment', alignmentCredit(d1.score, direction), WEIGHTS.dailyAlignment);
  push('1H trend alignment', alignmentCredit(h1.score, direction), WEIGHTS.h1Alignment);
  push('15m alignment', alignmentCredit(m15.score, direction, 10), WEIGHTS.m15Alignment);

  const h1TrendingCredit = h1.trend.trendStrength === 'trending' ? 1 : 0.3;
  push('1H actively trending (ADX)', h1TrendingCredit, WEIGHTS.h1Trending);

  const m15NotChoppyCredit = m15.trend.trendStrength === 'trending' ? 1 : 0.4;
  push('15m not choppy (ADX)', m15NotChoppyCredit, WEIGHTS.m15NotChoppy);

  const macdSupports = m15.momentum.macdState === (direction === 'long' ? 'bullish' : 'bearish');
  const rsiAgainst =
    (direction === 'long' && m15.momentum.rsiState === 'overbought') ||
    (direction === 'short' && m15.momentum.rsiState === 'oversold');
  let momentumCredit = 0.5;
  if (macdSupports && !rsiAgainst) momentumCredit = 1;
  else if (!macdSupports && rsiAgainst) momentumCredit = 0.1;
  else if (rsiAgainst) momentumCredit = 0.3;
  push('15m momentum supportive', momentumCredit, WEIGHTS.momentum);

  const atrPct = m15.volatility.atr14 && m15.price ? m15.volatility.atr14 / m15.price : 0;
  const volCredit = atrPct > 0.008 ? 0.2 : atrPct > 0.006 ? 0.6 : 1;
  push('Volatility normal (not stretched)', volCredit, WEIGHTS.volatility);

  const score = factors.reduce((sum, f) => sum + f.points, 0);

  let tier;
  if (score >= 75) tier = 'enter';
  else if (score >= 55) tier = 'caution';
  else if (score >= 35) tier = 'watch';
  else tier = 'wait';

  return { direction, score, tier, factors };
}

module.exports = { computeConviction };
