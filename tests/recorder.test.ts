/**
 * 记录控制器数据质量测试：
 *  - 压强无硬上限：真实大压强值（如 500 kPa）可正常记录；
 *  - 历史交叉验证：读数突然偏离基线 15% 以上（识别框串行）被拦截不入表；
 *  - 读数恢复正常后记录自动继续。
 */

import { describe, it, expect } from 'vitest';
import { RecorderController } from '../src/controllers/recorder';
import { liveBus } from '../src/state/liveBus';
import type { AppAction } from '../src/state/ExperimentContext';
import type { DataPoint } from '../src/types';

function feedReading(p: number, T: number, conf = 95): void {
  liveBus.setReading({
    pressureKPa: p,
    temperatureK: T,
    pressureConfidence: conf,
    temperatureConfidence: conf,
    pressureRaw: String(p),
    temperatureRaw: String(T),
    status: 'ok',
    updatedAt: Date.now(),
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('RecorderController 数据质量', () => {
  it('真实大压强可记录，串行偏离值被拦截，恢复后继续记录', async () => {
    const points: DataPoint[] = [];
    const dispatch = (a: AppAction) => {
      if (a.type === 'APPEND_POINT') points.push(a.point);
    };
    const rec = new RecorderController(dispatch);

    // 大压强真实场景（超过旧版 300 kPa 死板上限）
    feedReading(500, 300);
    rec.start(15, false, 100);
    await wait(90);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points[0].pressureKPa).toBe(500); // 不被上限误伤

    // 识别框串行：压强位置读到温度值 303（偏离基线 39%）
    feedReading(303, 300);
    await wait(90);
    expect(points.filter((pt) => pt.pressureKPa === 303).length).toBe(0);

    // 读数恢复正常 → 记录继续
    feedReading(505, 300);
    await wait(70);
    expect(points.some((pt) => pt.pressureKPa === 505)).toBe(true);

    rec.stop();
  });

  it('低置信度与超范围温度不入表', async () => {
    const points: DataPoint[] = [];
    const dispatch = (a: AppAction) => {
      if (a.type === 'APPEND_POINT') points.push(a.point);
    };
    const rec = new RecorderController(dispatch);
    feedReading(106, 303, 30); // 置信度过低
    rec.start(15, false, 100);
    await wait(50);
    feedReading(106, 999, 95); // 温度超物理范围
    await wait(50);
    expect(points.length).toBe(0);
    rec.stop();
  });
});
