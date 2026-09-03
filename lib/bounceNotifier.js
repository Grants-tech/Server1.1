/**
 * lib/bounceNotifier.js
 *
 * Separate email-alert gate for counter-trend bounce/reversal signals
 * (lib/bounceSignal.js), tracked independently PER SYMBOL from the main
 * trend-following signalNotifier — and capped tighter (max 1/day per
 * symbol, not 2), since counter-trend setups are explicitly the
 * higher-risk category and should stay rarer in your inbox.
 */

const { sendBounceEmail } = require('./mailer');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_WINDOW = 1;
const DEFAULT_COOLDOWN_HOURS = 3;

const sentTimestampsBySlug = new Map();
const lastSentAtBySlug = new Map();

function pruneOld(slug) {
  const cutoff = Date.now() - WINDOW_MS;
  const list = (sentTimestampsBySlug.get(slug) || []).filter((t) => t > cutoff);
  sentTimestampsBySlug.set(slug, list);
  return list;
}

function getMaxPerWindow() {
  const v = Number(process.env.BOUNCE_SIGNAL_MAX_PER_DAY);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : DEFAULT_MAX_PER_WINDOW; // hard cap at 1/day per symbol
}

function getCooldownMs() {
  const v = Number(process.env.BOUNCE_SIGNAL_COOLDOWN_HOURS);
  return (Number.isFinite(v) && v > 0 ? v : DEFAULT_COOLDOWN_HOURS) * 60 * 60 * 1000;
}

/**
 * Only alerts on genuinely counter-trend bounces (bounce.counterTrend ===
 * true). A "bounce" that happens to align with the 1H trend anyway is
 * just a trend-following pullback entry — already covered (or not) by
 * the main signalNotifier — so it's deliberately not double-alerted here.
 */
async function maybeNotifyBounce(slug, bounceSignal, price, symbolLabel) {
  if (!bounceSignal || !bounceSignal.counterTrend) {
    return { sent: false, reason: 'no_qualifying_bounce' };
  }

  const sentTimestamps = pruneOld(slug);
  const lastSentAt = lastSentAtBySlug.get(slug) || 0;

  if (sentTimestamps.length >= getMaxPerWindow()) {
    return { sent: false, reason: 'daily_quota_reached' };
  }
  if (Date.now() - lastSentAt < getCooldownMs()) {
    return { sent: false, reason: 'cooldown_active' };
  }
  if (!process.env.EMAIL_TO || !process.env.RESEND_API_KEY) {
    return { sent: false, reason: 'email_not_configured' };
  }

  await sendBounceEmail(bounceSignal, price, symbolLabel);
  sentTimestamps.push(Date.now());
  sentTimestampsBySlug.set(slug, sentTimestamps);
  lastSentAtBySlug.set(slug, Date.now());
  return { sent: true };
}

function getStatus(slug) {
  const sentTimestamps = pruneOld(slug);
  const lastSentAt = lastSentAtBySlug.get(slug) || 0;
  return {
    symbol: slug,
    sentInLast24h: sentTimestamps.length,
    maxPerWindow: getMaxPerWindow(),
    cooldownHours: getCooldownMs() / (60 * 60 * 1000),
    lastSentAt: lastSentAt ? new Date(lastSentAt).toISOString() : null,
  };
}

function getAllStatuses(slugs) {
  return slugs.map((slug) => getStatus(slug));
}

module.exports = { maybeNotifyBounce, getStatus, getAllStatuses };
