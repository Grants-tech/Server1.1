# XAUUSD Multi-Timeframe Technical Analysis Server

A headless (no UI) Node.js/Express service that runs classical technical
analysis — the kind covered in John Murphy's *Technical Analysis of the
Financial Markets* (Dow Theory trend structure, moving averages, RSI/MACD/
Stochastic momentum, Bollinger Bands & ATR volatility, candlestick patterns,
support/resistance, Fibonacci retracements) — across **15-minute, 1-hour,
and 1-day** XAU/USD charts, and combines them into a single top-down
intraday view.

Designed to be deployed on [Railway](https://railway.app) and consumed as
a JSON REST API.

## Why this data source

Your broker, fxtrading.com, is an MT4/MT5-style broker and doesn't expose a
public REST API for pulling historical candles directly. Rather than block
on that, this system uses **[Twelve Data](https://twelvedata.com)**:

- Free tier (no credit card): 800 requests/day, 8/minute
- Has a direct `XAU/USD` spot symbol
- Supports 15min / 1h / 1day intervals on the free tier
- This system only needs ~3 requests/hour (72/day) for the scheduled
  refresh, well inside the free limit

If you'd later prefer prices sourced straight from your fxtrading.com
account (so the analysis matches your broker's exact quotes), swap
`lib/dataProvider.js` for a client using a bridge like
[MetaApi](https://metaapi.cloud) (connects to MT4/MT5 accounts over a
cloud API). Every other module only depends on the plain
`{ time, open, high, low, close }[]` shape returned by `getCandles()`, so
no other file needs to change.

## Getting a Twelve Data API key

1. Go to https://twelvedata.com/pricing and sign up for the free plan.
2. Copy your API key from the dashboard.
3. Set it as `TWELVEDATA_API_KEY` (see below).

## Project structure

```
server/
  index.js            # Express app, cron scheduler, optional auth
  routes/
    analysis.js        # GET /api/analysis/xauusd
lib/
  dataProvider.js      # Twelve Data client -> normalized candles
  indicators.js        # SMA, EMA, RSI, MACD, Bollinger, ATR, Stochastic, ADX
  trend.js             # Swing detection, Dow Theory trend, support/resistance
  patterns.js          # Candlestick pattern recognition
  fibonacci.js         # Retracement / extension levels
  analyzer.js           # Per-timeframe scoring engine (-100..+100)
  confluence.js         # Combines 15m/1H/1D into one weighted view
  cache.js              # In-memory cache + refresh throttle
  runAnalysis.js         # Orchestrates fetch -> analyze -> cache
railway.json
package.json
.env.example
```

## Environment variables

| Variable               | Required | Description                                                        |
|--------------------------|----------|----------------------------------------------------------------------|
| `TWELVEDATA_API_KEY`    | Yes      | Your Twelve Data API key                                            |
| `ACCESS_TOKEN`          | No       | If set, protects the API with `Authorization: Bearer <token>`       |
| `REFRESH_CRON`          | No       | Cron schedule for auto-refresh. Default: `*/15 * * * *` (every 15 min) |
| `EMAIL_TO`              | For email alerts | Recipient address for high-confidence signal emails         |
| `EMAIL_FROM`            | No       | "From" address on the email. Defaults to `SMTP_USER`                |
| `SMTP_HOST`             | For email alerts | e.g. `smtp.gmail.com`                                        |
| `SMTP_PORT`             | No       | Default `587` (STARTTLS)                                            |
| `SMTP_SECURE`           | No       | `true` for port 465, otherwise `false`                              |
| `SMTP_USER`             | For email alerts | SMTP username                                                |
| `SMTP_PASS`             | For email alerts | SMTP password / app password                                 |
| `SIGNAL_MAX_PER_DAY`    | No       | Max alert emails per rolling 24h. Hard-capped at 2. Default: 2       |
| `SIGNAL_COOLDOWN_HOURS` | No       | Min hours between two alert emails. Default: 3                       |
| `PORT`                  | No       | Set automatically by Railway                                        |

## Setting up email alerts (Gmail example)

You can use any SMTP provider; Gmail is the fastest to set up for free:

1. Turn on 2-Step Verification on your Google account (required for App
   Passwords): https://myaccount.google.com/security
2. Create an App Password: https://myaccount.google.com/apppasswords
   (choose "Mail" as the app) — copy the 16-character password shown.
3. Set in Railway's Variables tab:
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `SMTP_SECURE=false`
   - `SMTP_USER=youraddress@gmail.com`
   - `SMTP_PASS=<the 16-character app password>`
   - `EMAIL_TO=youraddress@gmail.com` (or wherever you want alerts sent)

Prefer a transactional provider instead (more reliable for automated
sending than a personal Gmail account)? SendGrid, Mailgun, Postmark, and
Resend all offer free tiers and an SMTP relay — just point `SMTP_HOST`
`SMTP_USER`/`SMTP_PASS` at their SMTP credentials instead; nothing else in
the code needs to change.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in TWELVEDATA_API_KEY
npm start
```

Then:
```bash
curl http://localhost:3000/api/analysis/xauusd
```

## Deploy to Railway

1. Push this project to a GitHub repo (or use `railway up` from the CLI
   inside this folder).
2. In Railway: **New Project → Deploy from GitHub repo**, select the repo.
3. Railway auto-detects Node via Nixpacks and uses the `start` script in
   `package.json` — `railway.json` pins this explicitly.
4. In the Railway project's **Variables** tab, add:
   - `TWELVEDATA_API_KEY = <your key>`
   - (optional) `ACCESS_TOKEN = <a random string>`
5. Deploy. Railway provides `PORT` automatically.
6. Your endpoint will be at:
   `https://<your-railway-domain>/api/analysis/xauusd`

## API

### `GET /health`
Simple liveness check, always public.

### `GET /api/analysis/xauusd`
Returns the latest cached multi-timeframe analysis. On first boot, or if
nothing has been cached yet, it computes once synchronously.

Add `?refresh=true` to force a recomputation (throttled to once per 5
minutes to protect your API rate limit).

If `ACCESS_TOKEN` is set, include header:
`Authorization: Bearer <ACCESS_TOKEN>`

### Response shape (abridged)

```json
{
  "generatedAt": "2026-09-01T12:00:00.000Z",
  "symbol": "XAU/USD",
  "price": 2413.56,
  "weightedScore": 28.4,
  "overallSignal": "bullish",
  "timeframesAligned": true,
  "suggestedDirection": "long",
  "suggestedInvalidation": 2407.49,
  "risk": {
    "level": "low",
    "action": "enter",
    "comment": null
  },
  "tradeSetup": {
    "direction": "long",
    "entryZone": { "high": 2413.56, "low": 2410.77, "label": "@2413.56-2410.77" },
    "stopLoss": 2407.49,
    "takeProfits": [2416.35, 2419.14, 2421.93],
    "runner": "open",
    "riskComment": null
  },
  "keyLevels": {
    "dailySupport": [...],
    "dailyResistance": [...],
    "h1Support": [...],
    "h1Resistance": [...],
    "m15Support": [...],
    "m15Resistance": [...],
    "m15Fibonacci": { "swingHigh": 0, "swingLow": 0, "retracements": [...], "extensions": [...] }
  },
  "notes": [ "Daily bias is bearish (score -40); this is the dominant context for the day.", "..." ],
  "disclaimer": "Automated technical-analysis output for informational purposes only. Not financial advice.",
  "perTimeframe": {
    "15m": { "score": -25, "signal": "bearish", "trend": {...}, "momentum": {...}, "movingAverages": {...}, "volatility": {...}, "supportResistance": {...}, "fibonacci": {...}, "candlestickPatterns": [...] },
    "1h": { ... },
    "1d": { ... }
  }
}
```

## How the scoring works

Each timeframe is scored independently (`lib/analyzer.js`) from -100
(strongly bearish) to +100 (strongly bullish), blending:

- **Trend structure (weight 30)** — Dow Theory: higher highs/higher lows =
  uptrend, lower highs/lower lows = downtrend, derived from fractal swing
  points (`lib/trend.js`).
- **Moving average alignment (weight 20)** — EMA20 vs EMA50 vs EMA200.
- **Momentum (weight 25)** — RSI14 level/state + MACD histogram sign.
- **Volatility position (weight 10)** — price vs Bollinger Bands (stretch
  / mean-reversion risk).
- **Candlestick patterns (weight 15)** — engulfing, doji, hammer,
  shooting star, morning/evening star.

The three timeframe scores are then combined (`lib/confluence.js`) using a
top-down weighting that matches how intraday traders typically use
multiple timeframes: **Daily 45% (bias) → 1H 35% (trend confirmation) →
15m 20% (entry timing)**. When all three agree, `timeframesAligned` is
`true`, flagging a higher-conviction setup.

## Trade setup & risk gating (`risk` / `tradeSetup`)

On top of the raw score, every response includes a `risk` block and a
`tradeSetup` block:

- **`risk.action`** is one of:
  - `"enter"` — conditions are clean: timeframes aligned, a clear (non-neutral)
    signal, and no choppy/overbought/oversold/volatility red flags.
  - `"caution"` — a trade is offered, but `tradeSetup.riskComment` explains
    a specific concern (e.g. elevated ATR) worth sizing down for.
  - `"wait"` — timeframes disagree, momentum is stretched against the bias,
    or the market is choppy/ranging (low ADX). `tradeSetup` will have
    `direction`, `entryZone`, `stopLoss`, and `takeProfits` all `null`.
  - `"no_trade"` — the weighted score is too close to neutral; there's no
    directional edge to act on at all.

- **`tradeSetup`** (only populated for `enter`/`caution`) gives an
  entry-zone / SL / TP ladder in the format:
  ```
  @4593-4589        <- entryZone.label (high-low band around current price)
  SL: 4583          <- stopLoss (structure + ATR based)
  TP: 4600  TP: 4610  TP: 4620  TP: Open   <- takeProfits[0..2], then "runner: open"
  ```
  `takeProfits` are 1R / 2R / 3R from the entry midpoint, where R = distance
  to the stop. `runner: "open"` means: beyond TP3, let the remaining
  position ride and trail the stop rather than capping it with a fixed
  final target — the same "TP: Open" convention many discretionary traders
  use.

When `risk.action` is `"wait"` or `"no_trade"`, treat that response as
**do not enter right now** — the reasoning is in `risk.comment` and is also
appended to the top-level `notes` array.

### `GET /api/signals/status`
Shows how many high-confidence alert emails have gone out in the last 24
hours, the configured quota/cooldown, and when the last one was sent.
Useful for confirming the alert system is working without waiting for a
real signal.

## High-confidence email alerts

Separate from the 15-min analysis refresh, every cycle is also checked
against a stricter bar (`lib/confidence.js`) before anything gets emailed:

- `risk.action` must be `"enter"` (no wait/caution/no-trade flags at all)
- all three timeframes must agree on direction
- the weighted score must be strongly one-sided (`|score| >= 50`)
- both 1H and 1D must be actively trending (ADX-based), not choppy

This is intentionally stricter than what qualifies for the JSON
`tradeSetup` — it's built for someone who wants to be notified only when
you'd want to be, not every time a marginal setup appears.

To keep it from spamming you:
- **Max 2 emails per rolling 24 hours** (hard-capped even if you set
  `SIGNAL_MAX_PER_DAY` higher)
- **At least 3 hours between emails**, so a single lingering trend that
  keeps re-qualifying every 15 minutes doesn't burn both of your daily
  slots on the same setup — the two slots stay available for genuinely
  distinct opportunities that day

Note: the daily counter lives in memory, so a Railway restart/redeploy
resets it. For a service on a 15-min cadence this is a minor edge case,
not something to design around.

## Notes & limitations

- This is a **rules-based technical analysis engine**, not a black-box ML
  model — every score component is inspectable in the response
  (`scoreBreakdown` per timeframe) so you can see exactly why a bias was
  reached.
- It does not place trades — it's read-only analysis, on purpose, since you
  asked for analysis rather than execution.
- Free-tier data has a small delay; don't treat this as a tick-level
  execution feed.
- All output includes a disclaimer field — this is informational only,
  not financial advice.
