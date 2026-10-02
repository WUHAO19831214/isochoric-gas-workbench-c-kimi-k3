/**
 * 物理常数与麦克斯韦–玻尔兹曼速率分布抽样。
 *
 * 科学依据（分子动理论）：
 *  - 平均平动动能 <Ek> = (3/2) k_B T
 *  - 均方根速率 v_rms = sqrt(3 k_B T / m)，故同种气体 v_rms ∝ sqrt(T)
 *  - 三维速度每个分量服从高斯分布 N(0, k_B T / m)，
 *    速率 |v| 即服从 Maxwell–Boltzmann 分布：
 *    f(v) = 4π (m / 2π k_B T)^(3/2) v² exp(-m v² / 2 k_B T)
 */

export const K_B = 1.380649e-23; // Boltzmann 常数 J/K
/** 氮气分子质量（kg），作为空气的代表性近似 */
export const M_N2 = 4.65e-26;

/** 均方根速率 v_rms = sqrt(3 k_B T / m)（单位 m/s） */
export function vrms(temperatureK: number, massKg: number = M_N2): number {
  return Math.sqrt((3 * K_B * temperatureK) / massKg);
}

/** Box–Muller：标准正态分布抽样 */
export function sampleGaussian(rng: () => number = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng(); // 防止 log(0)
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * 按 Maxwell–Boltzmann 分布抽样一个三维速度向量。
 * 每个分量独立服从 N(0, k_B T / m) —— 这与直接对 f(v) 抽样速率再随机方向
 * 在统计上完全等价，且实现更稳定。
 * 返回 [vx, vy, vz]，单位 m/s。
 */
export function sampleMaxwellVelocity(
  temperatureK: number,
  massKg: number = M_N2,
  rng: () => number = Math.random,
): [number, number, number] {
  const sigma = Math.sqrt((K_B * temperatureK) / massKg);
  return [sampleGaussian(rng) * sigma, sampleGaussian(rng) * sigma, sampleGaussian(rng) * sigma];
}

/**
 * 温度从 T1 变为 T2 时的速率缩放因子 sqrt(T2/T1)。
 * 对 Maxwell 分布整体缩放速度严格等价于在新温度下重新抽样
 * （高斯分布乘以常数仍是高斯分布，方差按比例变化），
 * 因此温度变化时不需要重新抽样，只需按比例缩放每个分子的速度，
 * 这样既保持粒子速率分布的统计形状，又避免"温度一换所有分子突然同速"。
 */
export function temperatureSpeedScale(tFromK: number, tToK: number): number {
  return Math.sqrt(tToK / tFromK);
}
