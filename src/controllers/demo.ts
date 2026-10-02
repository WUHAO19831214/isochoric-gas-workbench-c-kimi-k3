/**
 * 演示模式：没有仪器软件/传感器时，用明确标记为 DEMO 的模拟数据驱动完整工作流。
 * 物理上自洽：p = p0 · T / T0（等容、近似理想气体），叠加小幅测量噪声。
 * 模拟数据绝不伪装成真实实验数据：session.demo = true，UI 全程显示 DEMO 标记。
 */

import type { ExperimentSession, DataPoint } from '../types';
import { liveBus } from '../state/liveBus';

const T0 = 293.15;
const P0 = 101.3;

export class DemoFeeder {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;

  /** 以 2 Hz 向 liveBus 推送模拟 OCR 读数（走与真实 OCR 完全相同的下游链路） */
  start(): void {
    this.stop();
    this.startedAt = performance.now();
    this.timer = setInterval(() => {
      const t = (performance.now() - this.startedAt) / 1000;
      const { temperatureK, pressureKPa } = demoValueAt(t);
      liveBus.setReading({
        pressureKPa,
        temperatureK,
        pressureConfidence: 95,
        temperatureConfidence: 96,
        pressureRaw: pressureKPa.toFixed(1),
        temperatureRaw: temperatureK.toFixed(1),
        status: 'ok',
        updatedAt: Date.now(),
      });
    }, 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

/** 演示温度曲线：约 3 分钟内从 293 K 水浴升温至 ~360 K（先快后慢） */
export function demoValueAt(tSec: number): { temperatureK: number; pressureKPa: number } {
  const temperatureK = T0 + 68 * (1 - Math.exp(-tSec / 75)) + gauss() * 0.25;
  const pressureKPa = P0 * (temperatureK / T0) + gauss() * 0.35;
  return { temperatureK, pressureKPa };
}

function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 生成一组完整的演示 session（用于无设备时体验回放/绘图/导出） */
export function buildDemoSession(volumeMl = 100, intervalMs = 1000, durationSec = 150): ExperimentSession {
  const points: DataPoint[] = [];
  const base = Date.now() - durationSec * 1000;
  for (let t = 0; t <= durationSec; t += intervalMs / 1000) {
    const { temperatureK, pressureKPa } = demoValueAt(t);
    points.push({
      id: `demo-${t}`,
      t: Number(t.toFixed(1)),
      timestamp: new Date(base + t * 1000).toISOString(),
      pressureKPa: Number(pressureKPa.toFixed(2)),
      temperatureK: Number(temperatureK.toFixed(2)),
      volumeMl,
      quality: 'ok',
    });
  }
  return {
    version: 1,
    id: `demo-session-${Date.now()}`,
    createdAt: new Date().toISOString(),
    volumeMl,
    samplingIntervalMs: intervalMs,
    demo: true,
    points,
  };
}
