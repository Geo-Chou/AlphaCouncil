import fetch from 'node-fetch';

const PRIMARY_API_URL = process.env.GOLD_PRICE_API_URL;
const PRIMARY_API_KEY = process.env.GOLD_PRICE_API_KEY;
const TWELVE_DATA_API_KEY = process.env.TWELVE_DATA_API_KEY;
const USD_CNY = Number(process.env.USD_CNY || process.env.NEXT_PUBLIC_USD_CNY);

const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';
const TWELVE_DATA_INTERVALS = ['15min', '1h', '4h', '1day'];
const TWELVE_DATA_OUTPUT_SIZE = 200;
const CACHE_TTL_MS = 14 * 60 * 1000;
const MARKET_CACHE = globalThis.__ALPHACOUNCIL_MARKET_CACHE__ || new Map();
globalThis.__ALPHACOUNCIL_MARKET_CACHE__ = MARKET_CACHE;
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=1d';

function normalizeSymbol(symbol = '') {
  const raw = String(symbol).trim().toUpperCase().replace(/[^A-Z0-9/=.-]/g, '');
  if (!raw || raw === 'GOLD' || raw === 'XAU' || raw === 'XAU/USD') return 'XAUUSD';
  return raw;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function withCnReference(data) {
  const usdcny = toNumber(data.usdcny) || (Number.isFinite(USD_CNY) ? USD_CNY : undefined);
  if (!usdcny || !Number.isFinite(data.price)) return data;

  return {
    ...data,
    cnReference: {
      usdcny,
      cnyPerOunce: data.price * usdcny,
      cnyPerGram: (data.price * usdcny) / 31.1034768
    }
  };
}

function normalizeCandle(candle) {
  return {
    datetime: candle.datetime,
    open: toNumber(candle.open),
    high: toNumber(candle.high),
    low: toNumber(candle.low),
    close: toNumber(candle.close)
  };
}

function readCache(key) {
  const cached = MARKET_CACHE.get(key);
  if (!cached || Date.now() - cached.timestamp > CACHE_TTL_MS) return null;
  return cached.data;
}

function writeCache(key, data) {
  MARKET_CACHE.set(key, { timestamp: Date.now(), data });
}

function normalizeProviderPayload(payload, source) {
  const price =
    toNumber(payload.price) ??
    toNumber(payload.close) ??
    toNumber(payload.rate) ??
    toNumber(payload.bid) ??
    toNumber(payload.mid);

  if (!Number.isFinite(price)) {
    throw new Error('行情源返回缺少 price/close/rate 字段');
  }

  const previousClose = toNumber(payload.previousClose) ?? toNumber(payload.prevClose);
  const change = toNumber(payload.change) ?? (Number.isFinite(previousClose) ? price - previousClose : 0);
  const changePercent =
    toNumber(payload.changePercent) ??
    toNumber(payload.change_percent) ??
    (Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : 0);

  return withCnReference({
    symbol: 'XAUUSD',
    name: 'Gold Spot / 黄金现货',
    price,
    currency: payload.currency || 'USD',
    unit: payload.unit || 'oz',
    change,
    changePercent,
    open: toNumber(payload.open),
    previousClose,
    high: toNumber(payload.high),
    low: toNumber(payload.low),
    bid: toNumber(payload.bid),
    ask: toNumber(payload.ask),
    timestamp: toNumber(payload.timestamp) || Date.now(),
    source,
    sourceNote: payload.sourceNote,
    usdcny: toNumber(payload.usdcny)
  });
}

async function fetchPrimaryProvider(symbol, apiKey) {
  if (!PRIMARY_API_URL) return null;

  const url = new URL(PRIMARY_API_URL);
  url.searchParams.set('symbol', symbol);
  if (PRIMARY_API_KEY || apiKey) {
    url.searchParams.set('apikey', PRIMARY_API_KEY || apiKey);
  }

  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`自定义黄金行情源错误: ${response.status}`);
  }

  const payload = await response.json();
  const data = payload.data || payload.result || payload;
  return normalizeProviderPayload(data, 'Custom Gold Provider');
}

