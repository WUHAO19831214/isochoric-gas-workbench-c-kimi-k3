/**
 * 屏幕采集面板：窗口共享预览 + 双 ROI 框选 + OCR 状态灯。
 * 数据链：screen.capture（窗口像素）→ 用户在预览上框选 ROI → ocr.number。
 */

import React, { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import type { RuntimeFramePacket, RgbaImage } from '@physics-software-sensors/core';
import { OcrController } from '../controllers/ocrController';
import { useExperiment } from '../state/ExperimentContext';
import { liveBus } from '../state/liveBus';
import type { RoiRect } from '../types';

type RoiTarget = 'pressure' | 'temperature';

export function ScreenCapturePanel({ controllerRef }: { controllerRef: React.MutableRefObject<OcrController | null> }) {
  const { state, dispatch } = useExperiment();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pCropRef = useRef<HTMLCanvasElement>(null);
  const tCropRef = useRef<HTMLCanvasElement>(null);
  const [selecting, setSelecting] = useState<RoiTarget | null>(null);
  const [draftRect, setDraftRect] = useState<RoiRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // 初始化控制器（仅一次）
  useEffect(() => {
    const controller = new OcrController({
      onFrame: (frame) => paintFrame(frame),
      onScreenStatus: (status, message) => {
        dispatch({ type: 'SET_SCREEN_STATUS', status });
        if (message) dispatch({ type: 'SET_NOTICE', notice: message });
        if (status === 'active') dispatch({ type: 'SET_EXP_STATE', state: 'CONFIGURING' });
        if (status === 'ended' || status === 'error') {
          dispatch({ type: 'SET_EXP_STATE', state: 'IDLE' });
        }
      },
      onOcrEngineStatus: (status) => dispatch({ type: 'SET_OCR_ENGINE_STATUS', status }),
      onRoiCrops: (crops) => {
        paintCrop(pCropRef.current, crops.pressure);
        paintCrop(tCropRef.current, crops.temperature);
      },
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      void controller.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ROI 或摄氏开关变化时同步到控制器
  useEffect(() => {
    void controllerRef.current?.setRoi(state.roi);
  }, [state.roi, controllerRef]);
  useEffect(() => {
    controllerRef.current?.setCelsiusInput(state.celsiusInput);
  }, [state.celsiusInput, controllerRef]);

  const paintFrame = useCallback((frame: RuntimeFramePacket) => {
    const canvas = canvasRef.current;
    const pixels = frame.pixels;
    if (!canvas || !pixels) return;
    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    const off = offscreenRef.current;
    if (off.width !== pixels.width || off.height !== pixels.height) {
      off.width = pixels.width;
      off.height = pixels.height;
      canvas.width = pixels.width;
      canvas.height = pixels.height;
    }
    const offCtx = off.getContext('2d');
    const ctx = canvas.getContext('2d');
    if (!offCtx || !ctx) return;
    offCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    ctx.drawImage(off, 0, 0);
  }, []);

  /** 把 ROI 裁剪图画到调试画布上（放大、像素化显示，看清 OCR 的输入） */
  const paintCrop = useCallback((canvas: HTMLCanvasElement | null, image: RgbaImage | undefined) => {
    if (!canvas || !image) return;
    if (canvas.width !== image.width || canvas.height !== image.height) {
      canvas.width = image.width;
      canvas.height = image.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  }, []);

  const fraction = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!selecting) return;
    dragStart.current = fraction(e);
    setDraftRect(null);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!selecting || !dragStart.current) return;
    const cur = fraction(e);
    const s = dragStart.current;
    setDraftRect({
      x: Math.min(s.x, cur.x),
      y: Math.min(s.y, cur.y),
      width: Math.abs(cur.x - s.x),
      height: Math.abs(cur.y - s.y),
    });
  };
  const onMouseUp = () => {
    if (!selecting || !dragStart.current) return;
    dragStart.current = null;
    if (draftRect && draftRect.width > 0.01 && draftRect.height > 0.01) {
      dispatch({ type: 'SET_ROI', which: selecting, roi: draftRect });
      dispatch({ type: 'SET_NOTICE', notice: selecting === 'pressure' ? '压强识别区域已设置。' : '温度识别区域已设置。' });
      const other = selecting === 'pressure' ? state.roi.temperature : state.roi.pressure;
      if (other) dispatch({ type: 'SET_EXP_STATE', state: 'READY' });
    }
    setDraftRect(null);
    setSelecting(null);
  };

  const roiStyle = (r: RoiRect, color: string): React.CSSProperties => ({
    position: 'absolute',
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.width * 100}%`,
    height: `${r.height * 100}%`,
    border: `2px solid ${color}`,
    background: `${color}22`,
    pointerEvents: 'none',
    boxSizing: 'border-box',
  });

  const hasScreen = state.screenStatus === 'active';

  return (
    <section className="panel">
      <div className="panel-title">
        <span>① 数据窗口与识别区域</span>
        <span className={`lamp lamp-${state.screenStatus}`}>
          {state.screenStatus === 'active' ? '采集中' : state.screenStatus === 'ended' ? '共享已结束' : state.screenStatus === 'error' ? '异常' : '未共享'}
        </span>
      </div>
      <div
        ref={wrapRef}
        className={`screen-preview ${selecting ? 'selecting' : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <canvas ref={canvasRef} className="screen-canvas" />
        {!hasScreen && !state.demoMode && (
          <div className="screen-placeholder">点击「选择数据窗口」，共享实验仪器软件窗口</div>
        )}
        {state.demoMode && !hasScreen && <div className="screen-placeholder demo">演示模式：使用内置模拟读数，无需共享窗口</div>}
        {state.roi.pressure && <div style={roiStyle(state.roi.pressure, '#ff9f1c')}><span className="roi-tag" style={{ background: '#ff9f1c' }}>p</span></div>}
        {state.roi.temperature && <div style={roiStyle(state.roi.temperature, '#2ec4b6')}><span className="roi-tag" style={{ background: '#2ec4b6' }}>T</span></div>}
        {draftRect && <div style={roiStyle(draftRect, '#ffffff')} />}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => void controllerRef.current?.selectWindow()}>
          选择数据窗口
        </button>
        <button
          className={`btn ${selecting === 'pressure' ? 'btn-armed' : ''}`}
          disabled={!hasScreen}
          onClick={() => setSelecting(selecting === 'pressure' ? null : 'pressure')}
        >
          框选压强 p
        </button>
        <button
          className={`btn ${selecting === 'temperature' ? 'btn-armed' : ''}`}
          disabled={!hasScreen}
          onClick={() => setSelecting(selecting === 'temperature' ? null : 'temperature')}
        >
          框选温度 T
        </button>
        <button
          className="btn btn-subtle"
          disabled={!state.roi.pressure && !state.roi.temperature}
          onClick={() => {
            dispatch({ type: 'SET_ROI', which: 'pressure', roi: null });
            dispatch({ type: 'SET_ROI', which: 'temperature', roi: null });
          }}
        >
          清除区域
        </button>
      </div>
      <div className="btn-row small-row">
        <label className="check">
          <input
            type="checkbox"
            checked={state.celsiusInput}
            onChange={(e) => dispatch({ type: 'SET_CELSIUS_INPUT', on: e.target.checked })}
          />
          仪器显示为 ℃，自动换算 T = t + 273.15
        </label>
        <span className={`lamp lamp-ocr-${state.ocrEngineStatus}`}>
          OCR：{ocrStatusText(state.ocrEngineStatus)}
        </span>
      </div>
      {(state.roi.pressure || state.roi.temperature) && hasScreen && (
        <CropDebugRow pCropRef={pCropRef} tCropRef={tCropRef} />
      )}
    </section>
  );
}

/** ROI 放大调试视图：裁剪图 + OCR 原始识别文本与置信度（一眼定位识别问题） */
function CropDebugRow({
  pCropRef,
  tCropRef,
}: {
  pCropRef: React.MutableRefObject<HTMLCanvasElement | null>;
  tCropRef: React.MutableRefObject<HTMLCanvasElement | null>;
}) {
  const snap = useSyncExternalStore(
    (cb) => liveBus.subscribeReading(cb),
    () => liveBus.get(),
  );
  const r = snap.reading;
  return (
    <div className="crop-debug-row">
      <div className="crop-debug">
        <canvas ref={pCropRef} className="crop-canvas" />
        <span className="crop-label">p 识别区放大</span>
        <span className="crop-raw">
          原文 {r.pressureRaw ? `"${r.pressureRaw}"` : '（空）'} · {r.pressureConfidence}%
        </span>
      </div>
      <div className="crop-debug">
        <canvas ref={tCropRef} className="crop-canvas" />
        <span className="crop-label">T 识别区放大</span>
        <span className="crop-raw">
          原文 {r.temperatureRaw ? `"${r.temperatureRaw}"` : '（空）'} · {r.temperatureConfidence}%
        </span>
      </div>
    </div>
  );
}

function ocrStatusText(s: string): string {
  switch (s) {
    case 'loading':
      return '引擎加载中…';
    case 'ready':
      return '就绪';
    case 'recognizing':
      return '识别中';
    case 'error':
      return '识别异常';
    default:
      return '待启动';
  }
}
