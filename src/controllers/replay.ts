/**
 * 实验回放控制器：按原始时间轴重演本次实验。
 * 统一时间轴：回放虚拟时钟 tVirtual（秒）是唯一驱动源——
 * 数据表高亮、p-T 图描点、微观模型温度全部由它推导，互不维护独立时钟。
 */

import type { Dispatch } from 'react';
import type { AppAction } from '../state/ExperimentContext';
import type { ExperimentSession, DataPoint } from '../types';
import { liveBus } from '../state/liveBus';

const TICK_MS = 100;

export class ReplayController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;

  constructor(
    private readonly dispatch: Dispatch<AppAction>,
    private readonly getSession: () => ExperimentSession,
    private readonly getTVirtual: () => number,
  ) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  get duration(): number {
    const pts = this.getSession().points;
    return pts.length > 0 ? pts[pts.length - 1].t : 0;
  }

  play(speed: number): void {
    if (this.timer) return;
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => this.tick(speed), TICK_MS);
    this.dispatch({ type: 'REPLAY_SET', patch: { playing: true, speed } });
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.dispatch({ type: 'REPLAY_SET', patch: { playing: false } });
  }

  restart(speed: number): void {
    this.seek(0);
    this.pause();
    this.play(speed);
  }

  /** 拖动进度条：四区联动跳到对应状态 */
  seek(tVirtual: number): void {
    const t = Math.max(0, Math.min(tVirtual, this.duration));
    this.dispatch({ type: 'REPLAY_SEEK', tVirtual: t });
    this.pushSimValues(t);
  }

  stop(): void {
    this.pause();
    this.dispatch({ type: 'REPLAY_SEEK', tVirtual: 0 });
  }

  private tick(speed: number): void {
    const now = performance.now();
    const dt = ((now - this.lastTickAt) / 1000) * speed;
    this.lastTickAt = now;
    const next = this.getTVirtual() + dt;
    if (next >= this.duration) {
      this.seek(this.duration);
      this.pause();
      return;
    }
    this.seek(next);
  }

  /** 当前时刻对应的数据点（最后一个 t ≤ tVirtual 的点） */
  static pointAt(points: DataPoint[], tVirtual: number): DataPoint | null {
    let current: DataPoint | null = null;
    for (const p of points) {
      if (p.t <= tVirtual) current = p;
      else break;
    }
    return current;
  }

  private pushSimValues(tVirtual: number): void {
    const p = ReplayController.pointAt(this.getSession().points, tVirtual);
    liveBus.setSimValues(p?.temperatureK ?? null, p?.pressureKPa ?? null);
  }
}
