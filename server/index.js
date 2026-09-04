require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const analysisRouter = require('./routes/analysis');
const { runAllAnalyses } = require('../lib/runAnalysis');
const { getAllStatuses: getSignalStatuses } = require('../lib/signalNotifier');
const { getAllStatuses: getBounceStatuses } = require('../lib/bounceNotifier');
const { sendTestEmail } = require('../lib/mailer');
const { getActiveSymbols } = require('../lib/symbols');
const { listSignals, getStats, closeSignal } = require('../lib/outcomeStore');

const app = express();
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN; // optional bearer token to protect the endpoint
const CRON_SCHEDULE = process.env.REFRESH_CRON || '*/15 * * * *'; // default: every 15 minutes

app.use(express.json());

// Optional simple auth: if ACCESS_TOKEN is set, require it as a Bearer token.
app.use((req, res, next) => {
  if (!ACCESS_TOKEN) return next();
  if (req.path === '/health') return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== ACCESS_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/symbols', (req, res) => {
  res.json(getActiveSymbols().map(({ slug, label }) => ({ slug, label })));
});

app.get('/api/signals/status', (req, res) => {
  const slugs = getActiveSymbols().map((s) => s.slug);
  res.json(getSignalStatuses(slugs));
});

app.get('/api/signals/bounce-status', (req, res) => {
  const slugs = getActiveSymbols().map((s) => s.slug);
  res.json(getBounceStatuses(slugs));
});

// One-off check to confirm email delivery works, bypassing the confidence gate.
// Protected by the same ACCESS_TOKEN auth as the rest of the API.
app.get('/api/signals/test-email', async (req, res) => {
  try {
    await sendTestEmail();
    res.json({ sent: true, message: `Test email sent to ${process.env.EMAIL_TO}` });
  } catch (err) {
    res.status(500).json({ sent: false, error: err.message });
  }
});

// GET /api/signals/history?symbol=xauusd&status=open|closed
app.get('/api/signals/history', (req, res) => {
  try {
    const { symbol, status } = req.query;
    res.json(listSignals({ slug: symbol, status }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/signals/stats?symbol=xauusd  (omit symbol for stats across all tracked symbols)
app.get('/api/signals/stats', (req, res) => {
  try {
    res.json(getStats({ slug: req.query.symbol }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/signals/:id/close  { outcome: "win"|"loss"|"breakeven", exitPrice, note }
// Manual override — e.g. for a "TP: Open" runner you managed yourself
// beyond what auto-tracking follows, or to correct an auto-close.
app.post('/api/signals/:id/close', (req, res) => {
  try {
    const { outcome, exitPrice, note } = req.body || {};
    if (!outcome || !['win', 'loss', 'breakeven'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be "win", "loss", or "breakeven".' });
    }
    const updated = closeSignal(req.params.id, {
      outcome,
      exitPrice: exitPrice ?? null,
      exitTime: new Date().toISOString(),
      note: note || 'Manually closed.',
    });
    if (!updated) return res.status(404).json({ error: `No signal found with id "${req.params.id}".` });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/analysis', analysisRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  const symbols = getActiveSymbols();
  console.log(`XAUUSD/Forex TA server listening on port ${PORT}`);
  console.log(`Tracking symbols: ${symbols.map((s) => s.label).join(', ')}`);
  console.log(`Refresh schedule: "${CRON_SCHEDULE}"`);

  // Prime the cache on boot so the first request doesn't have to wait.
  runAllAnalyses()
    .then(() => console.log('Initial analysis computed and cached for all symbols.'))
    .catch((err) => console.error('Initial analysis failed:', err.message));

  cron.schedule(CRON_SCHEDULE, () => {
    console.log(`[cron] Refreshing analysis for all symbols at ${new Date().toISOString()}`);
    runAllAnalyses()
      .then(() => console.log('[cron] Analysis refreshed for all symbols.'))
      .catch((err) => console.error('[cron] Refresh failed:', err.message));
  });
});
