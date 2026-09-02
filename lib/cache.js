/**
 * lib/cache.js
 * Minimal in-memory store for the latest computed analysis, plus a
 * throttle guard so on-demand refresh requests can't blow through the
 * data provider's rate limits.
 */

let latest = null;
let lastRefreshAt = 0;
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function set(result) {
  latest = result;
  lastRefreshAt = Date.now();
}

function get() {
  return latest;
}

function canRefreshNow() {
  return Date.now() - lastRefreshAt >= MIN_REFRESH_INTERVAL_MS;
}

function msUntilNextAllowedRefresh() {
  return Math.max(0, MIN_REFRESH_INTERVAL_MS - (Date.now() - lastRefreshAt));
}

module.exports = { set, get, canRefreshNow, msUntilNextAllowedRefresh };
