/**
 * CSV / JSON 导出与 JSON 导入。
 * CSV 面向 Excel 课后分析；JSON 保留完整 session 元数据，可用于课堂回放。
 */

import type { DataPoint, ExperimentSession } from '../types';

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function sessionToCsv(session: ExperimentSession): string {
  const header = 'time_s,pressure_kPa,temperature_K,volume_mL,quality,edited,timestamp';
  const rows = session.points.map((p) =>
    [
      p.t.toFixed(1),
      p.pressureKPa == null ? '' : p.pressureKPa.toFixed(2),
      p.temperatureK == null ? '' : p.temperatureK.toFixed(2),
      p.volumeMl.toFixed(1),
      p.quality,
      p.editedByUser ? 'yes' : 'no',
      p.timestamp,
    ].join(','),
  );
  // 前置 BOM 让 Excel 正确识别 UTF-8 中文
  return '﻿' + header + '\n' + rows.join('\n');
}

export function sessionToJson(session: ExperimentSession): string {
  return JSON.stringify(session, null, 2);
}

export function parseSessionJson(text: string): ExperimentSession {
  const parsed = JSON.parse(text) as ExperimentSession;
  if (parsed?.version !== 1 || !Array.isArray(parsed.points)) {
    throw new Error('不是有效的实验数据 JSON（需要 version=1 且包含 points 数组）');
  }
  return parsed;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function exportCsvFilename(session: ExperimentSession): string {
  const stamp = session.createdAt.slice(0, 19).replace(/[:T]/g, '-');
  return `等容变化实验数据${session.demo ? '-DEMO' : ''}-${stamp}.csv`;
}

export function pointToCsvRow(p: DataPoint): string {
  return csvEscape(String(p.t));
}
