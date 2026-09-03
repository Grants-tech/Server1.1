/**
 * lib/confidence.js
 *
 * Defines the bar for "I'm very confident about this" — i.e. what
 * qualifies for an email alert (not just what shows up in the JSON).
 *
 * This now reads directly off the weighted conviction score
 * (lib/conviction.js) rather than requiring a rigid checklist of
 * separate hard conditions to all be simultaneously true. That old
 * approach (all 3 timeframes aligned AND |score|>=50 AND both 1H/1D
 * trending AND no RSI conflict) is exactly the kind of "everything must
 * line up perfectly" gate that causes analysis paralysis — one
 * borderline reading could zero out an otherwise strong setup. A single
 * weighted score threshold still keeps the bar high (only genuinely
 * strong setups qualify) without being that brittle.
 */

const MIN_SCORE_FOR_ALERT = 55; // lowered per your request — this now
// includes the 'caution' tier (55-74), not just 'enter' (75+). Heads up:
// this meaningfully increases alert frequency and lowers the average
// quality bar for what gets emailed — see README for the tradeoff.

function isHighConfidence(result) {
  if (!result || !result.conviction) return false;
  return result.conviction.score >= MIN_SCORE_FOR_ALERT;
}

module.exports = { isHighConfidence, MIN_SCORE_FOR_ALERT };