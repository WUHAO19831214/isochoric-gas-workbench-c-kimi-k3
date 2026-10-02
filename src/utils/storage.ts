/**
 * 会话持久化：防止课堂误刷新丢失实验数据。
 * 仅保存最近一次实验 session 到 localStorage（无服务器、无隐私外发）。
 */

import type { ExperimentSession } from '../types';

const KEY = 'isochoric-gas-session-v1';

export function saveSession(session: ExperimentSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // 存储满或隐私模式下静默失败，不影响实验主流程
  }
}

export function loadSession(): ExperimentSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExperimentSession;
    if (parsed?.version !== 1 || !Array.isArray(parsed.points)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSavedSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
