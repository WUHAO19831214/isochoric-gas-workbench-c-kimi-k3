/**
 * 实验记录控制器：统一实验时钟。
 * 按设定采样间隔从 liveBus 取最新 OCR 读数，经过数据质量检查后写入正式数据表。
 *
 * 数据质量原则（不静默写入坏数据、不擅自"修正"数据）：
 *  - OCR 失败的帧：整行跳过，仅计数提示（连续失败给出明显警告）；
 *  - 置信度过低 / 数值超出合理范围：跳过并计数；
 *  - 数值相对上一点发生不合理跳变：写入但标记 suspect，由教师决定保留或删除；
 *  - 暂停期间不计时、不采样。
 */

import type { Dispatch } from 'react';
import type { DataPoint, DataQuality } from '../types';
import type { AppAction } from '../state/ExperimentContext';
import { liveBus } from '../state/liveBus';

/** 合理物理范围（水浴加热的等容实验）。
 *  压强故意不设上限：密闭气体压强没有天然天花板，
 *  "把压强框错套到温度行"这类串行错误靠下面的历史交叉验证拦截，
 *  而不是靠一个可能误伤真实数据的死板数字 */
const T_RANGE: [number, number] = [250, 420]; // K
const P_MIN = 50; // kPa
/** 置信度阈值（0-100）：低于此值视为无效识别 */
const MIN_CONFIDENCE = 55;
/** 与本次实验历史基线的最大允许偏差比例（超过判定疑似串行/框错，跳过并提示）。
 *  等容加热实验压强变化平缓，15% 的瞬时突变必然是识别异常 */
const MAX_DEVIATION_RATIO = 0.15;
/** 判定为持续串行（提示重新框选）所需的连续越界次数 */
const SUSPECT_STREAK_THRESHOLD = 3;
/** 相邻采样点之间的最大合理跳变（超过则标记 suspect 但仍写入） */
const MAX_JUMP_T = 20; // K
const MAX_JUMP_P = 30; // kPa
/** 基线估计的指数平滑系数 */
const BASELINE_ALPHA = 0.25;

export class RecorderController {
  private timer: ReturnType<typeof setInterval> | null = null;
  private accumulatedMs = 0;
  private startedAt = 0;
  private skippedCount = 0;
  private volumeMl = 100;
  /** 本次记录运行写入的最后一点（跳变检查只与同一次记录比较，避免跨 session 误判） */
  private lastWritten: DataPoint | null = null;
  /** 历史基线（指数平滑均值）与连续疑似串行计数 */
  private baseline = { p: 0, T: 0, count: 0 };
  private suspectStreak = 0;

  constructor(private readonly dispatch: Dispatch<AppAction>) {}

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** 开始一次新实验（或从暂停继续）。体积在开始时锁定 */
  start(intervalMs: number, resume: boolean, volumeMl: number): void {
    this.volumeMl = volumeMl;
    if (!resume) {
      this.accumulatedMs = 0;
      this.skippedCount = 0;
      this.lastWritten = null;
      this.baseline = { p: 0, T: 0, count: 0 };
      this.suspectStreak = 0;
    }
    this.startedAt = performance.now();
    this.timer = setInterval(() => this.tick(), intervalMs);
    // 立即采第一个点（t=0）
    this.tick();
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.accumulatedMs += performance.now() - this.startedAt;
  }

  stop(): number {
    this.pause();
    return this.skippedCount;
  }

  elapsedSec(): number {
    const base = this.accumulatedMs + (this.timer ? performance.now() - this.startedAt : 0);
    return base / 1000;
  }

  private tick(): void {
    const t = this.elapsedSec();
    this.dispatch({ type: 'SET_ELAPSED', sec: t });
    const { reading } = liveBus.get();

    const fail = (note: string) => {
      this.skippedCount++;
      this.dispatch({ type: 'SET_NOTICE', notice: `已跳过 ${this.skippedCount} 个无效采样（${note}）` });
    };

    if (reading.status === 'idle' || reading.status === 'failed') {
      fail('OCR 未得到有效读数');
      return;
    }
    const p = reading.pressureKPa;
    const T = reading.temperatureK;
    if (p === null || T === null) {
      fail('压强或温度识别失败');
      return;
    }
    if (reading.pressureConfidence < MIN_CONFIDENCE || reading.temperatureConfidence < MIN_CONFIDENCE) {
      fail('识别置信度过低');
      return;
    }
    if (T < T_RANGE[0] || T > T_RANGE[1] || p < P_MIN) {
      fail(`数值超出合理范围（p=${p.toFixed(1)} kPa, T=${T.toFixed(1)} K）`);
      return;
    }

    // 历史基线交叉验证：等容加热实验 p、T 变化平缓，瞬时偏离历史 15% 以上
    // 几乎必然是识别框串行（如压强框滑到了温度行）。判定为无效并跳过，
    // 连续出现时明确提示教师重新框选——绝不把串行值写进实验数据
    const baseline = this.baseline;
    if (baseline.count >= 2) {
      const devP = Math.abs(p - baseline.p) / baseline.p;
      const devT = Math.abs(T - baseline.T) / baseline.T;
      if (devP > MAX_DEVIATION_RATIO || devT > MAX_DEVIATION_RATIO) {
        this.suspectStreak++;
        this.skippedCount++;
        const hint =
          this.suspectStreak >= SUSPECT_STREAK_THRESHOLD
            ? '识别值持续偏离历史数据：很可能识别框已偏移（压强/温度行套错），请停止记录后重新框选两个识别区域'
            : '读数疑似串行，已跳过';
        this.dispatch({ type: 'SET_NOTICE', notice: `${hint}（已跳过 ${this.skippedCount} 个无效采样）` });
        return;
      }
    }
    this.suspectStreak = 0;
    this.recordBaseline(p, T);

    // 跳变检查：写入但标记 suspect，绝不擅自修正
    let quality: DataQuality = 'ok';
    let qualityNote: string | undefined;
    const last = this.lastWritten;
    if (last && last.pressureKPa !== null && last.temperatureK !== null) {
      const dT = Math.abs(T - last.temperatureK);
      const dP = Math.abs(p - last.pressureKPa);
      if (dT > MAX_JUMP_T || dP > MAX_JUMP_P) {
        quality = 'suspect';
        qualityNote = `数值跳变异常（ΔT=${dT.toFixed(1)} K, Δp=${dP.toFixed(1)} kPa），请教师确认`;
      }
    }

    const point: DataPoint = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      t: Number(t.toFixed(1)),
      timestamp: new Date().toISOString(),
      pressureKPa: p,
      temperatureK: T,
      volumeMl: this.volumeMl,
      quality,
      qualityNote,
      ocrPressure: { rawText: reading.pressureRaw, confidence: reading.pressureConfidence, status: 'ok' },
      ocrTemperature: { rawText: reading.temperatureRaw, confidence: reading.temperatureConfidence, status: 'ok' },
    };
    this.lastWritten = point;
    this.dispatch({ type: 'APPEND_POINT', point });
  }

  /** 指数平滑更新历史基线 */
  private recordBaseline(p: number, T: number): void {
    if (this.baseline.count === 0) {
      this.baseline = { p, T, count: 1 };
      return;
    }
    this.baseline = {
      p: this.baseline.p * (1 - BASELINE_ALPHA) + p * BASELINE_ALPHA,
      T: this.baseline.T * (1 - BASELINE_ALPHA) + T * BASELINE_ALPHA,
      count: this.baseline.count + 1,
    };
  }
}
