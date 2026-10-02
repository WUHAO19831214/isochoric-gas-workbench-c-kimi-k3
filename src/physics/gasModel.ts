/**
 * 理想气体微观教学模型（与渲染解耦，可独立测试）。
 *
 * 模型约定：
 *  - 容器：圆底试管 = 圆柱段（0 ≤ y ≤ height，半径 radius）
 *          + 底部半球（球心在原点，y ≤ 0，半径 radius）。体积固定（等容）。
 *  - 分子视为质点小球，分子间碰撞忽略（理想气体近似的标准教学处理）。
 *  - 分子与管壁发生完全弹性碰撞（镜面反射），碰撞时统计次数与法向动量变化，
 *    用于定性呈现"压强 = 大量分子撞击器壁的平均效果"。
 *  - 速度以"视觉单位/秒"存储：抽样时按 MB 分布在参考温度 T0 下的形状生成，
 *    再乘以一个全局视觉比例因子（真实分子速率约 10² m/s，直接按真实时空
 *    尺度绘制将无法观察；缩放只改变显示速度，不改变 v ∝ sqrt(T) 与
 *    Maxwell–Boltzmann 分布随温度演化的物理关系）。
 */

import { sampleMaxwellVelocity, temperatureSpeedScale, vrms, M_N2 } from './maxwellBoltzmann';

export interface GasModelConfig {
  particleCount: number;
  /** 圆柱段半径（视觉单位） */
  radius: number;
  /** 圆柱段高度（视觉单位），总高约 height + radius */
  height: number;
  /** 参考温度 T0（K），视觉速率标定于此温度 */
  referenceTemperatureK: number;
  /** T0 温度下 v_rms 对应的视觉速度（视觉单位/秒） */
  visualVrmsAtReference: number;
  /** 粒子半径（视觉单位），用于碰撞边界内缩 */
  particleRadius: number;
}

export interface WallCollision {
  /** 碰撞点（视觉单位） */
  x: number;
  y: number;
  z: number;
  /** 碰撞前瞬时法向速率 |v_n|（视觉单位/秒），用于颜色分级 */
  normalSpeed: number;
  /** 冲量 |Δp_n| ∝ 2·m·|v_n|（相对值） */
  impulse: number;
  time: number;
}

export const DEFAULT_GAS_CONFIG: GasModelConfig = {
  particleCount: 200,
  radius: 1.0,
  height: 3.2,
  referenceTemperatureK: 293.15,
  visualVrmsAtReference: 1.6,
  particleRadius: 0.045,
};

export class GasModel {
  readonly config: GasModelConfig;
  /** 位置与速度：长度均为 3N 的扁平数组（x,y,z 交错） */
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  /** 当前模型温度（K） */
  temperatureK: number;
  /** 自上次取数以来的器壁碰撞事件（渲染层取走后清空） */
  collisions: WallCollision[] = [];
  private collisionCounter = 0;

  constructor(config: Partial<GasModelConfig> = {}) {
    this.config = { ...DEFAULT_GAS_CONFIG, ...config };
    const n = this.config.particleCount;
    this.positions = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.temperatureK = this.config.referenceTemperatureK;
    this.initialize(this.config.referenceTemperatureK);
  }

  /** 真实 v_rms(T0) → 视觉速度 的换算比例 */
  private get visualScale(): number {
    return this.config.visualVrmsAtReference / vrms(this.config.referenceTemperatureK, M_N2);
  }

  get particleCount(): number {
    return this.config.particleCount;
  }

  /** 在温度 T 下重新初始化：位置均匀随机、速度按 MB 分布抽样 */
  initialize(temperatureK: number): void {
    this.temperatureK = temperatureK;
    const { radius, height, particleRadius } = this.config;
    const rMax = radius - particleRadius;
    const scale = this.visualScale;
    for (let i = 0; i < this.particleCount; i++) {
      // 按体积比例在圆柱段与半球段之间分配
      const cylVol = Math.PI * radius * radius * height;
      const hemiVol = (2 / 3) * Math.PI * radius ** 3;
      const inCylinder = Math.random() < cylVol / (cylVol + hemiVol);
      let x: number, y: number, z: number;
      if (inCylinder) {
        const r = rMax * Math.sqrt(Math.random());
        const a = Math.random() * 2 * Math.PI;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
        y = Math.random() * height;
      } else {
        // 半球内均匀抽样（拒绝法）
        do {
          x = (Math.random() * 2 - 1) * rMax;
          y = -Math.random() * rMax;
          z = (Math.random() * 2 - 1) * rMax;
        } while (x * x + y * y + z * z > rMax * rMax);
      }
      const [vx, vy, vz] = sampleMaxwellVelocity(temperatureK, M_N2);
      const o = i * 3;
      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.velocities[o] = vx * scale;
      this.velocities[o + 1] = vy * scale;
      this.velocities[o + 2] = vz * scale;
    }
  }