async function fetchTwelveDataGold(apiKey) {
  const effectiveApiKey = TWELVE_DATA_API_KEY || apiKey;
  if (!effectiveApiKey) return null;

  const cacheKey = `twelvedata:XAU/USD:${effectiveApiKey.slice(-6)}`;
  const cached = readCache(cacheKey);
  if (cached) return { ...cached, sourceNote: `${cached.sourceNote}; cache ${Math.round(CACHE_TTL_MS / 60000)}min` };

  const quoteUrl = new URL(`${TWELVE_DATA_BASE_URL}/quote`);
  quoteUrl.searchParams.set('symbol', 'XAU/USD');
  quoteUrl.searchParams.set('apikey', effectiveApiKey);

  const timeSeriesUrls = TWELVE_DATA_INTERVALS.map(interval => {
    const url = new URL(`${TWELVE_DATA_BASE_URL}/time_series`);
    url.searchParams.set('symbol', 'XAU/USD');
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(TWELVE_DATA_OUTPUT_SIZE));
    url.searchParams.set('apikey', effectiveApiKey);
    return { interval, url };
  });

  const [quoteResponse, ...timeSeriesResponses] = await Promise.all([
    fetch(quoteUrl.toString(), { headers: { Accept: 'application/json' } }),
    ...timeSeriesUrls.map(({ url }) => fetch(url.toString(), { headers: { Accept: 'application/json' } }))
  ]);

  if (!quoteResponse.ok) {
    throw new Error(`Twelve Data quote 错误: ${quoteResponse.status}`);
  }

  const quote = await quoteResponse.json();
  if (quote.status === 'error' || quote.code) {
    throw new Error(`Twelve Data quote 错误: ${quote.message || quote.code}`);
  }

  const candleSeries = {};
  for (let index = 0; index < timeSeriesResponses.length; index += 1) {
    const response = timeSeriesResponses[index];
    const interval = timeSeriesUrls[index].interval;
    if (!response.ok) continue;

    const timeSeries = await response.json();
    if (timeSeries.status !== 'error' && Array.isArray(timeSeries.values)) {
      candleSeries[interval] = timeSeries.values.map(normalizeCandle).filter(candle =>
        candle.datetime &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
      );
    }
  }
  const candles = candleSeries['15min'] || [];

  const price = toNumber(quote.close) ?? toNumber(quote.price);
  const previousClose = toNumber(quote.previous_close);
  const change = toNumber(quote.change) ?? (Number.isFinite(previousClose) && Number.isFinite(price) ? price - previousClose : 0);
  const changePercent = toNumber(quote.percent_change) ?? (Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : 0);

  if (!Number.isFinite(price)) {
    throw new Error('Twelve Data 返回缺少 close/price 字段');
  }

  const data = withCnReference({
    symbol: 'XAUUSD',
    name: quote.name || 'Gold Spot / 黄金现货',
    price,
    currency: 'USD',
    unit: 'oz',
    change,
    changePercent,
    open: toNumber(quote.open),
    previousClose,
    high: toNumber(quote.high),
    low: toNumber(quote.low),
    bid: toNumber(quote.bid),
    ask: toNumber(quote.ask),
    timestamp: quote.datetime ? Date.parse(`${quote.datetime}Z`) : Date.now(),
    source: 'Twelve Data',
    sourceNote: `XAU/USD quote + time_series ${TWELVE_DATA_INTERVALS.join('/')} (${Object.values(candleSeries).reduce((total, list) => total + list.length, 0)} candles)`,
    candles,
    candleSeries,
    creditsEstimate: 1 + TWELVE_DATA_INTERVALS.length
  });
  writeCache(cacheKey, data);
  return data;
}

async function fetchYahooGold() {
  const response = await fetch(YAHOO_CHART_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AlphaCouncil/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance 行情错误: ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];

  if (!meta || !Number.isFinite(meta.regularMarketPrice)) {
    throw new Error('Yahoo Finance 返回缺少 regularMarketPrice');
  }

  const previousClose = toNumber(meta.previousClose) ?? closes.filter(Number.isFinite).at(-2);
  const price = meta.regularMarketPrice;
  const change = Number.isFinite(previousClose) ? price - previousClose : 0;
  const changePercent = Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : 0;

  return withCnReference({
    symbol: 'XAUUSD',
    name: 'Gold Spot / 黄金现货',
    price,
    currency: 'USD',
    unit: 'oz',
    change,
    changePercent,
    open: toNumber(meta.regularMarketOpen) ?? quote?.open?.filter(Number.isFinite).at(-1),
    previousClose,
    high: toNumber(meta.regularMarketDayHigh) ?? quote?.high?.filter(Number.isFinite).at(-1),
    low: toNumber(meta.regularMarketDayLow) ?? quote?.low?.filter(Number.isFinite).at(-1),
    bid: toNumber(meta.bid),
    ask: toNumber(meta.ask),
    timestamp: (toNumber(meta.regularMarketTime) || timestamps.at(-1) || Date.now() / 1000) * 1000,
    source: 'Yahoo Finance',
    sourceNote: 'GC=F 期货近月合约代理 XAUUSD，生产环境建议配置 TWELVE_DATA_API_KEY 使用 XAU/USD 授权现货源'
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const symbol = normalizeSymbol(req.method === 'GET' ? req.query.symbol : req.body?.symbol || req.query.symbol);
  const apiKey = req.method === 'GET'
    ? req.query.twelveDataApiKey || req.query.apiKey
    : req.body?.twelveDataApiKey || req.body?.apiKey;

  if (!['XAUUSD', 'GC=F'].includes(symbol)) {
    return res.status(400).json({
      success: false,
      error: '当前黄金决策系统仅支持 XAUUSD / GOLD'
    });
  }

  try {
    const data = (await fetchTwelveDataGold(apiKey)) || (await fetchPrimaryProvider(symbol, apiKey)) || (await fetchYahooGold());
    return res.json({ success: true, data });
  } catch (error) {
    console.error('获取黄金行情失败:', error);
    return res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : '黄金行情源不可用'
    });
  }
}
