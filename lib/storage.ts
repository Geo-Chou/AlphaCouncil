import { WorkflowState, AnalysisStatus, AgentRole } from '../types';
import { DEFAULT_AGENTS } from '../constants';

const STORAGE_KEY = 'alphacouncil_workflow';
const HISTORY_KEY = 'alphacouncil_history';
const STORAGE_VERSION = 'v2-gold-deepseek';
const DATA_EXPIRY_MS = 30 * 60 * 1000; // 30分钟过期

// 持久化数据结构（排除 apiKeys 和 error）
export interface PersistedState {
  version: string;
  timestamp: number;
  state: Omit<WorkflowState, 'apiKeys' | 'error'>;
}

// 历史记录项
export interface HistoryItem {
  id: string;
  stockSymbol: string;
  status: AnalysisStatus;
  currentStep: number;
  timestamp: number;
  completedAt?: number;
  gmDecision?: string; // 总经理的决策（买入/观望/卖出）
  outputs: Partial<Record<AgentRole, string>>;
}

// 历史记录存储结构
interface HistoryStorage {
  version: string;
  items: HistoryItem[];
}

/**
 * 保存当前状态到 localStorage
 */
export function saveState(state: WorkflowState) {
  const persisted: PersistedState = {
    version: STORAGE_VERSION,
    timestamp: Date.now(),
    state: {
      status: state.status,
      currentStep: state.currentStep,
      stockSymbol: state.stockSymbol,
      stockDataContext: state.stockDataContext,
      currentMarketData: state.currentMarketData,
      outputs: state.outputs,
      agentConfigs: state.agentConfigs,
    }
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

/**
 * 从 localStorage 加载状态
 */
export function loadState(): Partial<WorkflowState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const persisted: PersistedState = JSON.parse(raw);

    // 版本检查
    if (persisted.version !== STORAGE_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // 过期检查
    if (Date.now() - persisted.timestamp > DATA_EXPIRY_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return persisted.state;
  } catch {
    return null;
  }
}

/**
 * 清除当前保存的状态
 */
export function clearState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear state:', e);
  }
}

/**
 * 获取历史记录列表
 */
export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];

    const data: HistoryStorage = JSON.parse(raw);
    if (data.version !== STORAGE_VERSION) {
      localStorage.removeItem(HISTORY_KEY);
      return [];
    }

    // 按时间倒序排列
    return data.items.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * 保存历史记录项
 */
export function saveToHistory(state: WorkflowState) {
  try {
    const history = getHistory();

    // 提取总经理的决策
    const gmOutput = state.outputs[AgentRole.GM] || '';
    let gmDecision = '分析中';
    if (gmOutput.includes('买入')) gmDecision = '买入';
    else if (gmOutput.includes('卖出')) gmDecision = '卖出';
    else if (gmOutput.includes('观望')) gmDecision = '观望';

    const newItem: HistoryItem = {
      id: `${state.stockSymbol}-${Date.now()}`,
      stockSymbol: state.stockSymbol,
      status: state.status,
      currentStep: state.currentStep,
      timestamp: Date.now(),
      completedAt: state.status === AnalysisStatus.COMPLETED ? Date.now() : undefined,
      gmDecision,
      outputs: state.outputs
    };

    // 检查是否已存在相同标的的未完成记录，替换它
    const existingIndex = history.findIndex(
      item => item.stockSymbol === state.stockSymbol && item.status !== AnalysisStatus.COMPLETED
    );

    if (existingIndex >= 0) {
      history[existingIndex] = newItem;
    } else {
      history.unshift(newItem);
    }

    // 只保留最近 50 条记录
    const trimmed = history.slice(0, 50);

    const data: HistoryStorage = {
      version: STORAGE_VERSION,
      items: trimmed
    };

    localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save to history:', e);
  }
}

/**
 * 从历史记录中删除一项
 */
export function deleteFromHistory(id: string) {
  try {
    const history = getHistory();
    const filtered = history.filter(item => item.id !== id);

    const data: HistoryStorage = {
      version: STORAGE_VERSION,
      items: filtered
    };

    localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to delete from history:', e);
  }
}

/**
 * 清空所有历史记录
 */
export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {
    console.warn('Failed to clear history:', e);
  }
}

/**
 * 从历史记录恢复分析结果
 */
export function restoreFromHistory(item: HistoryItem): Partial<WorkflowState> {
  return {
    stockSymbol: item.stockSymbol,
    status: item.status,
    currentStep: item.currentStep,
    outputs: item.outputs,
    stockDataContext: '', // 历史记录不保存实时行情，需要用户重新获取
    currentMarketData: undefined,
    agentConfigs: JSON.parse(JSON.stringify(DEFAULT_AGENTS)), // 使用默认配置
    apiKeys: {}
  };
}

/**
 * 获取初始化状态
 */
export function getInitialState(): WorkflowState {
  const persisted = loadState();
  return {
    status: persisted?.status ?? AnalysisStatus.IDLE,
    currentStep: persisted?.currentStep ?? 0,
    stockSymbol: persisted?.stockSymbol ?? '',
    stockDataContext: persisted?.stockDataContext ?? '',
    currentMarketData: persisted?.currentMarketData,
    outputs: persisted?.outputs ?? {},
    agentConfigs: persisted?.agentConfigs ?? JSON.parse(JSON.stringify(DEFAULT_AGENTS)),
    apiKeys: {} // 始终从用户输入获取
  };
}
