/**
 * 实验数据表格：t / p / T / V 四列，滚动、最新行高亮、回放行同步高亮。
 * 异常行标记"suspect"；支持单行编辑（显式标记人工修改）与删除。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useExperiment } from '../state/ExperimentContext';
import { ReplayController } from '../controllers/replay';
import type { DataPoint } from '../types';

export function ExperimentTable() {
  const { state, dispatch } = useExperiment();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const points = state.session.points;
  const replaying = state.expState === 'REPLAYING';
  const replayPoint = replaying ? ReplayController.pointAt(points, state.replay.tVirtual) : null;
  const lastPoint = points.length > 0 ? points[points.length - 1] : null;

  // 记录时自动滚动到最新行
  useEffect(() => {
    if (!replaying && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [points.length, replaying]);

  return (
    <section className="panel">
      <div className="panel-title">
        <span>③ 实验数据</span>
        <span className="meta-text">V = {state.session.volumeMl} mL（恒定）{state.session.demo && <b className="demo-tag">DEMO</b>}</span>
      </div>
      <div className="table-head table-grid">
        <span>时间 t / s</span>
        <span>压强 p / kPa</span>
        <span>温度 T / K</span>
        <span>体积 V / mL</span>
        <span>状态</span>
        <span />
      </div>
      <div className="table-body" ref={bodyRef}>
        {points.length === 0 && <div className="table-empty">尚无数据。设置识别区域与体积后点击「开始记录」。</div>}
        {points.map((p) => {
          const isLive = !replaying && lastPoint?.id === p.id;
          const isReplay = replaying && replayPoint?.id === p.id;
          const dimmed = replaying && p.t > state.replay.tVirtual;
          return (
            <TableRow
              key={p.id}
              point={p}
              highlight={isLive || isReplay}
              dimmed={dimmed}
              editing={editingId === p.id}
              onEdit={() => setEditingId(editingId === p.id ? null : p.id)}
              onSave={(patch) => {
                dispatch({ type: 'UPDATE_POINT', id: p.id, patch });
                setEditingId(null);
              }}
              onDelete={() => dispatch({ type: 'DELETE_POINT', id: p.id })}
            />
          );
        })}
      </div>
    </section>
  );
}

function TableRow({
  point,
  highlight,
  dimmed,
  editing,
  onEdit,
  onSave,
  onDelete,
}: {
  point: DataPoint;
  highlight: boolean;
  dimmed: boolean;
  editing: boolean;
  onEdit: () => void;
  onSave: (patch: Partial<DataPoint>) => void;
  onDelete: () => void;
}) {
  const [pVal, setPVal] = useState(String(point.pressureKPa ?? ''));
  const [tVal, setTVal] = useState(String(point.temperatureK ?? ''));

  const cls = [
    'table-grid',
    'table-row',
    highlight ? 'row-highlight' : '',
    dimmed ? 'row-dimmed' : '',
    point.quality === 'suspect' ? 'row-suspect' : '',
  ].join(' ');

  if (editing) {
    return (
      <div className={cls}>
        <span>{point.t.toFixed(1)}</span>
        <span>
          <input className="cell-input" value={pVal} onChange={(e) => setPVal(e.target.value)} />
        </span>
        <span>
          <input className="cell-input" value={tVal} onChange={(e) => setTVal(e.target.value)} />
        </span>
        <span>{point.volumeMl.toFixed(1)}</span>
        <span className="quality-note">人工修正</span>
        <span className="row-ops">
          <button
            className="mini-btn"
            onClick={() => {
              const p = Number(pVal);
              const t = Number(tVal);
              if (!Number.isFinite(p) || !Number.isFinite(t)) return;
              onSave({ pressureKPa: p, temperatureK: t, quality: 'ok', qualityNote: '教师人工修正' });
            }}
          >
            ✓
          </button>
          <button className="mini-btn" onClick={onEdit}>✕</button>
        </span>
      </div>
    );
  }

  return (
    <div className={cls} title={point.qualityNote ?? ''}>
      <span>{point.t.toFixed(1)}</span>
      <span>{point.pressureKPa !== null ? point.pressureKPa.toFixed(2) : '—'}</span>
      <span>{point.temperatureK !== null ? point.temperatureK.toFixed(2) : '—'}</span>
      <span>{point.volumeMl.toFixed(1)}</span>
      <span className="quality-note">
        {point.editedByUser ? '人工修正' : point.quality === 'suspect' ? '待确认' : ''}
      </span>
      <span className="row-ops">
        <button className="mini-btn" title="编辑此行" onClick={onEdit}>✎</button>
        <button className="mini-btn" title="删除此行" onClick={onDelete}>🗑</button>
      </span>
    </div>
  );
}
