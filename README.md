# AlphaCouncil AI - 多智能体黄金买卖决策系统

AlphaCouncil AI 是一个面向黄金交易的多智能体决策系统。系统以 `XAUUSD` 作为核心锚点，结合美元、美债利率、通胀、避险需求、央行购金、ETF/期货资金、技术位和国内交易执行约束，输出买入、观望或卖出的最终方案。

## 核心特性

- **XAUUSD 主数据源**：优先使用 Twelve Data `XAU/USD`，通过 Vercel Serverless Function 代理行情，前端只访问本站 `/api/market/xauusd`。
- **国内交易者视角**：提示词会强制考虑银行金、上海金、黄金 ETF、纸黄金或合规平台开户品种的点差、汇率、滑点和交易时段。
- **多模型协作**：默认使用 DeepSeek + Gemini。DeepSeek 负责交易、风控和最终决策，Gemini 负责宏观、市场结构和资金情绪等带搜索能力的视角。
- **长期留存**：行情快照和AI决策可写入 Vercel KV / Upstash Redis，用于后续长期分析和图表标记。
- **决策同步**：历史决策记录包含当时价格、AI输出和决策方向，配置 KV 后可跨浏览器同步。
- **四阶段决策流**：5 个分析师并行分析，2 个总监整合，2 个风控审核，1 个总经理给最终指令。
- **Vercel 可部署**：保留 `vercel.json`，API route 位于 `api/market/[symbol].js` 和 `api/ai/*`。

## 智能体架构

| 阶段 | 角色 | 职责 |
| --- | --- | --- |
| 分析师 | 全球宏观利率分析师 | 美元、实际利率、通胀、央行政策、避险需求 |
| 分析师 | 黄金市场结构分析师 | 央行购金、ETF、COMEX、伦敦盘、实物需求 |
| 分析师 | XAUUSD 技术分析专家 | 趋势、支撑压力、入场、止损、止盈 |
| 分析师 | 全球资金情绪分析师 | ETF、期货、美元流动性、欧美盘节奏 |
| 分析师 | 黄金公允价值分析师 | 实际利率、美元、风险溢价、人民币换算价 |
| 总监 | 黄金基本面研究总监 | 整合宏观、结构、公允价值 |
| 总监 | 黄金动能交易总监 | 整合技术和资金，判断可交易性 |
| 风控 | 系统性风险总监 | 利率、美元、流动性、平台合规风险 |
| 风控 | 交易组合风险总监 | 仓位、分批、止损、国内渠道约束 |
| 决策 | 黄金交易决策总经理 | 给出唯一买入/观望/卖出指令 |

## 行情数据配置

推荐直接使用 Twelve Data。后端会同时请求 `quote` 实时价格和 `time_series` 多周期K线：

```bash
TWELVE_DATA_API_KEY=你的_Twelve_Data_API_Key
TWELVE_DATA_FX_SYMBOL=USD/CNH
USD_CNY=7.20
```

当前封装的请求：

```text
GET https://api.twelvedata.com/quote?symbol=XAU/USD&apikey=你的API_KEY
GET https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=15min&outputsize=200&apikey=你的API_KEY
GET https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1h&outputsize=200&apikey=你的API_KEY
GET https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=4h&outputsize=200&apikey=你的API_KEY
GET https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1day&outputsize=200&apikey=你的API_KEY
GET https://api.twelvedata.com/quote?symbol=USD/CNH&apikey=你的API_KEY
```

一次完整黄金分析约消耗 `6 credits`：黄金 `quote` 1次 + 汇率 `quote` 1次 + 4个K线周期。后端有约14分钟短缓存，适合15分钟级别分析提醒，避免刷新页面重复消耗额度。`USD_CNY` 只作为汇率接口失败时的兜底值。

后端优先级：

1. `TWELVE_DATA_API_KEY` 或前端临时输入的 Twelve Data key
2. 自定义 `GOLD_PRICE_API_URL/GOLD_PRICE_API_KEY`
3. Yahoo Finance `GC=F` 备用代理数据源

如果你后面要换成别的授权行情源，也可以继续配置自定义源：

```bash
GOLD_PRICE_API_URL=https://your-provider.example.com/quote
GOLD_PRICE_API_KEY=你的_黄金行情_API_Key
USD_CNY=7.20
```

自定义 `GOLD_PRICE_API_URL` 需要返回 JSON，并至少包含 `price` 字段。推荐字段：

```json
{
  "price": 4499.7,
  "previousClose": 4566.39,
  "open": 4550.2,
  "high": 4580.1,
  "low": 4478.5,
  "bid": 4499.3,
  "ask": 4500.1,
  "timestamp": 1779177600000,
  "usdcny": 7.2
}
```

国内访问侧的关键点是：浏览器不直接访问海外行情 API，而是访问你的 Vercel 域名；行情请求由 Vercel 函数转发和归一化。

## 长期存储配置

长期行情/分析快照和决策历史不能依赖浏览器缓存。部署到 Vercel 时需要接入 Vercel KV 或 Upstash Redis，并配置：

```bash
KV_REST_API_URL=你的_KV_REST_API_URL
KV_REST_API_TOKEN=你的_KV_REST_API_TOKEN
MARKET_HISTORY_KEY=alphacouncil:market-history:xauusd
MARKET_HISTORY_LIMIT=1000
```

如果你用 Upstash Redis，也可以配置兼容变量：

```bash
UPSTASH_REDIS_REST_URL=你的_Upstash_REST_URL
UPSTASH_REDIS_REST_TOKEN=你的_Upstash_REST_TOKEN
```

未配置 KV 时，系统仍能分析和画当前图表，但不会跨设备、跨浏览器长期保存历史快照和决策历史。

## Vercel 部署

1. 将项目推送到 GitHub。
2. 在 Vercel 导入项目，框架选择 Vite。
3. 配置环境变量：

```bash
DEEPSEEK_API_KEY=你的_DeepSeek_API_Key
GEMINI_API_KEY=你的_Gemini_API_Key
TWELVE_DATA_API_KEY=你的_Twelve_Data_API_Key
TWELVE_DATA_FX_SYMBOL=USD/CNH
GOLD_PRICE_API_URL=你的_黄金行情源_URL
GOLD_PRICE_API_KEY=你的_黄金行情_Key
USD_CNY=7.20
KV_REST_API_URL=你的_KV_REST_API_URL
KV_REST_API_TOKEN=你的_KV_REST_API_TOKEN
MARKET_HISTORY_KEY=alphacouncil:market-history:xauusd
MARKET_HISTORY_LIMIT=1000
```

4. 部署后访问页面，输入 `XAUUSD` 或 `GOLD`，点击启动系统。

## 本地开发

```bash
npm install
npm run dev
```

## 使用说明

- 输入标的：`XAUUSD`、`GOLD`、`XAU`、`XAU/USD` 或 `GC=F`。
- API 密钥面板可临时输入模型或行情 key；生产环境更推荐放在 Vercel 环境变量中。
- 最终输出会包含仓位、入场/离场区间、止损、止盈/减仓、国内执行方案和失效条件。
- 图表历史曲线来自 Twelve Data `time_series`；AI关键价位来自最新决策文本；历史决策点来自 KV 中保存的分析快照。
- 图表底部 Brush 可拖动和缩放，用于查看局部行情区间。

## 免责声明

系统输出仅用于技术研究与辅助分析，不构成投资建议。黄金、外汇、期货、ETF 和相关衍生品均存在本金亏损风险；国内用户还需要自行确认交易渠道、平台资质、资金出入金、税费和合规要求。
