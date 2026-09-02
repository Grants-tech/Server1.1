const express = require('express');
const cache = require('../../lib/cache');
const { runAnalysis } = require('../../lib/runAnalysis');

const router = express.Router();

router.get('/xauusd', async (req, res) => {
  try {
    const wantsRefresh = req.query.refresh === 'true';

    if (wantsRefresh) {
      if (!cache.canRefreshNow()) {
        const waitMs = cache.msUntilNextAllowedRefresh();
        const cached = cache.get();
        return res.status(429).json({
          error: `Refresh throttled. Try again in ${Math.ceil(waitMs / 1000)}s.`,
          cached,
        });
      }
      const result = await runAnalysis();
      return res.json(result);
    }

    const cached = cache.get();
    if (!cached) {
      // Nothing computed yet (e.g. right after boot) -> compute once now.
      const result = await runAnalysis();
      return res.json(result);
    }
    return res.json(cached);
  } catch (err) {
    console.error('Analysis error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
