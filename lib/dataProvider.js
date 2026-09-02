/**
 * lib/dataProvider.js
 *
 * Fetches OHLC candles for XAU/USD from Twelve Data (https://twelvedata.com).
 * Free tier: 800 requests/day, 8 requests/minute — comfortably covers an
 * hourly refresh of 3 timeframes (72 requests/day) plus occasional
 * on-demand refreshes.
 *
 * Twelve Data was chosen because:
 *  - it has a direct XAU/USD (spot gold vs USD) symbol, unlike most
 *    stock-only free APIs
 *  - it supports 15min / 1h / 1day intervals on the free tier
 *  - no credit card required to get an API key
 *
 * If you'd rather pull ticks straight from your fxtrading.com MT4/MT5
 * account instead of a third-party feed, swap this file for a client
 * that talks to a MetaApi (metaapi.cloud) connection — the rest of the
 * system only depends on the `{ time, open, high, low, close }[]` shape
 * returned by getCandles(), so nothing else needs to change.
 */

const axios = require('axios');

const BASE_URL = 'https://api.twelvedata.com/time_series';

const INTERVAL_MAP = {
  '15m': '15min',
  '1h': '1h',
  '1d': '1day',
};

async function getCandles(timeframe, outputsize = 300) {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    throw new Error('TWELVEDATA_API_KEY is not set in the environment.');
  }
  const interval = INTERVAL_MAP[timeframe];
  if (!interval) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  const response = await axios.get(BASE_URL, {
    params: {
      symbol: 'XAU/USD',
      interval,
      outputsize,
      order: 'ASC',
      apikey: apiKey,
    },
    timeout: 15000,
  });

  const data = response.data;
  if (data.status === 'error') {
    throw new Error(`Twelve Data error: ${data.message}`);
  }
  if (!data.values) {
    throw new Error('Twelve Data returned no values (check symbol/interval/API key).');
  }

  return data.values
    .map((v) => ({
      time: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
}

module.exports = { getCandles };
