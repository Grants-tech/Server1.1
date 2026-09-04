/**
 * lib/symbols.js
 *
 * Central registry of every symbol the system tracks. Each symbol needs:
 *  - slug: used in URLs (e.g. /api/analysis/xauusd) and as the key for
 *    per-symbol caching/quotas
 *  - apiSymbol: the exact symbol string Twelve Data expects
 *  - label: human-readable name used in notes/emails
 *  - decimals: how many decimal places to round prices/levels to —
 *    XAU/USD trades in ~2 decimals, USD/JPY in ~3, and EUR/USD-style
 *    majors in 5 (pip precision). Getting this wrong makes forex output
 *    either meaninglessly imprecise or full of noise digits.
 *
 * Override which symbols are active via the SYMBOLS env var (comma-
 * separated slugs), e.g. SYMBOLS=xauusd,eurusd — defaults to all five
 * below if unset.
 */

const ALL_SYMBOLS = [
  { slug: 'xauusd', apiSymbol: 'XAU/USD', label: 'XAU/USD', decimals: 2 },
  { slug: 'xagusd', apiSymbol: 'XAG/USD', label: 'XAG/USD', decimals: 3 },
  { slug: 'eurusd', apiSymbol: 'EUR/USD', label: 'EUR/USD', decimals: 5 },
  { slug: 'gbpusd', apiSymbol: 'GBP/USD', label: 'GBP/USD', decimals: 5 },
  { slug: 'usdjpy', apiSymbol: 'USD/JPY', label: 'USD/JPY', decimals: 3 },
];

function getActiveSymbols() {
  const envList = process.env.SYMBOLS;
  if (!envList) return ALL_SYMBOLS;
  const slugs = envList
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const filtered = ALL_SYMBOLS.filter((s) => slugs.includes(s.slug));
  return filtered.length ? filtered : ALL_SYMBOLS;
}

function getSymbolBySlug(slug) {
  if (!slug) return null;
  return ALL_SYMBOLS.find((s) => s.slug === slug.toLowerCase()) || null;
}

module.exports = { ALL_SYMBOLS, getActiveSymbols, getSymbolBySlug };