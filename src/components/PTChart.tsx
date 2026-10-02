/**
 * p-T 图像：横轴 T/K，纵轴 p/kPa。
 *  - 点击「绘制图像」后才显示散点（保留"先实验、后作图"的教学节奏）；
 *  - 散点始终对应真实记录数据，绝不为美观而修改；
 *  - 可选线性拟合 p = aT + b（不强制过原点），显示 a、b 与 R²；
 *  - 回放时散点按实验发生顺序逐点重现，当前点高亮。
 * Canvas 手绘 + devicePixelRatio 适配，避免额外图表库依赖。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useExperiment } from '../state/ExperimentContext';
import { linearFit, meanPressureTemperatureRatio } from '../physics/fit';

export function PTChart() {
  const { state } = useExperiment();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const [liveFollow, setLiveFollow] = useState(false);
  const [showFit, setShowFit] = useState(false);
  const [rescaleTick, setRescaleTick] = useState(0);

  const points = state.session.points;
  const replaying = state.expState === 'REPLAYING';
  const tVirtual = state.replay.tVirtual;
  /** 是否显示散点：手动绘制 / 实时跟随 / 回放 任一开启 */
  const showPoints = drawn || liveFollow || replaying;

  // 开始新实验时重置"绘制"状态
  useEffect(() => {
    if (points.length === 0) {
      setDrawn(false);
      setShowFit(false);
    }
  }, [points.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = box.clientWidth;
      const H = box.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      const margin = { left: 56, right: 16, top: 14, bottom: 40 };
      const plotW = W - margin.left - margin.right;
      const plotH = H - margin.top - margin.bottom;
      if (plotW < 40 || plotH < 40) return;

      const valid = points.filter((p) => p.temperatureK !== null && p.pressureKPa !== null);
      const visible = replaying ? valid.filter((p) => p.t <= tVirtual) : valid;

      // 坐标范围：根据实际数据自动设置 margin（无数据时用默认量程）
      let tMin = 260;
      let tMax = 380;
      let pMin = 80;
      let pMax = 140;
      if (valid.length > 0 && showPoints) {
        const ts = valid.map((p) => p.temperatureK!);
        const ps = valid.map((p) => p.pressureKPa!);
        tMin = Math.min(...ts);
        tMax = Math.max(...ts);
        pMin = Math.min(...ps);
        pMax = Math.max(...ps);
        const tPad = Math.max((tMax - tMin) * 0.12, 3);
        const pPad = Math.max((pMax - pMin) * 0.12, 3);
        tMin -= tPad;
        tMax += tPad;
        pMin = Math.max(0, pMin - pPad);
        pMax += pPad;
      }
      const x = (T: number) => margin.left + ((T - tMin) / (tMax - tMin)) * plotW;
      const y = (p: number) => margin.top + plotH - ((p - pMin) / (pMax - pMin)) * plotH;

      // 网格与坐标轴
      ctx.strokeStyle = '#d7e3f4';
      ctx.lineWidth = 1;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = '#5b7290';
      const tTicks = niceTicks(tMin, tMax, 6);
      const pTicks = niceTicks(pMin, pMax, 5);
      for (const t of tTicks) {
        ctx.beginPath();
        ctx.moveTo(x(t), margin.top);
        ctx.lineTo(x(t), margin.top + plotH);
        ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillText(t.toFixed(0), x(t), margin.top + plotH + 16);
      }
      for (const p of pTicks) {
        ctx.beginPath();
        ctx.moveTo(margin.left, y(p));
        ctx.lineTo(margin.left + plotW, y(p));
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(p.toFixed(0), margin.left - 6, y(p) + 4);
      }
      ctx.strokeStyle = '#38618f';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(margin.left, margin.top, plotW, plotH);
      ctx.fillStyle = '#1b3a5f';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('T / K', margin.left + plotW / 2, H - 6);
      ctx.save();
      ctx.translate(12, margin.top + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('p / kPa', 0, 0);
      ctx.restore();

      if (!showPoints) {
        ctx.fillStyle = '#8296ad';
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          points.length > 0 ? '实验进行中/已结束——点击「绘制图像」查看 p-T 散点' : '记录数据后在此绘制 p-T 图像',
          margin.left + plotW / 2,
          margin.top + plotH / 2,
        );
        return;
      }

      // 拟合直线（画在散点下层）
      if (showFit && visible.length >= 2) {
        const fit = linearFit(visible.map((p) => p.temperatureK!), visible.map((p) => p.pressureKPa!));
        if (fit) {
          ctx.strokeStyle = '#e63946';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          // 实线段：数据范围内；虚线延长：便于讨论与绝对零度的关系
          const dataTMin = Math.min(...visible.map((p) => p.temperatureK!));
          const dataTMax = Math.max(...visible.map((p) => p.temperatureK!));
          ctx.beginPath();
          ctx.moveTo(x(dataTMin), y(fit.a * dataTMin + fit.b));
          ctx.lineTo(x(dataTMax), y(fit.a * dataTMax + fit.b));
          ctx.stroke();
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x(tMin), y(fit.a * tMin + fit.b));
          ctx.lineTo(x(dataTMin), y(fit.a * dataTMin + fit.b));
          ctx.moveTo(x(dataTMax), y(fit.a * dataTMax + fit.b));
          ctx.lineTo(x(tMax), y(fit.a * tMax + fit.b));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // 散点（回放时逐点重现，当前点高亮；实时描点时最新点高亮）
      const current =
        replaying || (liveFollow && state.expState === 'RECORDING')
          ? visible.length > 0
            ? visible[visible.length - 1]
            : null
          : null;
      for (const p of visible) {
        const cx = x(p.temperatureK!);
        const cy = y(p.pressureKPa!);
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.quality === 'suspect' ? '#ff9f1c' : '#1f6feb';
        ctx.fill();
      }
      if (current) {
        ctx.beginPath();
        ctx.arc(x(current.temperatureK!), y(current.pressureKPa!), 7, 0, Math.PI * 2);
        ctx.strokeStyle = '#e63946';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [points, drawn, liveFollow, showFit, replaying, tVirtual, rescaleTick]);

  const valid = points.filter((p) => p.temperatureK !== null && p.pressureKPa !== null);
  const fit = showFit && valid.length >= 2 ? linearFit(valid.map((p) => p.temperatureK!), valid.map((p) => p.pressureKPa!)) : null;
  const meanRatio = valid.length > 0 ? meanPressureTemperatureRatio(valid) : null;

  return (
    <section className="panel panel-grow">
      <div className="panel-title">
        <span>④ p–T 图像</span>
        <div className="btn-row" style={{ margin: 0 }}>
          <button className="btn btn-primary" disabled={valid.length === 0} onClick={() => setDrawn(true)}>
            绘制图像
          </button>
          <label className="check">
            <input type="checkbox" checked={liveFollow} onChange={(e) => setLiveFollow(e.target.checked)} />
            实时描点
          </label>
          <label className="check">
            <input type="checkbox" checked={showFit} disabled={!showPoints || valid.length < 2} onChange={(e) => setShowFit(e.target.checked)} />
            线性拟合
          </label>
          <button className="btn btn-subtle" onClick={() => setRescaleTick((n) => n + 1)}>
            重新缩放
          </button>
        </div>
      </div>
      <div className="chart-box" ref={boxRef}>
        <canvas ref={canvasRef} />
      </div>
      <div className="chart-footer">
        {fit && (
          <span>
            拟合：p = {fit.a.toFixed(3)}·T {fit.b >= 0 ? '+' : '−'} {Math.abs(fit.b).toFixed(1)}（R² = {fit.r2.toFixed(4)}）
          </span>
        )}
        {meanRatio !== null && <span>平均 p/T ≈ {meanRatio.toFixed(3)} kPa/K</span>}
        {!fit && meanRatio === null && <span className="meta-text">等容变化：理论上 p/T 近似为定值（p ∝ T）</span>}
      </div>
    </section>
  );
}

/** 生成"漂亮"刻度（1/2/2.5/5 × 10^n） */
function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0) return [min];
  const rawStep = span / count;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}
