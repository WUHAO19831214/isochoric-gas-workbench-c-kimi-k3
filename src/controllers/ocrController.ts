/**
 * OCR 控制器：screen.capture → ROI → ocr.number 的组装层。
 *
 * 直接复用 @physics-software-sensors/core（v0.6.0 Release tgz，SHA256 见 README）：
 *  - ScreenCaptureSource + BrowserScreenBackend：用户授权的窗口像素流（getDisplayMedia）
 *  - NumberOCRSensor + TesseractJsRecognizer：对两个 ROI 做数字 OCR
 *
 * 遵守该仓库的设计原则：
 *  - OCR 输出是"仪器软件显示画面的识别结果"，raw_text / confidence / 时间戳全部保留；
 *  - 识别失败只产生 error 事件，绝不生成虚构数值；
 *  - 摄氏→开尔文换算发生在本适配层（下游物理解释），并显式标注。
 *
 * 实现注记：
 *  - 库的 confidence 为 0–1，本层换算为 0–100 供 UI 显示与阈值判断；
 *  - NumberOCRSensor.stop() 会关闭共享的 Tesseract worker，因此 ROI 变更时
 *    本层以"重建轻量传感器实例（共享同一 recognizer）"代替 stop+configure，
 *    避免反复重建 worker（数秒级开销）。
 */

import {
  ScreenCaptureSource,
  BrowserScreenBackend,
  ScreenCaptureError,
  NumberOCRSensor,
  cropNormalizedRoi,
  type NumberRecognizer,
  type RuntimeFramePacket,
  type RgbaImage,
} from '@physics-software-sensors/core';
import { BrowserNumberRecognizer } from '../services/BrowserNumberRecognizer';
import type { RoiConfig } from '../types';
import { liveBus } from '../state/liveBus';

/** OCR 执行间隔（ms）。屏幕预览帧率、OCR 频率、实验记录频率三者分离。 */
const OCR_INTERVAL_MS = 500;
/** 预览帧抓取间隔（ms）。库会对每帧全屏像素做 SHA-256，不宜过快 */
const PREVIEW_INTERVAL_MS = 150;
/** 读数显示置信度阈值（0-100）：低于此值不把识别值当读数展示（保留 raw 供排查）。
 *  显示阈值故意低于记录阈值——让教师能看到"读到了但质量不高"，
 *  正式入表仍由 recorder 的更高阈值把关 */
const MIN_DISPLAY_CONFIDENCE = 35;

export interface OcrControllerCallbacks {
  onFrame: (frame: RuntimeFramePacket) => void;
  onScreenStatus: (status: 'active' | 'ended' | 'error', message?: string) => void;
  onOcrEngineStatus: (status: 'not-loaded' | 'loading' | 'ready' | 'recognizing' | 'error') => void;
  /** 每次 OCR 节拍同步输出两个 ROI 的原始裁剪图（调试视图：看清 OCR 在看什么） */
  onRoiCrops?: (crops: { pressure?: RgbaImage; temperature?: RgbaImage }) => void;
}

interface OcrEvent {
  status: 'ok' | 'degraded' | 'error';
  measurements: { name: string; value: number; unit: string }[];
  quality: { confidence: number; flags: string[] };
  payload: { raw_text: string; recognition_error: string | null };
  error?: { code: string; message: string };
}

export class OcrController {
  private source: ScreenCaptureSource | null = null;
  private recognizer: NumberRecognizer | null = null;
  private pressureSensor: NumberOCRSensor | null = null;
  private temperatureSensor: NumberOCRSensor | null = null;
  private runId = '';
  private running = false;
  private latestFrame: RuntimeFramePacket | null = null;
  private lastOcrAt = 0;
  /** OCR 串行闸门：上一拍识别未完成时跳过新拍，防止恢复性重试在队列中无限积压 */
  private ocrBusy = false;
  private roi: RoiConfig = { pressure: null, temperature: null };
  private celsiusInput = false;
  private consecutiveFailures = 0;

  constructor(private readonly cb: OcrControllerCallbacks) {}

