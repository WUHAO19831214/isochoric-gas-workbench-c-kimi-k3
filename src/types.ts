/**
 * 统一数据模型 —— 所有模块共享的实验数据定义。
 * 遵循 physics-software-sensors 的设计原则：
 * OCR 得到的是"仪器软件显示画面的识别结果"（直接观测），
 * 只有经过质量检查后写入 DataPoint 的值才作为本次实验的正式记录。
 */

/** 实验状态机 */
export type ExperimentState =
  | 'IDLE' // 初始：未选择数据窗口
  | 'CONFIGURING' // 已共享窗口，正在框选/调整 ROI
  | 'READY' // ROI 与体积就绪，可以开始记录
  | 'RECORDING' // 正在按采样间隔记录
  | 'PAUSED' // 记录暂停（保留已采数据）
  | 'STOPPED' // 记录结束，可绘图/回放/导出
  | 'REPLAYING'; // 正在按原时间轴回放

/** 数据质量标记：绝不静默写入坏数据，也绝不擅自"修正" */
export type DataQuality = 'ok' | 'suspect' | 'invalid';

export interface OcrProvenance {
  /** OCR 原始识别文本（排错用） */
  rawText?: string;
  /** Tesseract 置信度 0-100（置信度 ≠ 准确率，仅供参考） */
  confidence?: number;
  status?: string;
}

export interface DataPoint {
  id: string;
  /** 从"开始记录"起计的秒数（暂停时间不计入） */
  t: number;
  /** 墙钟时间 ISO 字符串 */
  timestamp: string;
  pressureKPa: number | null;
  temperatureK: number | null;
  /** 等容实验：所有行共享同一个 V */
  volumeMl: number;
  quality: DataQuality;
  qualityNote?: string;
  /** 教师手动编辑/补救过的行必须显式标识 */
  editedByUser?: boolean;
  ocrPressure?: OcrProvenance;
  ocrTemperature?: OcrProvenance;
}

export interface ExperimentSession {
  version: 1;
  id: string;
  createdAt: string;
  volumeMl: number;
  samplingIntervalMs: number;
  /** 演示模式产生的数据必须终身携带 DEMO 标记 */
  demo: boolean;
  points: DataPoint[];
}

/** ROI（归一化坐标，与 physics-software-sensors 的 NormalizedRect 一致） */
export interface RoiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoiConfig {
  pressure: RoiRect | null;
  temperature: RoiRect | null;
}

/** OCR 实时读数（高频，2 Hz；不等于正式实验数据） */
export interface LiveReading {
  pressureKPa: number | null;
  temperatureK: number | null;
  pressureConfidence: number;
  temperatureConfidence: number;
  pressureRaw: string;
  temperatureRaw: string;
  /** ok=两路都有效；partial=一路失败；failed=两路都失败；idle=未运行 */
  status: 'idle' | 'ok' | 'partial' | 'failed';
  updatedAt: number;
}

export const SAMPLING_OPTIONS = [500, 1000, 2000, 5000] as const;

export function newSession(volumeMl: number, samplingIntervalMs: number, demo: boolean): ExperimentSession {
  return {
    version: 1,
    id: `session-${Date.now()}`,
    createdAt: new Date().toISOString(),
    volumeMl,
    samplingIntervalMs,
    demo,
    points: [],
  };
}
