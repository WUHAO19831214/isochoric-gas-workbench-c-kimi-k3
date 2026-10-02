/**
 * 实时读数：压强 / 温度大号数字 + 置信度与识别状态。
 * 直接订阅 liveBus（2 Hz），不走 React 全局状态，避免整树重渲染。
 */

import { useSyncExternalStore } from 'react';
import { liveBus } from '../state/liveBus';

export function RealtimeValues() {
  const snap = useSyncExternalStore(
    (cb) => liveBus.subscribeReading(cb),
    () => liveBus.get(),
  );
  const r = snap.reading;

  return (
    <div className="realtime-values">
      <div className="value-card">
        <div className="value-label">当前压强 p</div>
        <div className="value-number">
          {r.pressureKPa !== null ? r.pressureKPa.toFixed(1) : '--.-'}
          <span className="value-unit">kPa</span>
        </div>
        <ConfidenceBar value={r.pressureConfidence} />
      </div>
      <div className="value-card">
        <div className="value-label">当前温度 T</div>
        <div className="value-number">
          {r.temperatureK !== null ? r.temperatureK.toFixed(1) : '--.-'}
          <span className="value-unit">K</span>
        </div>
        <ConfidenceBar value={r.temperatureConfidence} />
      </div>
      <div className={`reading-status reading-${r.status}`}>
        {r.status === 'ok' && '● 识别正常'}
        {r.status === 'partial' && '◐ 部分识别失败'}
        {r.status === 'failed' && '○ 识别失败 / 等待稳定识别'}
        {r.status === 'idle' && '○ 未开始识别'}
      </div>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? '#2ec4b6' : value >= 55 ? '#ff9f1c' : '#e63946';
  return (
    <div className="conf-row" title={`OCR 置信度（仅供参考，置信度≠准确率）`}>
      <div className="conf-bar">
        <div className="conf-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="conf-text">置信度 {value}%</span>
    </div>
  );
}
