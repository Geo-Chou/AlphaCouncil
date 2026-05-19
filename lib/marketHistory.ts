import { AgentRole, GoldRealtimeData, MarketSnapshot, WorkflowState } from '../types';

function getDecisionFromOutput(output?: string) {
  if (!output) return '分析中';
  if (output.includes('买入')) return '买入';
  if (output.includes('卖出')) return '卖出';
  if (output.includes('观望')) return '观望';
  return '分析中';
}

async function requestHistory<T>(path = '', init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/market/history${path}`, init);
  const data = await response.json();
  if (!response.ok || data.success === false) {
    throw new Error(data.error || '行情历史服务不可用');
  }
  return data as T;
}

export async function getMarketHistory(): Promise<MarketSnapshot[]> {
  const data = await requestHistory<{ success: boolean; items: MarketSnapshot[] }>();
  return data.items || [];
}

export async function saveMarketSnapshot(state: WorkflowState, marketData: GoldRealtimeData) {
  const gmOutput = state.outputs[AgentRole.GM];
  const snapshot: MarketSnapshot = {
    id: `${marketData.symbol}-${marketData.timestamp}-${Date.now()}`,
    symbol: marketData.symbol,
    timestamp: Date.now(),
    marketData,
    gmDecision: getDecisionFromOutput(gmOutput),
    gmOutput
  };

  await requestHistory('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot })
  });
}

export async function clearMarketHistory() {
  await requestHistory('', { method: 'DELETE' });
}
