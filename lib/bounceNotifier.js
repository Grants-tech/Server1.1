/**
 * lib/bounceNotifier.js
 *
 * Sends a counter-trend bounce alert email whenever a genuinely
 * counter-trend bounce is detected (bounceSignal.counterTrend === true)
 * — NO daily cap, NO cooldown, per your request. Same caveat as
 * signalNotifier: if a bounce condition keeps re-qualifying across
 * refresh cycles, you'll get repeated emails for it.
 */

const { sendBounceEmail } = require('./mailer');

const sentTimestampsBySlug = new Map(); // slug -> number[] (kept only for /status visibility)

async function maybeNotifyBounce(slug, bounceSignal, price, symbolLabel) {
  if (!bounceSignal || !bounceSignal.counterTrend) {
    return { sent: false, reason: 'no_qualifying_bounce' };
  }
  if (!process.env.EMAIL_TO || !process.env.RESEND_API_KEY) {
    return { sent: false, reason: 'email_not_configured' };
  }

  await sendBounceEmail(bounceSignal, price, symbolLabel);

  const list = sentTimestampsBySlug.get(slug) || [];
  list.push(Date.now());
  sentTimestampsBySlug.set(slug, list);

  return { sent: true };
}

function getStatus(slug) {
  const list = sentTimestampsBySlug.get(slug) || [];
  const last = list.length ? list[list.length - 1] : null;
  return {
    symbol: slug,
    sentTotal: list.length,
    maxPerWindow: null, // no cap
    cooldownHours: null, // no cooldown
    lastSentAt: last ? new Date(last).toISOString() : null,
  };
}

function getAllStatuses(slugs) {
  return slugs.map((slug) => getStatus(slug));
}

module.exports = { maybeNotifyBounce, getStatus, getAllStatuses };