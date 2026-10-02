/**
 * 实验全局状态：状态机 + session 数据 + 配置。
 * 所有模块共享同一个实验时钟与 Session 状态（见 controllers/recorder.ts）。
 */

import React, { createContext, useContext, useMemo, useReducer } from 'react';
import type {
  DataPoint,
  ExperimentSession,
  ExperimentState,
  RoiConfig,
  RoiRect,
} from '../types';
import { newSession } from '../types';
import { saveSession, clearSavedSession } from '../utils/storage';

export type ScreenStatus = 'idle' | 'active' | 'ended' | 'error';
export type OcrEngineStatus = 'not-loaded' | 'loading' | 'ready' | 'recognizing' | 'error';

export interface ReplayState {
  /** 虚拟回放时钟（秒，对应 DataPoint.t 的时间轴） */
  tVirtual: number;
  playing: boolean;
  speed: number;
}

export interface AppState {
  expState: ExperimentState;
  session: ExperimentSession;
  roi: RoiConfig;
  /** 待生效的体积输入（开始记录后锁定到 session.volumeMl） */
  volumeInputMl: number;
  samplingIntervalMs: number;
  /** 温度 ROI 读到的是摄氏温标时开启，自动换算 T = t + 273.15 */
  celsiusInput: boolean;
  /** 同步显示微观模型（默认关闭：先建立宏观规律，再看微观解释） */
  syncMicro: boolean;
  demoMode: boolean;
  fitVisible: boolean;
  replay: ReplayState;
  screenStatus: ScreenStatus;
  ocrEngineStatus: OcrEngineStatus;
  /** 记录已进行时间（秒，暂停不计） */
  elapsedSec: number;
  /** 宏观压强相对值基准：实验第一个有效数据点（无数据时用初始读数/室温基准） */
  macroBaseline: { p: number; T: number } | null;
  /** 微观统计基准：与宏观基准对齐同一时刻（f₀ 碰撞频率、I₀ 平均冲量、v₀ 平均速率） */
  microBaseline: { f: number; I: number; v: number } | null;
  /** 状态栏提示信息 */
  notice: string;
}

export const initialAppState: AppState = {
  expState: 'IDLE',
  session: newSession(100, 1000, false),
  roi: { pressure: null, temperature: null },
  volumeInputMl: 100,
  samplingIntervalMs: 1000,
  celsiusInput: false,
  syncMicro: false,
  demoMode: false,
  fitVisible: false,
  replay: { tVirtual: 0, playing: false, speed: 1 },
  screenStatus: 'idle',
  ocrEngineStatus: 'not-loaded',
  elapsedSec: 0,
  macroBaseline: null,
  microBaseline: null,
  notice: '',
};

