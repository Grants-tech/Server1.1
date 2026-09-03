/**
 * lib/cache.js
 * Minimal in-memory store for the latest computed analysis, keyed per
 * symbol slug (e.g. "xauusd", "eurusd"), plus a per-symbol throttle guard
 * so on-demand refresh requests can't blow through the data provider's
 * rate limits for any single symbol.
 */

const latestBySlug = new Map();
const lastRefreshAtBySlug = new Map();
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function set(slug, result) {
  latestBySlug.set(slug, result);
  lastRefreshAtBySlug.set(slug, Date.now());
}

function get(slug) {
  return latestBySlug.get(slug) || null;
}

function getAll() {
  return Object.fromEntries(latestBySlug.entries());
}

function canRefreshNow(slug) {
  const last = lastRefreshAtBySlug.get(slug) || 0;
  return Date.now() - last >= MIN_REFRESH_INTERVAL_MS;
}

function msUntilNextAllowedRefresh(slug) {
  const last = lastRefreshAtBySlug.get(slug) || 0;
  return Math.max(0, MIN_REFRESH_INTERVAL_MS - (Date.now() - last));
}

module.exports = { set, get, getAll, canRefreshNow, msUntilNextAllowedRefresh };
