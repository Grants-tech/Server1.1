/**
 * lib/confidence.js
 *
 * Defines the bar for "I'm very confident about this" — deliberately
 * strict, since you described yourself as an intraday trader, not an
 * aggressive one. This is a stricter filter on top of risk.action, used
 * only to decide whether a result is worth an email alert (it does not
 * change what /api/analysis/xauusd returns on every 15-min refresh).
 *
 * A signal only qualifies if ALL of the following hold:
 *  - risk.action === 'enter'          (no wait/caution/no_trade flags at all)
 *  - all three timeframes agree on direction (timeframesAligned)
 *  - the weighted score is strongly one-sided (|score| >= 50)
 *  - both 1H and 1D are actively trending (ADX-based), not choppy/range
 */

const MIN_ABS_SCORE = 50;

function isHighConfidence(result) {
  if (!result || result.risk.action !== 'enter') return false;
  if (!result.timeframesAligned) return false;
  if (Math.abs(result.weightedScore) < MIN_ABS_SCORE) return false;

  const h1 = result.perTimeframe['1h'];
  const d1 = result.perTimeframe['1d'];
  if (h1.trend.trendStrength !== 'trending') return false;
  if (d1.trend.trendStrength !== 'trending') return false;

  return true;
}

module.exports = { isHighConfidence, MIN_ABS_SCORE };
