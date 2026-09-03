const express = require('express');
const cache = require('../../lib/cache');
const { runAnalysisForSymbol, runAllAnalyses } = require('../../lib/runAnalysis');
const { getActiveSymbols, getSymbolBySlug } = require('../../lib/symbols');

const router = express.Router();

// GET /api/analysis  -> latest cached result for every active symbol
router.get('/', async (req, res) => {
  try {
    const symbols = getActiveSymbols();
    const cached = {};
    let missing = [];
    for (const s of symbols) {
      const c = cache.get(s.slug);
      if (c) cached[s.slug] = c;
      else missing.push(s.slug);
    }
    if (missing.length === 0) {
      return res.json(cached);
    }
    // Nothing cached yet for one or more symbols (e.g. right after boot) -> compute all once now.
    const results = await runAllAnalyses();
    return res.json(results);
  } catch (err) {
    console.error('Analysis error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/analysis/:symbol  -> e.g. /api/analysis/xauusd, /api/analysis/eurusd
router.get('/:symbol', async (req, res) => {
  try {
    const symbolConfig = getSymbolBySlug(req.params.symbol);
    if (!symbolConfig) {
      const available = getActiveSymbols().map((s) => s.slug);
      return res.status(404).json({
        error: `Unknown symbol "${req.params.symbol}". Available: ${available.join(', ')}`,
      });
    }

    const wantsRefresh = req.query.refresh === 'true';

    if (wantsRefresh) {
      if (!cache.canRefreshNow(symbolConfig.slug)) {
        const waitMs = cache.msUntilNextAllowedRefresh(symbolConfig.slug);
        const cached = cache.get(symbolConfig.slug);
        return res.status(429).json({
          error: `Refresh throttled for ${symbolConfig.label}. Try again in ${Math.ceil(waitMs / 1000)}s.`,
          cached,
        });
      }
      const result = await runAnalysisForSymbol(symbolConfig);
      return res.json(result);
    }

    const cached = cache.get(symbolConfig.slug);
    if (!cached) {
      const result = await runAnalysisForSymbol(symbolConfig);
      return res.json(result);
    }
    return res.json(cached);
  } catch (err) {
    console.error('Analysis error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
