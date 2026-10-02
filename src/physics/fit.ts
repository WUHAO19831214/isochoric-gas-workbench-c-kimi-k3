/**
 * 最小二乘线性拟合 p = a·T + b。
 * 注意：不强制过原点 —— 真实实验存在系统误差与测量误差，
 * 拟合仅用于课堂验证 p 与 T 的线性关系，原始散点始终是实验结论的依据。
 */

export interface LinearFitResult {
  /** 斜率 a（kPa/K），等容条件下 a ≈ p/T 的平均比值 */
  a: number;
  /** 截距 b（kPa） */
  b: number;
  /** 决定系数 R² */
  r2: number;
  n: number;
}

export function linearFit(xs: number[], ys: number[]): LinearFitResult | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const a = sxy / sxx;
  const b = my - a * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2, n };
}

/** 平均 p/T 比值（等容变化的理论预期：p/T ≈ 常量），仅统计有效点 */
export function meanPressureTemperatureRatio(
  points: { pressureKPa: number | null; temperatureK: number | null }[],
): number | null {
  let s = 0;
  let n = 0;
  for (const p of points) {
    if (p.pressureKPa != null && p.temperatureK != null && p.temperatureK > 0) {
      s += p.pressureKPa / p.temperatureK;
      n++;
    }
  }
  return n > 0 ? s / n : null;
}
