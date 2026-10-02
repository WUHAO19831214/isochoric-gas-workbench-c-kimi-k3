/**
 * 主应用：三栏布局 + 全局控制器装配 + 状态机接线。
 * 数据链：screen.capture → ocr.number → liveBus → recorder → 数据表 → 图表 / 微观模型
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { ExperimentProvider, useExperiment } from './state/ExperimentContext';
import { ScreenCapturePanel } from './components/ScreenCapturePanel';
import { RealtimeValues } from './components/RealtimeValues';
import { ExperimentControls, stateLabel } from './components/ExperimentControls';
import { ExperimentTable } from './components/ExperimentTable';
import { PTChart } from './components/PTChart';
import { CameraPanel } from './components/CameraPanel';
import { MolecularSimulation } from './components/MolecularSimulation';
import { ReplayBar } from './components/ReplayBar';
import { OcrController } from './controllers/ocrController';
import { RecorderController } from './controllers/recorder';
import { ReplayController } from './controllers/replay';
import { DemoFeeder } from './controllers/demo';
import { liveBus } from './state/liveBus';
import { loadSession } from './utils/storage';

function Workbench() {
  const { state, dispatch } = useExperiment();
  const ocrRef = useRef<OcrController | null>(null);
  const demoRef = useRef<DemoFeeder | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const recorder = useMemo(() => new RecorderController(dispatch), [dispatch]);
  const replay = useRef<ReplayController | null>(null);
  if (!replay.current) {
    replay.current = new ReplayController(dispatch, () => stateRef.current.session, () => stateRef.current.replay.tVirtual);
  }
  if (!demoRef.current) demoRef.current = new DemoFeeder();

  // 演示模式开关：接入/断开模拟数据源（走与真实 OCR 相同的下游链路）
  const toggleDemo = (on: boolean) => {
    dispatch({ type: 'SET_DEMO_MODE', on });
    if (on) {
      demoRef.current?.start();
      dispatch({ type: 'SET_EXP_STATE', state: 'READY' });
      dispatch({ type: 'SET_NOTICE', notice: '演示模式已开启：读数为模拟数据（DEMO），仅用于流程演示。' });
    } else {
      demoRef.current?.stop();
      liveBus.setReading({
        pressureKPa: null,
        temperatureK: null,
        pressureConfidence: 0,
        temperatureConfidence: 0,
        pressureRaw: '',
        temperatureRaw: '',
        status: 'idle',
        updatedAt: Date.now(),
      });
      dispatch({ type: 'SET_EXP_STATE', state: 'IDLE' });
    }
  };

  // 同步显示：将实时 OCR 温度/压强推送给微观模型（回放期间由 ReplayController 接管）
  useEffect(() => {
    if (!state.syncMicro || state.expState === 'REPLAYING') return;
    const push = () => {
      const { reading } = liveBus.get();
      liveBus.setSimValues(reading.temperatureK, reading.pressureKPa);
    };
    push(); // 立即同步一次，避免等待下一次 OCR 节拍
    return liveBus.subscribeReading(push);
  }, [state.syncMicro, state.expState]);

  // 同步关闭或进入回放以外状态时清空推送
  useEffect(() => {
    if (!state.syncMicro) liveBus.setSimValues(null, null);
  }, [state.syncMicro]);

  // 窗口共享中断/出错时：自动暂停记录（保留已采数据），并将实时读数置为无效，
  // 防止记录器继续写入共享结束前最后一帧的陈旧值
  useEffect(() => {
    if ((state.screenStatus === 'ended' || state.screenStatus === 'error') && state.expState === 'RECORDING') {
      recorder.pause();
      dispatch({ type: 'SET_EXP_STATE', state: 'PAUSED' });
      liveBus.setReading({
        pressureKPa: null,
        temperatureK: null,
        pressureConfidence: 0,
        temperatureConfidence: 0,
        pressureRaw: '',
        temperatureRaw: '',
        status: 'idle',
        updatedAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.screenStatus]);

  // OCR 连续失败提醒（数据保留，不中断其他区域）
  useEffect(() => {
    const timer = setInterval(() => {
      const s = stateRef.current;
      const failures = ocrRef.current?.consecutiveFailureCount ?? 0;
      const ocrActive = s.expState === 'RECORDING' || (s.screenStatus === 'active' && (s.roi.pressure !== null || s.roi.temperature !== null));
      if (ocrActive && failures >= 8) {
        dispatch({
          type: 'SET_NOTICE',
          notice: 'OCR 连续识别失败：请检查"识别区放大"视图——若原文持续为空，建议改用 Chrome / Edge 浏览器（Safari 对 OCR 引擎兼容性较差）；若原文有数字但置信度低，请重新只框数值本身。',
        });
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [dispatch]);

  const handlers = {
    onStartRecord: () => {
      dispatch({ type: 'BEGIN_SESSION' });
      dispatch({ type: 'SET_EXP_STATE', state: 'RECORDING' });
      const volume = stateRef.current.volumeInputMl;
      recorder.start(stateRef.current.samplingIntervalMs, false, volume);
      dispatch({ type: 'SET_NOTICE', notice: `开始记录（V = ${volume} mL，采样间隔 ${stateRef.current.samplingIntervalMs / 1000} s）。` });
    },
    onPauseRecord: () => {
      recorder.pause();
      dispatch({ type: 'SET_EXP_STATE', state: 'PAUSED' });
    },
    onResumeRecord: () => {
      recorder.start(stateRef.current.session.samplingIntervalMs, true, stateRef.current.session.volumeMl);
      dispatch({ type: 'SET_EXP_STATE', state: 'RECORDING' });
    },
    onStopRecord: () => {
      const skipped = recorder.stop();
      dispatch({ type: 'SET_EXP_STATE', state: 'STOPPED' });
      dispatch({
        type: 'SET_NOTICE',
        notice: `记录结束：有效数据 ${stateRef.current.session.points.length} 点${skipped > 0 ? `，跳过无效采样 ${skipped} 次` : ''}。可绘制图像或再次播放。`,
      });
    },
    onClearData: () => {
      if (!window.confirm('确定清除全部实验数据吗？此操作不可恢复。')) return;
      recorder.stop();
      replay.current?.stop();
      dispatch({ type: 'CLEAR_SESSION' });
      dispatch({ type: 'SET_EXP_STATE', state: stateRef.current.demoMode ? 'READY' : 'IDLE' });
      dispatch({ type: 'SET_NOTICE', notice: '数据已清除。' });
    },
    onStartReplay: () => {
      recorder.stop();
      demoRef.current?.stop();
      dispatch({ type: 'SET_EXP_STATE', state: 'REPLAYING' });
      dispatch({ type: 'SET_SYNC_MICRO', on: true });
      replay.current?.restart(stateRef.current.replay.speed || 1);
    },
    onToggleDemo: toggleDemo,
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>气体的等容变化</h1>
        <span className="subtitle">实验数据采集与微观可视化工作台</span>
        {state.session.demo && <span className="demo-badge">DEMO 演示数据</span>}
        <span className={`state-chip header-state state-${state.expState.toLowerCase()}`}>{stateLabel(state.expState)}</span>
      </header>

      <main className="grid">
        <div className="col col-left">
          <ScreenCapturePanel controllerRef={ocrRef} />
          <RealtimeValues />
          <ExperimentControls handlers={handlers} />
          <ExperimentTable />
          <PTChart />
        </div>
        <div className="col col-mid">
          <CameraPanel />
        </div>
        <div className="col col-right">
          <MolecularSimulation />
        </div>
      </main>

      <ReplayBar controller={replay} />
      {state.notice && <div className="notice-bar" onClick={() => dispatch({ type: 'SET_NOTICE', notice: '' })}>{state.notice}</div>}
    </div>
  );
}

export default function App() {
  const restored = useMemo(() => loadSession(), []);
  return (
    <ExperimentProvider restored={restored}>
      <Workbench />
    </ExperimentProvider>
  );
}
