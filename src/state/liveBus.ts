/**
 * 高频实时数据总线（OCR 2 Hz 读数、模拟温度等）。
 * 与 React 状态分离：OCR/动画频率远高于实验记录频率，
 * 直接放进 React state 会造成不必要的整树重渲染。
 *
 * 重要设计：reading（OCR 读数）与 sim（驱动微观模型的数值）是两个
 * 独立的通知通道。同步显示 = 订阅 reading → 回写 sim；若共用同一通道，
 * 回写会再次触发订阅者形成递归（实测导致调用栈溢出）。
 */

import type { LiveReading } from '../types';

export interface LiveSnapshot {
  reading: LiveReading;
  /** 当前驱动微观模型的温度（K）；null 表示未同步 */
  simTemperatureK: number | null;
  /** 当前压强（用于 HUD，可能为 null） */
  simPressureKPa: number | null;
}

type Listener = () => void;

const initialReading: LiveReading = {
  pressureKPa: null,
  temperatureK: null,
  pressureConfidence: 0,
  temperatureConfidence: 0,
  pressureRaw: '',
  temperatureRaw: '',
  status: 'idle',
  updatedAt: 0,
};

class LiveBus {
  private snapshot: LiveSnapshot = {
    reading: initialReading,
    simTemperatureK: null,
    simPressureKPa: null,
  };
  private readingListeners = new Set<Listener>();
  private simListeners = new Set<Listener>();

  get(): LiveSnapshot {
    return this.snapshot;
  }

  setReading(reading: LiveReading): void {
    this.snapshot = { ...this.snapshot, reading };
    for (const l of this.readingListeners) l();
  }

  setSimValues(temperatureK: number | null, pressureKPa: number | null): void {
    if (this.snapshot.simTemperatureK === temperatureK && this.snapshot.simPressureKPa === pressureKPa) return;
    this.snapshot = { ...this.snapshot, simTemperatureK: temperatureK, simPressureKPa: pressureKPa };
    for (const l of this.simListeners) l();
  }

  /** OCR 读数通道（实时读数卡片、同步显示推送） */
  subscribeReading(listener: Listener): () => void {
    this.readingListeners.add(listener);
    return () => this.readingListeners.delete(listener);
  }

  /** 模拟驱动通道（回放 HUD 等） */
  subscribeSim(listener: Listener): () => void {
    this.simListeners.add(listener);
    return () => this.simListeners.delete(listener);
  }
}

/** 全局唯一总线：统一实验时钟/数据源，避免 OCR、摄像头、回放各维护冲突的时间轴 */
export const liveBus = new LiveBus();