  /**
   * 温度变化：所有分子速率乘以 sqrt(T_new / T_old)。
   * 统计上严格保持 v_rms ∝ sqrt(T)，且保留每个分子的运动方向，
   * 不会出现"所有分子瞬间同速"的非物理画面。
   */
  setTemperature(temperatureK: number): void {
    if (!Number.isFinite(temperatureK) || temperatureK <= 0) return;
    const k = temperatureSpeedScale(this.temperatureK, temperatureK);
    if (Math.abs(k - 1) < 1e-6) return;
    for (let i = 0; i < this.velocities.length; i++) this.velocities[i] *= k;
    this.temperatureK = temperatureK;
  }

  /** 当前粒子群的视觉均方根速率（用于 HUD 显示相对值） */
  currentVisualVrms(): number {
    let s = 0;
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      s +=
        this.velocities[o] ** 2 + this.velocities[o + 1] ** 2 + this.velocities[o + 2] ** 2;
    }
    return Math.sqrt(s / this.particleCount);
  }

  /**
   * 推进一个时间步（dt 为视觉秒）。
   * 与器壁的碰撞为镜面反射；记录碰撞事件供"微闪光"与碰撞频率统计。
   */
  step(dt: number): void {
    const { radius, height, particleRadius } = this.config;
    const rLim = radius - particleRadius;
    const now = performance.now();
    for (let i = 0; i < this.particleCount; i++) {
      const o = i * 3;
      let x = this.positions[o] + this.velocities[o] * dt;
      let y = this.positions[o + 1] + this.velocities[o + 1] * dt;
      let z = this.positions[o + 2] + this.velocities[o + 2] * dt;
      let vx = this.velocities[o];
      let vy = this.velocities[o + 1];
      let vz = this.velocities[o + 2];

      if (y >= 0) {
        // 圆柱段侧壁：法向为径向 (x,0,z)/r
        const r = Math.hypot(x, z);
        if (r > rLim) {
          const nx = x / r;
          const nz = z / r;
          const vn = vx * nx + vz * nz;
          if (vn > 0) {
            vx -= 2 * vn * nx;
            vz -= 2 * vn * nz;
            this.registerCollision(x, y, z, vn, now);
          }
          // 位置钳回壁面
          const f = rLim / r;
          x *= f;
          z *= f;
        }
        // 顶部密封塞：平面 y = height，法向 (0,1,0)
        if (y > height - particleRadius) {
          if (vy > 0) {
            vy = -vy;
            this.registerCollision(x, height, z, vy, now);
          }
          y = height - particleRadius;
        }
      } else {
        // 底部半球：法向为球心指向粒子的方向
        const d = Math.hypot(x, y, z);
        if (d > rLim) {
          const nx = x / d;
          const ny = y / d;
          const nz = z / d;
          const vn = vx * nx + vy * ny + vz * nz;
          if (vn > 0) {
            vx -= 2 * vn * nx;
            vy -= 2 * vn * ny;
            vz -= 2 * vn * nz;
            this.registerCollision(x, y, z, vn, now);
          }
          const f = rLim / d;
          x *= f;
          y *= f;
          z *= f;
        }
      }

      this.positions[o] = x;
      this.positions[o + 1] = y;
      this.positions[o + 2] = z;
      this.velocities[o] = vx;
      this.velocities[o + 1] = vy;
      this.velocities[o + 2] = vz;
    }
  }

  private registerCollision(x: number, y: number, z: number, normalSpeed: number, time: number): void {
    this.collisionCounter++;
    // 渲染层只需要一小撮最近碰撞做闪光，避免分配过多对象
    if (this.collisions.length < 64) {
      this.collisions.push({ x, y, z, normalSpeed, impulse: 2 * normalSpeed, time });
    }
  }

  /** 取走并清空当前累计的碰撞事件 */
  drainCollisions(): WallCollision[] {
    const out = this.collisions;
    this.collisions = [];
    return out;
  }

  get totalCollisions(): number {
    return this.collisionCounter;
  }
}
