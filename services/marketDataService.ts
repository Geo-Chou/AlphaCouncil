const BACKEND_API_URL = '/api/market';

export interface GoldRealtimeData {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  unit: string;
  change: number;
  changePercent: number;
  open?: number;
  previousClose?: number;
  high?: number;
  low?: number;
  bid?: number;
  ask?: number;
  timestamp: number;
  source: string;
  sourceNote?: string;
  cnReference?: {
    cnyPerOunce?: number;
    cnyPerGram?: number;
    usdcny?: number;
  };
  candles?: Array<{
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  candleSeries?: Record<string, Array<{
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>>;
  creditsEstimate?: number;
}

export async function fetchGoldData(symbol: string, apiKey?: string): Promise<GoldRealtimeData | null> {
  try {
    const response = await fetch(`${BACKEND_API_URL}/${encodeURIComponent(symbol || 'XAUUSD')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, apiKey, twelveDataApiKey: apiKey })
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    return result.success ? result.data : null;
  } catch (error) {
    console.error('[AlphaCouncil] 获取黄金行情失败:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function formatGoldDataForPrompt(data: GoldRealtimeData | null): string {
  if (!data) {
    return '无法获取实时黄金行情数据。请基于最近已知的黄金市场结构进行保守分析，并明确说明数据缺口。';
  }

  const formatPrice = (value?: number) => (Number.isFinite(value) ? value!.toFixed(2) : 'N/A');
  const changePrefix = data.change >= 0 ? '+' : '';
  const timeText = new Date(data.timestamp).toLocaleString('zh-CN', { hour12: false });
  const spread = Number.isFinite(data.bid) && Number.isFinite(data.ask) ? data.ask! - data.bid! : undefined;
  const cn = data.cnReference;
  const candleSeries = data.candleSeries || (data.candles ? { '15min': data.candles } : {});
  const candleText = Object.entries(candleSeries).length
    ? Object.entries(candleSeries)
        .map(([interval, candles]) => {
          const recentCandles = candles.slice(0, 8);
          const lines = recentCandles.map(candle =>
            `${candle.datetime}: O ${formatPrice(candle.open)} / H ${formatPrice(candle.high)} / L ${formatPrice(candle.low)} / C ${formatPrice(candle.close)}`
          );
          return `【${interval}】\n  ${lines.join('\n  ')}`;
        })
        .join('\n  ')
    : '未提供K线数据';

  return `
╔═══════════════════════════════════════════════════════════╗
║             黄金现货行情数据 (XAUUSD / US$/oz)            ║
╚═══════════════════════════════════════════════════════════╝

【标的信息】
  标的名称: ${data.name}
  交易代码: ${data.symbol}
  计价单位: ${data.currency}/${data.unit}
  数据时间: ${timeText}
  数据来源: ${data.source}${data.sourceNote ? ` (${data.sourceNote})` : ''}
  API消耗估算: ${data.creditsEstimate ? `约 ${data.creditsEstimate} credits/次分析` : 'N/A'}

【价格信息】
  当前价格: $${formatPrice(data.price)}
  涨跌金额: ${changePrefix}$${formatPrice(data.change)}
  涨跌幅度: ${changePrefix}${formatPrice(data.changePercent)}%
  开盘价格: $${formatPrice(data.open)}
  前收价格: $${formatPrice(data.previousClose)}
  日内最高: $${formatPrice(data.high)}
  日内最低: $${formatPrice(data.low)}
  买入价/Bid: $${formatPrice(data.bid)}
  卖出价/Ask: $${formatPrice(data.ask)}
  点差: ${Number.isFinite(spread) ? `$${spread!.toFixed(2)}` : 'N/A'}

【多周期K线摘要】（最近数据在前）
  ${candleText}

【国内交易参考】
  适用场景: 国内交易者通常需要把 XAUUSD 作为国际现货黄金锚点，再映射到银行积存金、上海金、黄金ETF、纸黄金或平台开户品种。
  人民币参考: ${cn?.cnyPerGram ? `约 ¥${cn.cnyPerGram.toFixed(2)}/克` : '未提供 USDCNY，无法换算'}
  汇率参考: ${cn?.usdcny ? `USD/CNY ${cn.usdcny.toFixed(4)}` : '未提供'}
  执行约束: 分析必须考虑国内可交易渠道的点差、汇率、交易时段、滑点和平台合规性。

【分析提示】
  重点研判美元指数、美债实际利率、全球央行购金、地缘风险、ETF持仓、COMEX/伦敦盘流动性与技术位。
  输出必须给出买入/观望/卖出、仓位、止损、止盈和国内执行替代方案。
═══════════════════════════════════════════════════════════
  `;
}
