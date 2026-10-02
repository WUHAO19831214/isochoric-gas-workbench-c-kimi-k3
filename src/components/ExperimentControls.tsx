/**
 * 实验控制区：体积锁定、采样间隔、记录控制、绘图、回放、演示模式、导入导出。
 * 所有按钮的启用/禁用由状态机统一决定（can()）。
 */

import React, { useRef } from 'react';
import { useExperiment, can } from '../state/ExperimentContext';
import { SAMPLING_OPTIONS } from '../types';
import { sessionToCsv, sessionToJson, parseSessionJson, downloadText, exportCsvFilename } from '../utils/csv';
import { buildDemoSession } from '../controllers/demo';

export interface ControlHandlers {
  onStartRecord: () => void;
  onPauseRecord: () => void;
  onResumeRecord: () => void;
  onStopRecord: () => void;
  onClearData: () => void;
  onStartReplay: () => void;
  onToggleDemo: (on: boolean) => void;
}

export function ExperimentControls({ handlers }: { handlers: ControlHandlers }) {
  const { state, dispatch } = useExperiment();
  const c = can(state);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportCsv = () => downloadText(exportCsvFilename(state.session), sessionToCsv(state.session), 'text/csv;charset=utf-8');
  const exportJson = () =>
    downloadText(exportCsvFilename(state.session).replace(/\.csv$/, '.json'), sessionToJson(state.session), 'application/json');

  const importJson = async (file: File) => {
    try {
      const session = parseSessionJson(await file.text());
      dispatch({ type: 'LOAD_SESSION', session });
      dispatch({ type: 'SET_EXP_STATE', state: 'STOPPED' });
      dispatch({ type: 'SET_NOTICE', notice: `已导入实验数据（${session.points.length} 个点${session.demo ? '，DEMO 数据' : ''}），可绘图或回放。` });
    } catch (err) {
      dispatch({ type: 'SET_NOTICE', notice: `导入失败：${err instanceof Error ? err.message : String(err)}` });
    }
  };

  return (
    <section className="panel">
      <div className="panel-title">
        <span>② 实验控制</span>
        <span className="state-chip">{stateLabel(state.expState)}</span>
      </div>

      <div className="config-row">
        <label>
          气体体积 V：
          <input
            className="num-input"
            type="number"
            min={1}
            step={1}
            value={state.volumeInputMl}
            disabled={!c.editVolume}
            onChange={(e) => dispatch({ type: 'SET_VOLUME_INPUT', volumeMl: Number(e.target.value) || 0 })}
          />
          mL{c.editVolume ? '' : '（已锁定）'}
        </label>
        <label>
          采样间隔：
          <select
            className="num-input"
            value={state.samplingIntervalMs}
            disabled={!c.editSampling}
            onChange={(e) => dispatch({ type: 'SET_SAMPLING_INTERVAL', ms: Number(e.target.value) })}
          >
            {SAMPLING_OPTIONS.map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000} s
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="btn-row">
        {state.expState === 'PAUSED' ? (
          <button className="btn btn-primary" disabled={!c.resumeRecord} onClick={handlers.onResumeRecord}>
            继续记录
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!c.startRecord} onClick={handlers.onStartRecord}>
            开始记录
          </button>
        )}
        <button className="btn" disabled={!c.pauseRecord} onClick={handlers.onPauseRecord}>
          暂停
        </button>
        <button className="btn" disabled={!c.stopRecord} onClick={handlers.onStopRecord}>
          停止记录
        </button>
        <button className="btn btn-danger" disabled={!c.clearData} onClick={handlers.onClearData}>
          清除数据
        </button>
        <button className="btn" disabled={!c.replay} onClick={handlers.onStartReplay}>
          ▶ 再次播放
        </button>
      </div>

      <div className="btn-row">
        <button className="btn" disabled={!c.exportData} onClick={exportCsv}>
          导出 CSV
        </button>
        <button className="btn" disabled={!c.exportData} onClick={exportJson}>
          导出 JSON
        </button>
        <button className="btn btn-subtle" onClick={() => fileRef.current?.click()}>
          导入数据
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="btn-row small-row">
        <label className="check">
          <input
            type="checkbox"
            checked={state.demoMode}
            disabled={state.expState === 'RECORDING' || state.expState === 'PAUSED'}
            onChange={(e) => handlers.onToggleDemo(e.target.checked)}
          />
          演示模式（无仪器时使用，数据标记 DEMO）
        </label>
        <button
          className="btn btn-subtle"
          onClick={() => {
            dispatch({ type: 'LOAD_SESSION', session: buildDemoSession(state.volumeInputMl, 2000) });
            dispatch({ type: 'SET_EXP_STATE', state: 'STOPPED' });
            dispatch({ type: 'SET_NOTICE', notice: '已载入内置演示数据（DEMO），可直接绘图或回放。' });
          }}
        >
          载入示例数据
        </button>
        <span className="meta-text">
          已记录 <b>{state.session.points.length}</b> 点 · 用时 <b>{formatElapsed(state.elapsedSec)}</b>
        </span>
      </div>
    </section>
  );
}

export function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function stateLabel(s: string): string {
  switch (s) {
    case 'IDLE':
      return '待配置';
    case 'CONFIGURING':
      return '配置识别区域';
    case 'READY':
      return '就绪';
    case 'RECORDING':
      return '● 记录中';
    case 'PAUSED':
      return '已暂停';
    case 'STOPPED':
      return '已停止';
    case 'REPLAYING':
      return '▶ 回放中';
    default:
      return s;
  }
}
