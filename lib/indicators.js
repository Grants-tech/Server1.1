/**
 * lib/indicators.js
 *
 * Pure-JS implementations of the core indicators covered in classical
 * technical analysis (Murphy: moving averages, oscillators, volatility
 * bands). No native bindings -> safe to deploy on Railway without a
 * custom build step.
 *
 * All functions take/return plain arrays aligned to the input candle
 * array (padded with `null` where a value cannot yet be computed).
 */

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (prev == null) {
      // seed with SMA of first `period` values
      if (i >= period - 1) {
        const slice = values.slice(i - period + 1, i + 1);
        prev = slice.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= period) {
      gainSum += gain;
      lossSum += loss;
      if (i === period) {
        let avgGain = gainSum / period;
        let avgLoss = lossSum / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
        out._avgGain = avgGain;
        out._avgLoss = avgLoss;
      }
      continue;
    }

    const prevAvgGain = out._avgGain;
    const prevAvgLoss = out._avgLoss;
    const avgGain = (prevAvgGain * (period - 1) + gain) / period;
    const avgLoss = (prevAvgLoss * (period - 1) + loss) / period;
    out._avgGain = avgGain;
    out._avgLoss = avgLoss;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  delete out._avgGain;
  delete out._avgLoss;
  return out;
}

function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
  );
  // signal = EMA of macdLine, but ema() expects no leading nulls mixed in,
  // so we build it manually starting once macdLine is available.
  const firstValid = macdLine.findIndex((v) => v != null);
  const signalLine = new Array(closes.length).fill(null);
  if (firstValid !== -1) {
    const k = 2 / (signalPeriod + 1);
    let prev = null;
    for (let i = firstValid; i < macdLine.length; i++) {
      if (prev == null) {
        if (i - firstValid >= signalPeriod - 1) {
          const slice = macdLine.slice(i - signalPeriod + 1, i + 1);
          prev = slice.reduce((a, b) => a + b, 0) / signalPeriod;
          signalLine[i] = prev;
        }
      } else {
        prev = macdLine[i] * k + prev * (1 - k);
        signalLine[i] = prev;
      }
    }
  }
  const histogram = closes.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? macdLine[i] - signalLine[i] : null
  );
  return { macdLine, signalLine, histogram };
}

function bollingerBands(closes, period = 20, stdDevMult = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (middle[i] == null) continue;
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdDevMult * sd;
    lower[i] = mean - stdDevMult * sd;
  }
  return { upper, middle, lower };
}

function atr(highs, lows, closes, period = 14) {
  const tr = new Array(highs.length).fill(null);
  for (let i = 0; i < highs.length; i++) {
    if (i === 0) {
      tr[i] = highs[i] - lows[i];
      continue;
    }
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  // Wilder's smoothing
  const out = new Array(highs.length).fill(null);
  let prevAtr = null;
  for (let i = 0; i < tr.length; i++) {
    if (i === period - 1) {
      const slice = tr.slice(0, period);
      prevAtr = slice.reduce((a, b) => a + b, 0) / period;
      out[i] = prevAtr;
    } else if (i >= period) {
      prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
      out[i] = prevAtr;
    }
  }
  return out;
}

function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) continue;
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    k[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  const d = sma(k.map((v) => (v == null ? NaN : v)), dPeriod).map((v, i) =>
    Number.isNaN(v) ? null : v
  );
  return { k, d };
}

function adx(highs, lows, closes, period = 14) {
  const len = highs.length;
  const plusDM = new Array(len).fill(0);
  const minusDM = new Array(len).fill(0);
  const tr = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }

  const smooth = (arr) => {
    const out = new Array(len).fill(null);
    let prev = null;
    for (let i = 0; i < len; i++) {
      if (i === period) {
        prev = arr.slice(1, period + 1).reduce((a, b) => a + b, 0);
        out[i] = prev;
      } else if (i > period) {
        prev = prev - prev / period + arr[i];
        out[i] = prev;
      }
    }
    return out;
  };

  const smTR = smooth(tr);
  const smPlusDM = smooth(plusDM);
  const smMinusDM = smooth(minusDM);

  const plusDI = new Array(len).fill(null);
  const minusDI = new Array(len).fill(null);
  const dx = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    if (smTR[i] == null || smTR[i] === 0) continue;
    plusDI[i] = (smPlusDM[i] / smTR[i]) * 100;
    minusDI[i] = (smMinusDM[i] / smTR[i]) * 100;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (Math.abs(plusDI[i] - minusDI[i]) / sum) * 100;
  }

  const adxOut = new Array(len).fill(null);
  const validDx = dx.filter((v) => v != null);
  const firstDxIdx = dx.findIndex((v) => v != null);
  if (firstDxIdx !== -1 && dx.length - firstDxIdx >= period) {
    let prevAdx = dx
      .slice(firstDxIdx, firstDxIdx + period)
      .reduce((a, b) => a + b, 0) / period;
    adxOut[firstDxIdx + period - 1] = prevAdx;
    for (let i = firstDxIdx + period; i < len; i++) {
      if (dx[i] == null) continue;
      prevAdx = (prevAdx * (period - 1) + dx[i]) / period;
      adxOut[i] = prevAdx;
    }
  }

  return { adx: adxOut, plusDI, minusDI };
}

module.exports = { sma, ema, rsi, macd, bollingerBands, atr, stochastic, adx };
