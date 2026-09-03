/**
 * lib/signalNotifier.js
 *
 * Sends a trend-following alert email whenever a symbol's conviction
 * score clears the bar in lib/confidence.js — NO daily cap, NO cooldown
 * between alerts, per your request. This means: if a symbol's score
 * stays >= the alert threshold across multiple 15-min refresh cycles
 * (e.g. a sustained trend), you WILL get a new email every single
 * cycle for as long as it holds — there is nothing here limiting
 * frequency anymore.
 */

const { isHighConfidence } = require('./confidence');
const { sendSignalEmail } = require('./mailer');

const sentTimestampsBySlug = new Map(); // slug -> number[] (kept only for /status visibility)

async function maybeNotify(slug, result) {
  if (!isHighConfidence(result)) return { sent: false, reason: 'not_high_confidence' };
  if (!process.env.EMAIL_TO || !process.env.RESEND_API_KEY) {
    return { sent: false, reason: 'email_not_configured' };
  }

  await sendSignalEmail(result);

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

module.exports = { maybeNotify, getStatus, getAllStatuses };