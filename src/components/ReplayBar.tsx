/**
 * 回放控制条：播放/暂停/从头、倍速、进度条。
 * 进度条拖动时，表格 / 当前数值 / p-T 图 / 微观模型通过统一虚拟时钟同步跳转。
 */

import React from 'react';
import { useExperiment } from '../state/ExperimentContext';
import type { ReplayController } from '../controllers/replay';
import { formatElapsed } from './ExperimentControls';

const SPEEDS = [0.5, 1, 2, 4];

export function ReplayBar({ controller }: { controller: React.MutableRefObject<ReplayController | null> }) {
  const { state, dispatch } = useExperiment();
  const replaying = state.expState === 'REPLAYING';
  const points = state.session.points;
  const duration = points.length > 0 ? points[points.length - 1].t : 0;

  if (!replaying) return null;

  const c = controller.current;
  const { playing, speed, tVirtual } = state.replay;

  return (
    <div className="replay-bar">
      <span className="replay-title">实验回放</span>
      {playing ? (
        <button className="btn" onClick={() => c?.pause()}>⏸ 暂停</button>
      ) : (
        <button className="btn btn-primary" onClick={() => c?.play(speed)}>▶ 播放</button>
      )}
      <button className="btn" onClick={() => c?.restart(speed)}>↺ 从头播放</button>
      {SPEEDS.map((s) => (
        <button
          key={s}
          className={`btn btn-speed ${speed === s ? 'btn-armed' : ''}`}
          onClick={() => {
            dispatch({ type: 'REPLAY_SET', patch: { speed: s } });
            if (playing) {
              c?.pause();
              c?.play(s);
            }
          }}
        >
          {s}×
        </button>
      ))}
      <input
        className="replay-slider"
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={tVirtual}
        onChange={(e) => c?.seek(Number(e.target.value))}
      />
      <span className="meta-text">
        {formatElapsed(tVirtual)} / {formatElapsed(duration)}
      </span>
      <button
        className="btn btn-subtle"
        onClick={() => {
          c?.stop();
          dispatch({ type: 'SET_EXP_STATE', state: 'STOPPED' });
        }}
      >
        退出回放
      </button>
    </div>
  );
}
