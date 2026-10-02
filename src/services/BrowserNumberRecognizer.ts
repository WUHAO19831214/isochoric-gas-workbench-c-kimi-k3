/**
 * 浏览器数字识别器（识别技术参考自用户的 TIANSHAN GAS codx 项目，
 * 适配为依赖 @physics-software-sensors/core npm 包而非 vendored 源码）。
 *
 * 相对直接使用 TesseractJsRecognizer 的三项关键改进：
 *  1. 本地 OCR 资源（public/ocr/：worker/wasm/eng.traineddata），
 *     不依赖 CDN——教室离线可用，且资源版本与引擎严格匹配；
 *  2. 屏幕小字体准备：ROI 较小时 ×3 放大 + 白色留白边，
 *     平滑缩放保留抗锯齿笔画，让小字号数字在库的二值化前保持可辨；
 *  3. 恢复管线：低置信度/无数值/数值跳变时，用 4×、6× 平滑灰度变体
 *     重试，多个预处理尝试必须在同一帧上达成一致才采纳（见 ocrRecovery.ts）。
 */

import {
  TesseractJsRecognizer,
  cropNormalizedRoi,
  type NumberRecognizer,
  type RecognizeRequest,
  type OcrRecognitionResult,
} from '@physics-software-sensors/core';
import { MIN_OCR_CONFIDENCE, numericCandidate, recoverOcr } from './ocrRecovery';

export class BrowserNumberRecognizer implements NumberRecognizer {
  readonly id = 'tesseract.js';
  readonly replay = false;
  private readonly engine: TesseractJsRecognizer;
  private engineError = '';
  private rejectEngine?: (error: Error) => void;
  private assetsReady?: Promise<void>;
  private readonly assets: string;
  private encodingOverride?: HTMLCanvasElement;
  /**
   * 串行闸门：encodingOverride 等实例字段在单次识别内被反复读写，
   * 而库只对底层 worker 串行、不对这一层串行——两个识别区域并发调用时，
   * 后进入的调用会把先排队调用的 override 覆盖掉（压强管道会拿到温度管道的图像，
   * 表现为"裁剪图正确但识别原文是另一个通道的数值"）。这里必须再加一道锁。
   */
  private queue: Promise<unknown> = Promise.resolve();
  /** 上次接受值按识别区域分开，避免压强/温度互相触发跳变误判 */
  private lastAccepted = new Map<string, { value: number; observedMs: number }>();

  constructor() {
    const assets = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href;
    this.assets = assets;
    this.engine = new TesseractJsRecognizer({
      whitelist: '0123456789.+-kPaKCF°',
      psmMode: 'SINGLE_LINE',
      imageEncoder: async (image) => {
        if (this.encodingOverride) return this.encodingOverride;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas
          .getContext('2d')!
          .putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
        return canvas;
      },
      workerOptions: {
        workerPath: `${assets}worker.min.js`,
        corePath: assets,
        langPath: assets,
        workerBlobURL: false,
        errorHandler: (error: unknown) => {
          this.engineError = String(error);
          this.rejectEngine?.(new Error(this.engineError));
        },
      } as never, // WorkerOptions 字段按 tesseract.js v7 运行时传入
    });
  }

