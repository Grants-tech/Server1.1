require('dotenv').config();
const express = require('express');
const cron = require('node-cron');

const analysisRouter = require('./routes/analysis');
const { runAnalysis } = require('../lib/runAnalysis');
const { getStatus } = require('../lib/signalNotifier');

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

app.get('/api/signals/status', (req, res) => {
  res.json(getStatus());
});

app.use('/api/analysis', analysisRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`XAUUSD TA server listening on port ${PORT}`);
  console.log(`Refresh schedule: "${CRON_SCHEDULE}"`);

  // Prime the cache on boot so the first request doesn't have to wait.
  runAnalysis()
    .then(() => console.log('Initial analysis computed and cached.'))
    .catch((err) => console.error('Initial analysis failed:', err.message));

  cron.schedule(CRON_SCHEDULE, () => {
    console.log(`[cron] Refreshing analysis at ${new Date().toISOString()}`);
    runAnalysis()
      .then(() => console.log('[cron] Analysis refreshed.'))
      .catch((err) => console.error('[cron] Refresh failed:', err.message));
  });
});
