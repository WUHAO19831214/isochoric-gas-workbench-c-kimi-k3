/**
 * 物理正确性单元测试：
 *  1. Maxwell–Boltzmann 抽样的统计性质（分量方差、v_rms）；
 *  2. 温度缩放严格满足 v_rms ∝ sqrt(T)；
 *  3. 分子永不穿出试管壁（弹性碰撞约束）；
 *  4. 最小二乘拟合的正确性（不强制过原点）。
 */

import { describe, it, expect } from 'vitest';
import { sampleMaxwellVelocity, vrms, temperatureSpeedScale, K_B, M_N2 } from '../src/physics/maxwellBoltzmann';
import { GasModel } from '../src/physics/gasModel';
import { linearFit } from '../src/physics/fit';

describe('Maxwell–Boltzmann 抽样', () => {
  const T = 300;
  const N = 6000;

  it('速度分量均值≈0，方差≈ kT/m', () => {
    let mx = 0;
    let vx2 = 0;
    for (let i = 0; i < N; i++) {
      const [vx] = sampleMaxwellVelocity(T);
      mx += vx;
      vx2 += vx * vx;
    }
    mx /= N;
    vx2 /= N;
    const expected = (K_B * T) / M_N2;
    expect(Math.abs(mx)).toBeLessThan(Math.sqrt(expected) * 0.05);
    expect(vx2 / expected).toBeGreaterThan(0.92);
    expect(vx2 / expected).toBeLessThan(1.08);
  });

  it('经验均方根速率 ≈ sqrt(3kT/m)', () => {
    let s = 0;
    for (let i = 0; i < N; i++) {
      const [vx, vy, vz] = sampleMaxwellVelocity(T);
      s += vx * vx + vy * vy + vz * vz;
    }
    const empirical = Math.sqrt(s / N);
    expect(empirical / vrms(T)).toBeGreaterThan(0.97);
    expect(empirical / vrms(T)).toBeLessThan(1.03);
  });

  it('粒子速率有分布而非全部相同（标准差显著大于 0）', () => {
    const speeds: number[] = [];
    for (let i = 0; i < 500; i++) {
      const [vx, vy, vz] = sampleMaxwellVelocity(T);
      speeds.push(Math.hypot(vx, vy, vz));
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
    expect(sd / mean).toBeGreaterThan(0.3); // MB 分布 sd/mean ≈ 0.42
    expect(sd / mean).toBeLessThan(0.6);
  });
});

describe('温度缩放 v ∝ sqrt(T)', () => {
  it('temperatureSpeedScale = sqrt(T2/T1)', () => {
    expect(temperatureSpeedScale(300, 600)).toBeCloseTo(Math.SQRT2, 10);
    expect(temperatureSpeedScale(100, 400)).toBeCloseTo(2, 10);
  });

  it('GasModel.setTemperature 后经验 v_rms 按 sqrt 比例变化', () => {
    const model = new GasModel({ particleCount: 300 });
    const before = model.currentVisualVrms();
    model.setTemperature(293.15 * 4);
    const after = model.currentVisualVrms();
    expect(after / before).toBeCloseTo(2, 5);
  });
});

describe('器壁约束（完全弹性碰撞）', () => {
  it('长时间演化后所有分子仍在试管内', () => {
    const cfg = { particleCount: 150, radius: 1.0, height: 3.2, particleRadius: 0.045 };
    const model = new GasModel(cfg);
    for (let step = 0; step < 2000; step++) model.step(1 / 60);
    const eps = 1e-4;
    for (let i = 0; i < cfg.particleCount; i++) {
      const o = i * 3;
      const x = model.positions[o];
      const y = model.positions[o + 1];
      const z = model.positions[o + 2];
      const lim = cfg.radius - cfg.particleRadius + eps;
      if (y >= 0) {
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(lim);
        expect(y).toBeLessThanOrEqual(cfg.height - cfg.particleRadius + eps);
      } else {
        expect(Math.hypot(x, y, z)).toBeLessThanOrEqual(lim);
      }
    }
  });

  it('运动过程中持续统计到器壁碰撞', () => {
    const model = new GasModel({ particleCount: 200 });
    for (let step = 0; step < 120; step++) model.step(1 / 60);
    expect(model.totalCollisions).toBeGreaterThan(0);
  });

  it('碰撞前后速率不变（弹性碰撞保持能量）', () => {
    const model = new GasModel({ particleCount: 50 });
    const speed = () => {
      let s = 0;
      for (let i = 0; i < model.particleCount; i++) {
        const o = i * 3;
        s += model.velocities[o] ** 2 + model.velocities[o + 1] ** 2 + model.velocities[o + 2] ** 2;
      }
      return s;
    };
    const before = speed();
    for (let step = 0; step < 600; step++) model.step(1 / 120);
    // Float32 存储引入约 1e-7/步 的相对误差，600 步后仍应远小于 1e-4
    expect(Math.abs(speed() / before - 1)).toBeLessThan(1e-4);
  });
});

describe('最小二乘拟合', () => {
  it('精确线性数据还原斜率与截距，R²=1', () => {
    const xs = [280, 300, 320, 340, 360];
    const ys = xs.map((x) => 0.35 * x + 1.2);
    const fit = linearFit(xs, ys)!;
    expect(fit.a).toBeCloseTo(0.35, 10);
    expect(fit.b).toBeCloseTo(1.2, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
  });

  it('不强制过原点：y = aT + b（b≠0）也能正确拟合', () => {
    const xs = [290, 310, 330, 350];
    const ys = xs.map((x) => 0.3 * x + 15);
    const fit = linearFit(xs, ys)!;
    expect(fit.b).toBeCloseTo(15, 8);
  });

  it('点数不足时返回 null', () => {
    expect(linearFit([1], [2])).toBeNull();
    expect(linearFit([], [])).toBeNull();
  });
});