  private checkAssets() {
    this.assetsReady ??= Promise.all(
      ['worker.min.js', 'eng.traineddata.gz'].map(async (file) => {
        const url = `${this.assets}${file}`;
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
        if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
          throw new Error(`OCR 资源无法加载：${file}（HTTP ${response.status}）`);
        }
      }),
    ).then(() => undefined);
    return this.assetsReady;
  }

  async recognize(input: RecognizeRequest): Promise<OcrRecognitionResult> {
    const result = this.queue.then(
      () => this.recognizeInternal(input),
      () => this.recognizeInternal(input),
    );
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async recognizeInternal(input: RecognizeRequest): Promise<OcrRecognitionResult> {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await this.checkAssets();
      if (!input.frame.pixels) throw new Error('屏幕帧缺少像素');
      const { image, rect } = cropNormalizedRoi(input.frame.pixels, input.roi);
      const original = document.createElement('canvas');
      original.width = image.width;
      original.height = image.height;
      original
        .getContext('2d')!
        .putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);

      // 所有尝试统一走"放大 + 白边 + 平滑灰度"管线：
      // 保留抗锯齿笔画（尤其是小数点），不同倍率之间才不会因为
      // 阈值二值化的随机差异产生无谓分歧
      const margin = 12;
      const makeSmooth = (scale: number): HTMLCanvasElement => {
        const c = document.createElement('canvas');
        c.width = image.width * scale + margin * 2;
        c.height = image.height * scale + margin * 2;
        const cctx = c.getContext('2d', { willReadFrequently: true })!;
        cctx.fillStyle = 'white';
        cctx.fillRect(0, 0, c.width, c.height);
        cctx.imageSmoothingEnabled = true;
        cctx.imageSmoothingQuality = 'high';
        cctx.drawImage(original, margin, margin, image.width * scale, image.height * scale);
        const rgba = cctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < rgba.data.length; i += 4) {
          const gray = Math.round(0.299 * rgba.data[i] + 0.587 * rgba.data[i + 1] + 0.114 * rgba.data[i + 2]);
          rgba.data[i] = rgba.data[i + 1] = rgba.data[i + 2] = gray;
        }
        cctx.putImageData(rgba, 0, 0);
        return c;
      };
      const baseScale = image.height <= 64 ? 4 : 2;

      this.engineError = '';
      const failure = new Promise<never>((_, reject) => {
        this.rejectEngine = reject;
        timer = setTimeout(() => reject(new Error('OCR 初始化或识别超时（若持续出现，建议使用 Chrome/Edge 浏览器）')), 12000);
      });
      const run = async (encoding: HTMLCanvasElement, mode: string, fontScale: number) => {
        this.encodingOverride = encoding;
        const ectx = encoding.getContext('2d', { willReadFrequently: true })!;
        const framePixels = {
          width: encoding.width,
          height: encoding.height,
          data: ectx.getImageData(0, 0, encoding.width, encoding.height).data,
        };
        const result = await Promise.race([
          failure,
          this.engine.recognize({
            ...input,
            roi: { x: 0, y: 0, width: 1, height: 1 },
            frame: {
              ...input.frame,
              media: { ...input.frame.media, width: encoding.width, height: encoding.height },
              pixels: framePixels,
            },
          }),
        ]);
        return {
          ...result,
          details: { ...result.details, preprocess_mode: mode, screen_font_scale: fontScale },
        };
      };

      const primary = await run(makeSmooth(baseScale), 'smooth-grayscale', baseScale);
      let result: OcrRecognitionResult = primary;
      const value = numericCandidate(primary);
      const observedMs = input.frame.monotonicNs / 1e6;
      const last = this.lastAccepted.get(input.roiId);
      const jump =
        value !== null &&
        last &&
        observedMs - last.observedMs < 3000 &&
        Math.abs(value - last.value) / last.value > 0.15;

      if (!primary.error && (value === null || primary.confidence < MIN_OCR_CONFIDENCE || jump)) {
        // 主结果不够可靠：换两个更高倍率重试，多数表决（见 ocrRecovery.ts）
        const attempts = [primary];
        for (const fallbackScale of [baseScale + 2, baseScale + 4]) {
          const alternateResult = await run(makeSmooth(fallbackScale), 'smooth-grayscale', fallbackScale);
          attempts.push(alternateResult);
          if (alternateResult.error) {
            result = alternateResult;
            break;
          }
          result = recoverOcr(attempts);
        }
      }

      const accepted = numericCandidate(result);
      if (accepted !== null && result.confidence >= MIN_OCR_CONFIDENCE && !jump) {
        this.lastAccepted.set(input.roiId, { value: accepted, observedMs });
      }
      return {
        ...result,
        ...(result.error && this.engineError ? { error: this.engineError, warning: this.engineError } : {}),
        durationMs: Math.round(performance.now() - started),
        details: { ...result.details, pixel_roi: { ...rect }, padding_px: margin },
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { method: this.id, rawText: '', confidence: 0, durationMs: Math.round(performance.now() - started), error, warning: error };
    } finally {
      clearTimeout(timer);
      this.rejectEngine = undefined;
      this.encodingOverride = undefined;
    }
  }

  async close() {
    // Tesseract 在 worker 出错后可能让初始化 promise 悬挂；带超时关闭，不阻塞 ROI 调整
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.engine.close(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
