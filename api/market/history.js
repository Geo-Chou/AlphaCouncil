const HISTORY_KEY = process.env.MARKET_HISTORY_KEY || 'alphacouncil:market-history:xauusd';
const HISTORY_LIMIT = Number(process.env.MARKET_HISTORY_LIMIT || 1000);

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

async function redisCommand(command) {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    const error = new Error('未配置持久化存储。请配置 Vercel KV 或 Upstash Redis 的 KV_REST_API_URL/KV_REST_API_TOKEN');
    error.code = 'STORAGE_NOT_CONFIGURED';
    throw error;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error(`KV 请求失败: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(`KV 命令失败: ${data.error}`);
  }
  return data.result;
}

async function readHistory() {
  const raw = await redisCommand(['GET', HISTORY_KEY]);
  if (!raw) return [];
  const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(items) ? items.sort((a, b) => b.timestamp - a.timestamp) : [];
}

async function writeHistory(items) {
  await redisCommand(['SET', HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT))]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const items = await readHistory();
      return res.json({ success: true, configured: true, items });
    }

    if (req.method === 'POST') {
      const snapshot = req.body?.snapshot;
      if (!snapshot?.marketData?.price || !snapshot?.symbol) {
        return res.status(400).json({ success: false, error: '缺少有效行情快照' });
      }

      const history = await readHistory();
      const withoutDuplicate = history.filter(item =>
        item.id !== snapshot.id &&
        Math.abs((item.marketData?.timestamp || item.timestamp) - (snapshot.marketData?.timestamp || snapshot.timestamp)) > 60_000
      );
      const next = [snapshot, ...withoutDuplicate].slice(0, HISTORY_LIMIT);
      await writeHistory(next);
      return res.json({ success: true, configured: true, item: snapshot, count: next.length });
    }

    if (req.method === 'DELETE') {
      await writeHistory([]);
      return res.json({ success: true, configured: true, items: [] });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    if (error.code === 'STORAGE_NOT_CONFIGURED') {
      return res.status(req.method === 'GET' ? 200 : 503).json({
        success: req.method === 'GET',
        configured: false,
        items: [],
        error: error.message
      });
    }

    console.error('[Market History] 请求失败:', error);
    return res.status(500).json({
      success: false,
      configured: true,
      error: error instanceof Error ? error.message : '行情历史服务错误'
    });
  }
}
