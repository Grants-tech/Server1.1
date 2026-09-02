/**
 * lib/signalNotifier.js
 *
 * Gates email alerts so you get AT MOST 2 per rolling 24 hours, and never
 * more than one every few hours even if a single strong trend keeps
 * qualifying on every 15-min refresh (otherwise one lingering trend would
 * burn both of your daily "slots" on the same setup).
 */

const { isHighConfidence } = require('./confidence');
const { sendSignalEmail } = require('./mailer');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_WINDOW = 2;
const DEFAULT_COOLDOWN_HOURS = 3;

let sentTimestamps = []; // resets on process restart — acceptable for an hourly/15-min cadence service
let lastSentAt = 0;

function pruneOld() {
  const cutoff = Date.now() - WINDOW_MS;
  sentTimestamps = sentTimestamps.filter((t) => t > cutoff);
}

function getMaxPerWindow() {
  const v = Number(process.env.SIGNAL_MAX_PER_DAY);
  return Number.isFinite(v) && v > 0 ? Math.min(v, 2) : DEFAULT_MAX_PER_WINDOW; // hard cap at 2 as requested
}

function getCooldownMs() {
  const v = Number(process.env.SIGNAL_COOLDOWN_HOURS);
  return (Number.isFinite(v) && v > 0 ? v : DEFAULT_COOLDOWN_HOURS) * 60 * 60 * 1000;
}

async function maybeNotify(result) {
  pruneOld();

  if (!isHighConfidence(result)) return { sent: false, reason: 'not_high_confidence' };
  if (sentTimestamps.length >= getMaxPerWindow()) {
    return { sent: false, reason: 'daily_quota_reached' };
  }
  if (Date.now() - lastSentAt < getCooldownMs()) {
    return { sent: false, reason: 'cooldown_active' };
  }
  if (!process.env.EMAIL_TO || !process.env.SMTP_HOST) {
    return { sent: false, reason: 'email_not_configured' };
  }

  await sendSignalEmail(result);
  sentTimestamps.push(Date.now());
  lastSentAt = Date.now();
  return { sent: true };
}

function getStatus() {
  pruneOld();
  return {
    sentInLast24h: sentTimestamps.length,
    maxPerWindow: getMaxPerWindow(),
    cooldownHours: getCooldownMs() / (60 * 60 * 1000),
    lastSentAt: lastSentAt ? new Date(lastSentAt).toISOString() : null,
  };
}

module.exports = { maybeNotify, getStatus };