export type AppAction =
  | { type: 'SET_EXP_STATE'; state: ExperimentState }
  | { type: 'SET_SCREEN_STATUS'; status: ScreenStatus }
  | { type: 'SET_OCR_ENGINE_STATUS'; status: OcrEngineStatus }
  | { type: 'SET_ROI'; which: keyof RoiConfig; roi: RoiRect | null }
  | { type: 'SET_VOLUME_INPUT'; volumeMl: number }
  | { type: 'SET_SAMPLING_INTERVAL'; ms: number }
  | { type: 'SET_CELSIUS_INPUT'; on: boolean }
  | { type: 'SET_SYNC_MICRO'; on: boolean }
  | { type: 'SET_DEMO_MODE'; on: boolean }
  | { type: 'SET_FIT_VISIBLE'; on: boolean }
  | { type: 'SET_NOTICE'; notice: string }
  | { type: 'SET_ELAPSED'; sec: number }
  | { type: 'BEGIN_SESSION' } // 锁定 V 与采样间隔，开始一次新实验
  | { type: 'APPEND_POINT'; point: DataPoint }
  | { type: 'UPDATE_POINT'; id: string; patch: Partial<DataPoint> }
  | { type: 'DELETE_POINT'; id: string }
  | { type: 'CLEAR_SESSION' }
  | { type: 'LOAD_SESSION'; session: ExperimentSession }
  | { type: 'REPLAY_SEEK'; tVirtual: number }
  | { type: 'REPLAY_SET'; patch: Partial<ReplayState> }
  | { type: 'SET_MICRO_BASELINE'; f: number; I: number; v: number }
  | { type: 'CLEAR_MICRO_BASELINE' };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_EXP_STATE':
      return { ...state, expState: action.state };
    case 'SET_SCREEN_STATUS':
      return { ...state, screenStatus: action.status };
    case 'SET_OCR_ENGINE_STATUS':
      return { ...state, ocrEngineStatus: action.status };
    case 'SET_ROI':
      return { ...state, roi: { ...state.roi, [action.which]: action.roi } };
    case 'SET_VOLUME_INPUT':
      return { ...state, volumeInputMl: action.volumeMl };
    case 'SET_SAMPLING_INTERVAL':
      return { ...state, samplingIntervalMs: action.ms };
    case 'SET_CELSIUS_INPUT':
      return { ...state, celsiusInput: action.on };
    case 'SET_SYNC_MICRO':
      return { ...state, syncMicro: action.on };
    case 'SET_DEMO_MODE':
      return { ...state, demoMode: action.on };
    case 'SET_FIT_VISIBLE':
      return { ...state, fitVisible: action.on };
    case 'SET_NOTICE':
      return { ...state, notice: action.notice };
    case 'SET_ELAPSED':
      return { ...state, elapsedSec: action.sec };
    case 'BEGIN_SESSION': {
      const session = newSession(state.volumeInputMl, state.samplingIntervalMs, state.demoMode);
      return { ...state, session, elapsedSec: 0, fitVisible: false };
    }
    case 'APPEND_POINT': {
      const session = { ...state.session, points: [...state.session.points, action.point] };
      saveSession(session);
      // 第一个有效数据点自动成为宏观压强相对值基准（p₀, T₀）
      const pt = action.point;
      const macroBaseline =
        state.macroBaseline ??
        (pt.pressureKPa !== null && pt.temperatureK !== null ? { p: pt.pressureKPa, T: pt.temperatureK } : null);
      return { ...state, session, macroBaseline };
    }
    case 'UPDATE_POINT': {
      const session = {
        ...state.session,
        points: state.session.points.map((p) =>
          p.id === action.id ? { ...p, ...action.patch, editedByUser: true } : p,
        ),
      };
      saveSession(session);
      return { ...state, session };
    }
    case 'DELETE_POINT': {
      const session = {
        ...state.session,
        points: state.session.points.filter((p) => p.id !== action.id),
      };
      saveSession(session);
      return { ...state, session };
    }
    case 'CLEAR_SESSION': {
      const session = newSession(state.volumeInputMl, state.samplingIntervalMs, state.demoMode);
      clearSavedSession();
      return {
        ...state,
        session,
        elapsedSec: 0,
        fitVisible: false,
        macroBaseline: null,
        microBaseline: null,
        replay: { tVirtual: 0, playing: false, speed: 1 },
      };
    }
    case 'LOAD_SESSION': {
      saveSession(action.session);
      // 导入数据时以第一个有效点作为宏观基准
      const first = action.session.points.find((p) => p.pressureKPa !== null && p.temperatureK !== null);
      return {
        ...state,
        session: action.session,
        fitVisible: false,
        macroBaseline: first ? { p: first.pressureKPa!, T: first.temperatureK! } : null,
        microBaseline: null,
      };
    }
    case 'REPLAY_SEEK':
      return { ...state, replay: { ...state.replay, tVirtual: action.tVirtual } };
    case 'REPLAY_SET':
      return { ...state, replay: { ...state.replay, ...action.patch } };
    case 'SET_MICRO_BASELINE':
      return { ...state, microBaseline: { f: action.f, I: action.I, v: action.v } };
    case 'CLEAR_MICRO_BASELINE':
      return { ...state, microBaseline: null };
    default:
      return state;
  }
}

const ExperimentContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export function ExperimentProvider({
  children,
  restored,
}: {
  children: React.ReactNode;
  restored?: ExperimentSession | null;
}) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialAppState,
    ...(restored && restored.points.length > 0
      ? {
          session: restored,
          volumeInputMl: restored.volumeMl,
          samplingIntervalMs: restored.samplingIntervalMs,
          demoMode: restored.demo,
          expState: 'STOPPED' as ExperimentState,
          notice: '已恢复上次实验数据（本地缓存）。可绘图、回放或导出。',
        }
      : {}),
  });
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <ExperimentContext.Provider value={value}>{children}</ExperimentContext.Provider>;
}

export function useExperiment() {
  const ctx = useContext(ExperimentContext);
  if (!ctx) throw new Error('useExperiment must be used within ExperimentProvider');
  return ctx;
}

/** 按钮可用性：由状态机统一决定，避免按钮状态混乱 */
export function can(state: AppState) {
  const s = state.expState;
  const hasRoi = state.roi.pressure !== null && state.roi.temperature !== null;
  const screenOk = state.screenStatus === 'active' || state.demoMode;
  const hasPoints = state.session.points.length > 0;
  return {
    selectWindow: s === 'IDLE' || s === 'CONFIGURING' || s === 'READY',
    setRoi: screenOk && (s === 'IDLE' || s === 'CONFIGURING' || s === 'READY'),
    startRecord: (s === 'READY' || s === 'IDLE' || s === 'CONFIGURING') && (hasRoi || state.demoMode),
    pauseRecord: s === 'RECORDING',
    resumeRecord: s === 'PAUSED',
    stopRecord: s === 'RECORDING' || s === 'PAUSED',
    clearData: (s === 'STOPPED' || s === 'READY' || s === 'IDLE' || s === 'CONFIGURING') && hasPoints,
    drawChart: hasPoints && s !== 'REPLAYING',
    replay: hasPoints && (s === 'STOPPED' || s === 'REPLAYING'),
    editVolume: s === 'IDLE' || s === 'CONFIGURING' || s === 'READY',
    editSampling: s === 'IDLE' || s === 'CONFIGURING' || s === 'READY',
    exportData: hasPoints,
  };
}
