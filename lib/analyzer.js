/**
 * lib/analyzer.js
 *
 * Runs the full classical TA toolkit against a single timeframe's
 * candles and produces a structured, scored summary:
 *   -100 (strongly bearish) .. 0 (neutral) .. +100 (strongly bullish)
 *
 * The score blends:
 *   - trend structure (Dow Theory: HH/HL vs LH/LL)   weight 30
 *   - moving average alignment (20/50/200 EMA)        weight 20
 *   - momentum (RSI + MACD)                           weight 25
 *   - volatility / mean-reversion (Bollinger position) weight 10
 *   - candlestick pattern confirmation                weight 15
 */

const { sma, ema, rsi, macd, bollingerBands, atr, stochastic, adx } = require('./indicators');
const { findSwings, classifyTrend, findSupportResistance } = require('./trend');
const { detectPatterns } = require('./patterns');
const { computeFibLevels } = require('./fibonacci');

function last(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function scoreTrend(trendInfo) {
  switch (trendInfo.trend) {
    case 'uptrend':
      return 30;
    case 'weak_uptrend':
      return 15;
    case 'downtrend':
      return -30;
    case 'weak_downtrend':
      return -15;
    default:
      return 0;
  }
}

function scoreMAs(closes, ema20, ema50, ema200, price) {
  let score = 0;
  const e20 = last(ema20);
  const e50 = last(ema50);
  const e200 = last(ema200);
  if (e20 != null && e50 != null) {
    score += e20 > e50 ? 10 : -10;
  }
  if (e50 != null && e200 != null) {
    score += e50 > e200 ? 10 : -10;
  } else if (e20 != null && price != null) {
    // fallback if not enough bars for EMA200 yet
    score += price > e20 ? 5 : -5;
  }
  return score;
}

function scoreMomentum(rsiVal, macdHist) {
  let score = 0;
  if (rsiVal != null) {
    if (rsiVal >= 70) score -= 8; // overbought caution
    else if (rsiVal <= 30) score += 8; // oversold caution (bullish reversal risk)
    else if (rsiVal > 55) score += 10;
    else if (rsiVal < 45) score -= 10;
  }
  if (macdHist != null) {
    score += macdHist > 0 ? 15 : -15;
  }
  return score;
}

function scoreBollinger(price, bb) {
  const upper = last(bb.upper);
  const lower = last(bb.lower);
  const middle = last(bb.middle);
  if (upper == null || lower == null || middle == null) return 0;
  if (price >= upper) return -10; // stretched, mean-reversion risk down
  if (price <= lower) return 10; // stretched, mean-reversion risk up
  if (price > middle) return 4;
  if (price < middle) return -4;
  return 0;
}

function scorePatterns(patterns) {
  let score = 0;
  for (const p of patterns) {
    if (p.bias === 'bullish') score += 15;
    if (p.bias === 'bearish') score -= 15;
  }
  return Math.max(-15, Math.min(15, score));
}

function classify(score) {
  if (score >= 40) return 'strong_bullish';
  if (score >= 15) return 'bullish';
  if (score <= -40) return 'strong_bearish';
  if (score <= -15) return 'bearish';
  return 'neutral';
}

function analyzeTimeframe(timeframe, candles) {
  if (!candles || candles.length < 30) {
    throw new Error(`Not enough candles for ${timeframe} analysis (need >=30, got ${candles?.length || 0}).`);
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const price = closes[closes.length - 1];

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const macdRes = macd(closes, 12, 26, 9);
  const bb = bollingerBands(closes, 20, 2);
  const atr14 = atr(highs, lows, closes, 14);
  const stoch = stochastic(highs, lows, closes, 14, 3);
  const adxRes = adx(highs, lows, closes, 14);

  const swings = findSwings(candles, 2);
  const trendInfo = classifyTrend(swings);
  const sr = findSupportResistance(swings, price);
  const patterns = detectPatterns(candles);
  const fib = computeFibLevels(candles, Math.min(candles.length, 80));

  const trendScore = scoreTrend(trendInfo);
  const maScore = scoreMAs(closes, ema20, ema50, ema200, price);
  const momentumScore = scoreMomentum(last(rsi14), last(macdRes.histogram));
  const bbScore = scoreBollinger(price, bb);
  const patternScore = scorePatterns(patterns);

  const totalScore = Math.max(
    -100,
    Math.min(100, trendScore + maScore + momentumScore + bbScore + patternScore)
  );

  return {
    timeframe,
    price: Number(price.toFixed(3)),
    lastUpdated: candles[candles.length - 1].time,
    trend: {
      structure: trendInfo.trend,
      lastSwingHighs: trendInfo.lastSwingHighs.map((s) => ({ price: s.price, time: s.time })),
      lastSwingLows: trendInfo.lastSwingLows.map((s) => ({ price: s.price, time: s.time })),
      adx: last(adxRes.adx) != null ? Number(last(adxRes.adx).toFixed(2)) : null,
      trendStrength:
        last(adxRes.adx) == null ? 'unknown' : last(adxRes.adx) >= 25 ? 'trending' : 'choppy/range',
    },
    movingAverages: {
      ema20: last(ema20) != null ? Number(last(ema20).toFixed(3)) : null,
      ema50: last(ema50) != null ? Number(last(ema50).toFixed(3)) : null,
      ema200: last(ema200) != null ? Number(last(ema200).toFixed(3)) : null,
      priceVsEma20: last(ema20) != null ? (price > last(ema20) ? 'above' : 'below') : null,
    },
    momentum: {
      rsi14: last(rsi14) != null ? Number(last(rsi14).toFixed(2)) : null,
      rsiState:
        last(rsi14) == null ? null : last(rsi14) >= 70 ? 'overbought' : last(rsi14) <= 30 ? 'oversold' : 'neutral',
      macdHistogram: last(macdRes.histogram) != null ? Number(last(macdRes.histogram).toFixed(4)) : null,
      macdState: last(macdRes.histogram) == null ? null : last(macdRes.histogram) > 0 ? 'bullish' : 'bearish',
      stochasticK: last(stoch.k) != null ? Number(last(stoch.k).toFixed(2)) : null,
      stochasticD: last(stoch.d) != null ? Number(last(stoch.d).toFixed(2)) : null,
    },
    volatility: {
      atr14: last(atr14) != null ? Number(last(atr14).toFixed(3)) : null,
      bollingerUpper: last(bb.upper) != null ? Number(last(bb.upper).toFixed(3)) : null,
      bollingerMiddle: last(bb.middle) != null ? Number(last(bb.middle).toFixed(3)) : null,
      bollingerLower: last(bb.lower) != null ? Number(last(bb.lower).toFixed(3)) : null,
    },
    supportResistance: sr,
    fibonacci: fib,
    candlestickPatterns: patterns,
    score: totalScore,
    signal: classify(totalScore),
    scoreBreakdown: {
      trend: trendScore,
      movingAverages: maScore,
      momentum: momentumScore,
      bollinger: bbScore,
      patterns: patternScore,
    },
  };
}

module.exports = { analyzeTimeframe };