  /** 必须由用户点击直接触发（getDisplayMedia 权限边界） */
  async selectWindow(): Promise<void> {
    await this.stopScreen();
    this.runId = `run-${Date.now()}`;
    const source = new ScreenCaptureSource(new BrowserScreenBackend(), 'screen-main');
    source.configure({ requestedIntervalMs: PREVIEW_INTERVAL_MS, artifactPrefix: 'screen' });
    try {
      await source.start({ runId: this.runId });
    } catch (err) {
      if (err instanceof ScreenCaptureError && err.code === 'SCREEN_CAPTURE_PERMISSION_DENIED') {
        this.cb.onScreenStatus('error', '未授权窗口共享：请在浏览器弹窗中选择实验仪器软件所在窗口。');
      } else if (err instanceof ScreenCaptureError && err.code === 'SCREEN_CAPTURE_UNSUPPORTED') {
        this.cb.onScreenStatus(
          'error',
          '当前浏览器不支持窗口共享（getDisplayMedia），请使用 Chrome / Edge，并通过 localhost 或 HTTPS 访问。',
        );
      } else {
        this.cb.onScreenStatus('error', `窗口共享启动失败：${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    this.source = source;
    this.running = true;
    this.consecutiveFailures = 0;
    this.cb.onScreenStatus('active');
    // runId 已更新：以既有 ROI 重建 OCR 传感器（runId 不匹配会导致事件被拒绝）
    if (this.roi.pressure || this.roi.temperature) await this.setRoi(this.roi);
    void this.previewLoop();
  }

  setCelsiusInput(on: boolean): void {
    this.celsiusInput = on;
  }

  /** ROI 变更：重建轻量传感器实例（共享 Tesseract worker，避免重启开销） */
  async setRoi(roi: RoiConfig): Promise<void> {
    this.roi = roi;
    if (!this.runId) return;
    this.ensureRecognizer();
    try {
      if (roi.pressure) {
        this.pressureSensor = new NumberOCRSensor(this.recognizer!, 'ocr-pressure');
        this.pressureSensor.configure({ roiId: 'pressure', roi: { ...roi.pressure }, name: '压强', symbol: 'p', unit: 'kPa' });
        await this.pressureSensor.start({ runId: this.runId });
      } else {
        this.pressureSensor = null;
      }
      if (roi.temperature) {
        this.temperatureSensor = new NumberOCRSensor(this.recognizer!, 'ocr-temperature');
        this.temperatureSensor.configure({
          roiId: 'temperature',
          roi: { ...roi.temperature },
          name: '热力学温度',
          symbol: 'T',
          unit: 'K',
        });
        await this.temperatureSensor.start({ runId: this.runId });
      } else {
        this.temperatureSensor = null;
      }
    } catch (err) {
      this.cb.onScreenStatus('error', `识别区域配置失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private ensureRecognizer(): void {
    if (!this.recognizer) {
      // 屏幕小字体准备 + 本地资源 + 多尝试一致性恢复（见 services/BrowserNumberRecognizer.ts）
      this.recognizer = new BrowserNumberRecognizer();
    }
  }

  private async previewLoop(): Promise<void> {
    while (this.running && this.source) {
      try {
        const frame = await this.source.readOne();
        if (!frame) break;
        this.latestFrame = frame;
        this.cb.onFrame(frame);
        const now = performance.now();
        if (now - this.lastOcrAt >= OCR_INTERVAL_MS && !this.ocrBusy) {
          this.lastOcrAt = now;
          this.ocrBusy = true;
          void this.runOcr(frame).finally(() => {
            this.ocrBusy = false;
          });
        }
        await sleep(PREVIEW_INTERVAL_MS);
      } catch (err) {
        if (err instanceof ScreenCaptureError && err.code === 'SCREEN_CAPTURE_ENDED') {
          this.running = false;
          this.cb.onScreenStatus('ended', '窗口共享已结束（用户停止或窗口关闭）。已采集的数据保留，可重新选择窗口继续。');
        } else if (err instanceof ScreenCaptureError && err.code === 'SCREEN_FRAME_NOT_READY') {
          await sleep(300); // 视频尚未出帧，稍候重试
        } else {
          this.running = false;
          this.cb.onScreenStatus('error', `屏幕采集异常：${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  private async runOcr(frame: RuntimeFramePacket): Promise<void> {
    if (!this.pressureSensor && !this.temperatureSensor) return;
    this.cb.onOcrEngineStatus('recognizing');

    // 同步输出 ROI 原始裁剪图（调试视图）
    if (this.cb.onRoiCrops && frame.pixels) {
      const crops: { pressure?: RgbaImage; temperature?: RgbaImage } = {};
      try {
        if (this.roi.pressure) crops.pressure = cropNormalizedRoi(frame.pixels, { ...this.roi.pressure }).image;
        if (this.roi.temperature) crops.temperature = cropNormalizedRoi(frame.pixels, { ...this.roi.temperature }).image;
        this.cb.onRoiCrops(crops);
      } catch {
        /* ROI 超出画面范围等异常不影响 OCR 主流程 */
      }
    }

    let pressureKPa: number | null = null;
    let temperatureK: number | null = null;
    let pConf = 0;
    let tConf = 0;
    let pRaw = '';
    let tRaw = '';

    const jobs: Promise<void>[] = [];
    if (this.pressureSensor) {
      jobs.push(
        this.pressureSensor
          .processFrame(frame)
          .then((ev) => {
            const e = ev as unknown as OcrEvent;
            pRaw = e.payload?.raw_text ?? '';
            pConf = Math.round((e.quality?.confidence ?? 0) * 100);
            if (e.status !== 'error' && e.measurements.length > 0) pressureKPa = e.measurements[0].value;
          })
          .catch(() => undefined),
      );
    }
    if (this.temperatureSensor) {
      jobs.push(
        this.temperatureSensor
          .processFrame(frame)
          .then((ev) => {
            const e = ev as unknown as OcrEvent;
            tRaw = e.payload?.raw_text ?? '';
            tConf = Math.round((e.quality?.confidence ?? 0) * 100);
            if (e.status !== 'error' && e.measurements.length > 0) {
              const raw = e.measurements[0].value;
              // 摄氏→开尔文换算属于下游物理解释层，显式执行；原始文本保留于 raw
              temperatureK = this.celsiusInput ? raw + 273.15 : raw;
            }
          })
          .catch(() => undefined),
      );
    }
    await Promise.all(jobs);
    this.cb.onOcrEngineStatus('ready');

    // 低置信度识别值不作为读数展示（raw/置信度保留，调试视图可查）
    if (pressureKPa !== null && pConf < MIN_DISPLAY_CONFIDENCE) pressureKPa = null;
    if (temperatureK !== null && tConf < MIN_DISPLAY_CONFIDENCE) temperatureK = null;

    const pOk = pressureKPa !== null;
    const tOk = temperatureK !== null;
    this.consecutiveFailures = pOk && tOk ? 0 : this.consecutiveFailures + 1;
    liveBus.setReading({
      pressureKPa,
      temperatureK,
      pressureConfidence: pConf,
      temperatureConfidence: tConf,
      pressureRaw: pRaw,
      temperatureRaw: tRaw,
      status: pOk && tOk ? 'ok' : pOk || tOk ? 'partial' : 'failed',
      updatedAt: Date.now(),
    });
  }

  get consecutiveFailureCount(): number {
    return this.consecutiveFailures;
  }

  /** 停止共享与 OCR，但保留已采集数据 */
  async stopScreen(): Promise<void> {
    this.running = false;
    if (this.source) {
      try {
        await this.source.stop();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    this.latestFrame = null;
  }

  async dispose(): Promise<void> {
    await this.stopScreen();
    if (this.recognizer) {
      try {
        await this.recognizer.close?.();
      } catch {
        /* ignore */
      }
      this.recognizer = null;
      this.pressureSensor = null;
      this.temperatureSensor = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
