/**
 * lib/outcomeStore.js
 *
 * Tracks real outcomes for signals that reached 'enter' or 'caution'
 * tier, so the conviction-score tiers can eventually be validated
 * empirically instead of just theoretically.
 *
 * PERSISTENCE WARNING: this writes to a JSON file on disk. Railway's
 * default filesystem is EPHEMERAL — it resets on every redeploy. Unless
 * you attach a Railway Volume to this service and set DATA_DIR to its
 * mount path, your history will be wiped every time you push new code.
 * See README for the exact steps.
 *
 * Storage format: a flat JSON array of records, each either 'open' or
 * 'closed', at DATA_DIR/signal-outcomes.json.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'signal-outcomes.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}

function readAll() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('[outcomeStore] Failed to read store, starting fresh:', err.message);
    return [];
  }
}

function writeAll(records) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
}

function getOpenSignal(slug) {
  return readAll().find((r) => r.slug === slug && r.status === 'open') || null;
}

/**
 * Logs a new open paper-trade. Does nothing (returns null) if one is
 * already open for this symbol — only one open trade per symbol at a
 * time, so a persisting signal across multiple refresh cycles doesn't
 * get logged repeatedly.
 */
function logSignal({ slug, symbolLabel, direction, tier, score, entryZone, stopLoss, takeProfits, entryTime }) {
  if (getOpenSignal(slug)) return null;

  const all = readAll();
  const record = {
    id: `${slug}-${Date.now()}`,
    slug,
    symbolLabel,
    direction,
    tier,
    scoreAtEntry: score,
    entryZone,
    stopLoss,
    takeProfits,
    entryTime,
    status: 'open',
    outcome: null,
    tpHit: null,
    exitPrice: null,
    exitTime: null,
    note: null,
  };
  all.push(record);
  writeAll(all);
  return record;
}

function closeSignal(id, { outcome, exitPrice, exitTime, tpHit = null, note = null }) {
  const all = readAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], status: 'closed', outcome, exitPrice, exitTime, tpHit, note };
  writeAll(all);
  return all[idx];
}

function listSignals({ slug, status } = {}) {
  let all = readAll();
  if (slug) all = all.filter((r) => r.slug === slug);
  if (status) all = all.filter((r) => r.status === status);
  return all.sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));
}

/**
 * Scans candles newer than the open signal's entry time for a SL or TP
 * touch, using actual high/low (not just close), so a touch between
 * refresh cycles isn't missed as long as it's within the fetched candle
 * window (currently 300 x 15m candles ~ 3 days).
 *
 * Simplifying assumption: if a single candle's range touches BOTH the
 * SL and a TP (rare, but possible on a wide-range candle), the SL is
 * assumed to have been hit first — the conservative assumption used in
 * most manual backtesting, since OHLC data alone can't tell us the
 * actual intra-candle order of events.
 */
function checkAndCloseOpenSignal(slug, m15Candles) {
  const open = getOpenSignal(slug);
  if (!open) return null;

  const entryTime = new Date(open.entryTime).getTime();
  const relevant = m15Candles.filter((c) => new Date(c.time).getTime() > entryTime);

  for (const c of relevant) {
    if (open.direction === 'long') {
      if (c.low <= open.stopLoss) {
        return closeSignal(open.id, { outcome: 'loss', exitPrice: open.stopLoss, exitTime: c.time, note: 'SL hit' });
      }
      const tpIndex = open.takeProfits.findIndex((tp) => c.high >= tp);
      if (tpIndex !== -1) {
        return closeSignal(open.id, {
          outcome: 'win',
          exitPrice: open.takeProfits[tpIndex],
          exitTime: c.time,
          tpHit: tpIndex + 1,
          note: `TP${tpIndex + 1} hit`,
        });
      }
    } else {
      if (c.high >= open.stopLoss) {
        return closeSignal(open.id, { outcome: 'loss', exitPrice: open.stopLoss, exitTime: c.time, note: 'SL hit' });
      }
      const tpIndex = open.takeProfits.findIndex((tp) => c.low <= tp);
      if (tpIndex !== -1) {
        return closeSignal(open.id, {
          outcome: 'win',
          exitPrice: open.takeProfits[tpIndex],
          exitTime: c.time,
          tpHit: tpIndex + 1,
          note: `TP${tpIndex + 1} hit`,
        });
      }
    }
  }
  return null;
}

/**
 * Win rate overall AND broken down by score tier at entry — this is the
 * part that actually answers "does a higher conviction score correlate
 * with better real outcomes," empirically, from your own logged data,
 * rather than just theoretically from how the weights were designed.
 */
function getStats({ slug } = {}) {
  let closed = readAll().filter((r) => r.status === 'closed');
  if (slug) closed = closed.filter((r) => r.slug === slug);

  const bucketOf = (score) => (score >= 75 ? 'enter_75_100' : 'caution_55_74');
  const buckets = {};
  for (const r of closed) {
    const b = bucketOf(r.scoreAtEntry);
    if (!buckets[b]) buckets[b] = { wins: 0, losses: 0, total: 0 };
    buckets[b].total += 1;
    if (r.outcome === 'win') buckets[b].wins += 1;
    if (r.outcome === 'loss') buckets[b].losses += 1;
  }

  const withRate = (b) => ({ ...b, winRate: b.total ? Number(((b.wins / b.total) * 100).toFixed(1)) : null });

  const overall = {
    wins: closed.filter((r) => r.outcome === 'win').length,
    losses: closed.filter((r) => r.outcome === 'loss').length,
    total: closed.length,
  };

  return {
    overall: withRate(overall),
    byScoreTier: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, withRate(v)])),
    sampleSize: closed.length,
    note:
      closed.length < 20
        ? 'Sample size is small — treat these numbers as preliminary, not statistically reliable yet.'
        : null,
  };
}

module.exports = { logSignal, closeSignal, listSignals, getStats, getOpenSignal, checkAndCloseOpenSignal };