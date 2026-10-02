/**
 * 右栏：气体分子运动的微观解释（Three.js + 理想气体教学模型）。
 *
 * 物理实现（见 src/physics/）：
 *  - 分子初速度按当前温度的 Maxwell–Boltzmann 分布抽样（速度分量 ~ N(0, kT/m)）；
 *  - 与试管壁（圆柱侧面 + 圆底半球 + 顶部密封塞）完全弹性碰撞；
 *  - 温度变化时全体分子速率 × sqrt(T2/T1)，统计上严格满足 v_rms ∝ sqrt(T)；
 *  - 分子由温度 T 单向驱动（因果律正确）：压强是微观撞击涌现出的宏观结果。
 *
 * HUD 为"因式分解式"宏微观证据链（等容升温压强增大的微观原因）：
 *  - 撞得更勤：碰撞频率因子 f/f₀ ∝ √T（EMA 实测）
 *  - 撞得更猛：平均冲量因子 Ī/Ī₀ ∝ √T（EMA 实测）
 *  - 微观合成：(f/f₀)×(Ī/Ī₀) ≈ T/T₀
 *  - 宏观实测：p/p₀（传感器数据）
 * 基准点：宏观以表格第一个有效数据点为 (p₀,T₀)；微观统计在模拟温度
 * 与 T₀ 对齐时自动捕获（回放时同样成立）。
 *
 * 这是"基于分子动理论的教学可视化模型"，不是科研级分子动力学模拟：
 * 分子数与速率均按视觉比例缩放，仅反映统计规律（画面内有标注）。
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GasModel, DEFAULT_GAS_CONFIG } from '../physics/gasModel';
import { vrms } from '../physics/maxwellBoltzmann';
import { liveBus } from '../state/liveBus';
import { useExperiment } from '../state/ExperimentContext';

const FLASH_POOL = 24;
/** 统计平滑时间常数（秒）：EMA 抑制泊松涨落，又足以跟踪升温趋势 */
const EMA_TAU = 2.0;

interface Hud {
  T: number | null;
  p: number | null;
  vrmsRatio: number;
  /** 平均速率因子（全体分子统计，天然稳定） */
  vRatio: number | null;
  /** 碰撞频率因子 f/f₀（事件 EMA 实测） */
  fRatio: number | null;
  /** 平均冲量因子 Ī/Ī₀（事件 EMA 实测） */
  iRatio: number | null;
  /** 宏观实测压强相对值 p/p₀ */
  macroRatio: number | null;
  collisionsPerSec: number;
}

const COOL = new THREE.Color(0x7fd4ff); // 低能碰撞：冷浅蓝
const WARM = new THREE.Color(0xffb13d); // 高能碰撞：暖金黄

export function MolecularSimulation() {
  const { state, dispatch } = useExperiment();
  const mountRef = useRef<HTMLDivElement>(null);
  const [hud, setHud] = useState<Hud>({
    T: null,
    p: null,
    vrmsRatio: 1,
    vRatio: null,
    fRatio: null,
    iRatio: null,
    macroRatio: null,
    collisionsPerSec: 0,
  });
  const syncOn = state.syncMicro;
  const syncOnRef = useRef(syncOn);
  useEffect(() => {
    syncOnRef.current = syncOn;
  }, [syncOn]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const cfg = DEFAULT_GAS_CONFIG;
    const model = new GasModel();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1424);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(3.6, 2.4, 5.0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3;
    controls.maxDistance = 12;

    // 灯光
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 6, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x6fa8ff, 12, 30);
    rim.position.set(-4, 3, -3);
    scene.add(rim);

    // 透明玻璃试管：圆柱段 + 圆底半球
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0x8fbdf5,
      transparent: true,
      opacity: 0.13,
      shininess: 90,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const tubeWall = new THREE.Mesh(new THREE.CylinderGeometry(cfg.radius, cfg.radius, cfg.height, 48, 1, true), glassMat);
    tubeWall.position.y = cfg.height / 2;
    scene.add(tubeWall);
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.radius, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      glassMat,
    );
    scene.add(bottom);
    const rimRing = new THREE.Mesh(
      new THREE.TorusGeometry(cfg.radius + 0.02, 0.035, 12, 48),
      new THREE.MeshPhongMaterial({ color: 0xa9c6ef, transparent: true, opacity: 0.55 }),
    );
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = cfg.height;
    scene.add(rimRing);
    const stopper = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.radius * 0.92, cfg.radius * 0.86, 0.5, 48),
      new THREE.MeshPhongMaterial({ color: 0x30343d, shininess: 8 }),
    );
    stopper.position.y = cfg.height + 0.22;
    scene.add(stopper);
    const stopperCap = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.radius * 1.08, cfg.radius * 1.08, 0.12, 48),
      new THREE.MeshPhongMaterial({ color: 0x23262d }),
    );
    stopperCap.position.y = cfg.height + 0.5;
    scene.add(stopperCap);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshBasicMaterial({ color: 0x12233d, transparent: true, opacity: 0.8 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -cfg.radius - 0.02;
    scene.add(ground);

    // 分子粒子（InstancedMesh，颜色仅有轻微差异以增强空间感，不暗示不同分子种类）
    const particleGeo = new THREE.SphereGeometry(cfg.particleRadius, 10, 10);
    const particleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const particles = new THREE.InstancedMesh(particleGeo, particleMat, model.particleCount);
    particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const baseColor = new THREE.Color();
    for (let i = 0; i < model.particleCount; i++) {
      const shade = 0.75 + Math.random() * 0.25;
      baseColor.setRGB(0.62 * shade + 0.2, 0.78 * shade + 0.15, 1.0 * shade);
      particles.setColorAt(i, baseColor);
    }
    scene.add(particles);

    // 器壁碰撞微闪光：每个闪光独立材质（颜色按碰撞能量分级）
    const flashes: THREE.Mesh[] = [];
    for (let i = 0; i < FLASH_POOL; i++) {
      const f = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0x7fd4ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      f.visible = false;
      scene.add(f);
      flashes.push(f);
    }
    let flashCursor = 0;

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w < 10 || h < 10) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ===== 统计状态 =====
    const clock = new THREE.Clock();
    const dummy = new THREE.Object3D();
    const t0Vrms = vrms(cfg.referenceTemperatureK);
    let simTemp = cfg.referenceTemperatureK;
    let emaF = 0; // 碰撞频率 EMA（次/秒）
    let emaI = 0; // 平均冲量 EMA
    let emaInitialized = false;
    let emaStartedAt = 0;
    let emaEventCount = 0;
    let currentMeanV = 0;
    let macroBaselineAt: number | null = null; // 宏观基准出现的时间（用于兜底捕获）
    /** 基准捕获积累器：只在"同步 + 温度对齐 T₀"的当前态下积累，
     *  避免待机/初始化瞬态的 EMA 历史污染基准（实测曾因此偏差 3~7 倍） */
    let capAccum: { t: number; count: number; impulseSum: number; vSum: number; vFrames: number } | null = null;
    let hudTimer = 0;
    let raf = 0;

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const st = stateRef.current;

      // 当前应呈现的温度：同步开启时跟随实时/回放温度，否则保持参考温度
      const { simTemperatureK, simPressureKPa } = liveBus.get();
      const synced = syncOnRef.current && simTemperatureK !== null;
      const targetT = synced ? simTemperatureK : cfg.referenceTemperatureK;
      const tau = 0.6;
      simTemp += (targetT - simTemp) * (1 - Math.exp(-dt / tau));
      if (Math.abs(simTemp - model.temperatureK) > 0.01) {
        model.setTemperature(simTemp);
      }

      model.step(dt * (synced ? 1 : 0.6));

      // ===== 碰撞事件：微闪光（能量色彩分级）+ EMA 统计 =====
      const events = model.drainCollisions();
      const vrmsVisual = model.currentVisualVrms();
      for (const ev of events) {
        const f = flashes[flashCursor % FLASH_POOL];
        flashCursor++;
        f.position.set(ev.x, ev.y, ev.z);
        f.visible = true;
        const m = f.material as THREE.MeshBasicMaterial;
        // 能量分级：法向速率越高越偏暖金色、光斑越大
        const t = Math.min(1, ev.normalSpeed / (2.2 * vrmsVisual));
        m.color.copy(COOL).lerp(WARM, t);
        m.opacity = 0.65 + t * 0.3;
        f.scale.setScalar(0.5 + t * 1.2);
      }
      for (const f of flashes) {
        if (!f.visible) continue;
        const m = f.material as THREE.MeshBasicMaterial;
        m.opacity *= Math.exp(-dt * 6);
        if (m.opacity < 0.03) f.visible = false;
      }

      // EMA 统计：碰撞频率（次/秒）与平均冲量
      const k = 1 - Math.exp(-dt / EMA_TAU);
      const instRate = dt > 0 ? events.length / dt : 0;
      if (!emaInitialized && events.length > 0) {
        emaF = instRate;
        emaI = events.reduce((s, e) => s + e.impulse, 0) / events.length;
        emaInitialized = true;
        emaStartedAt = performance.now();
        emaEventCount = events.length;
      } else if (emaInitialized) {
        emaF += (instRate - emaF) * k;
        emaEventCount += events.length;
        if (events.length > 0) {
          const instI = events.reduce((s, e) => s + e.impulse, 0) / events.length;
          emaI += (instI - emaI) * k;
        }
      }

      // 全体分子平均速率（比碰撞事件统计稳定得多，作为频率/冲量因子的锚）
      let vSum = 0;
      for (let i = 0; i < model.particleCount; i++) {
        const o = i * 3;
        vSum += Math.hypot(model.velocities[o], model.velocities[o + 1], model.velocities[o + 2]);
      }
      currentMeanV = vSum / model.particleCount;

      // ===== 微观基准捕获：同步态 + 模拟温度对齐 T₀ 时，当前态积累 1.5s 求基线 =====
      const mb = st.macroBaseline;
      if (mb && !macroBaselineAt) macroBaselineAt = performance.now();
      if (!mb) macroBaselineAt = null;
      if (mb && !st.microBaseline) {
        const aligned = synced && Math.abs(simTemp - mb.T) < 3;
        if (aligned) {
          if (!capAccum) capAccum = { t: 0, count: 0, impulseSum: 0, vSum: 0, vFrames: 0 };
          capAccum.t += dt;
          capAccum.count += events.length;
          for (const e of events) capAccum.impulseSum += e.impulse;
          capAccum.vSum += currentMeanV;
          capAccum.vFrames++;
          if (capAccum.t >= 1.5 && capAccum.count > 10) {
            dispatch({
              type: 'SET_MICRO_BASELINE',
              f: capAccum.count / capAccum.t,
              I: capAccum.impulseSum / capAccum.count,
              v: capAccum.vSum / capAccum.vFrames,
            });
            capAccum = null;
          }
        } else {
          capAccum = null; // 离开对齐窗口则放弃本轮积累（回放升温越过 T₀ 后不再捕获）
          // 兜底：基准长期未捕获（如回放直接从中段开始），用当前同步态 EMA 近似
          const timeout = macroBaselineAt !== null && performance.now() - macroBaselineAt > 8000;
          if (timeout && synced && emaInitialized && emaF > 0 && emaI > 0) {
            dispatch({ type: 'SET_MICRO_BASELINE', f: emaF, I: emaI, v: currentMeanV });
          }
        }
      }

      // 更新粒子矩阵
      for (let i = 0; i < model.particleCount; i++) {
        const o = i * 3;
        dummy.position.set(model.positions[o], model.positions[o + 1], model.positions[o + 2]);
        dummy.updateMatrix();
        particles.setMatrixAt(i, dummy.matrix);
      }
      particles.instanceMatrix.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);

      // HUD 4 Hz 刷新
      hudTimer += dt;
      if (hudTimer > 0.25) {
        hudTimer = 0;
        const micro = st.microBaseline;
        const macro = st.macroBaseline;
        setHud({
          T: synced ? simTemperatureK : null,
          p: synced ? simPressureKPa : null,
          vrmsRatio: vrms(simTemp) / t0Vrms,
          vRatio: micro && currentMeanV > 0 ? currentMeanV / micro.v : null,
          fRatio: micro && emaF > 0 ? emaF / micro.f : null,
          iRatio: micro && emaI > 0 ? emaI / micro.I : null,
          macroRatio: macro && simPressureKPa !== null && synced ? simPressureKPa / macro.p : null,
          collisionsPerSec: emaF,
        });
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const microReady = hud.fRatio !== null && hud.iRatio !== null;
  const microProduct = microReady ? hud.fRatio! * hud.iRatio! : null;

  return (
    <section className="panel panel-fill sim-panel">
      <div className="panel-title">
        <span>气体分子运动的微观解释</span>
        <label className="check sync-check">
          <input type="checkbox" checked={state.syncMicro} onChange={(e) => dispatch({ type: 'SET_SYNC_MICRO', on: e.target.checked })} />
          同步显示
        </label>
      </div>
      <div className="sim-box" ref={mountRef}>
        {!syncOn && (
          <div className="sim-overlay">
            <div className="sim-overlay-text">
              微观模型暂未开启
              <br />
              <small>建立宏观规律后，勾选「同步显示」查看微观解释</small>
            </div>
          </div>
        )}
        <div className="sim-hud">
          <div className="hud-row hud-main">
            T = {hud.T !== null ? `${hud.T.toFixed(1)} K` : '—'}　p = {hud.p !== null ? `${hud.p.toFixed(1)} kPa` : '—'}　V = {state.session.volumeMl} mL（恒定）
          </div>
          <div className="hud-row">
            平均速率 ⟨v⟩/⟨v₀⟩ = {hud.vRatio !== null ? hud.vRatio.toFixed(3) : '—'}　<span className="hud-theory">理论 √(T/T₀) = {hud.vrmsRatio.toFixed(3)}</span>
          </div>
          <div className="hud-row">
            撞得更勤：频率因子 f/f₀ = {hud.fRatio !== null ? hud.fRatio.toFixed(2) : '—'}
            <span className="hud-theory">（≈{(state.macroBaseline && hud.T !== null ? Math.sqrt(hud.T / state.macroBaseline.T) : hud.vrmsRatio).toFixed(2)}）</span>
          </div>
          <div className="hud-row">
            撞得更猛：冲量因子 Ī/Ī₀ = {hud.iRatio !== null ? hud.iRatio.toFixed(2) : '—'}
            <span className="hud-theory">（≈{(state.macroBaseline && hud.T !== null ? Math.sqrt(hud.T / state.macroBaseline.T) : hud.vrmsRatio).toFixed(2)}）</span>
          </div>
          <div className="hud-row hud-key">
            微观等效压强 (f/f₀)×(Ī/Ī₀) = {microProduct !== null ? microProduct.toFixed(2) : '—'}
            <span className="hud-theory">（≈T/T₀ = {state.macroBaseline && hud.T !== null ? (hud.T / state.macroBaseline.T).toFixed(2) : '—'}）</span>
          </div>
          <div className="hud-row hud-key hud-macro">
            宏观实测压强 p/p₀ = {hud.macroRatio !== null ? hud.macroRatio.toFixed(2) : '—'}
          </div>
          <div className="hud-row hud-sub">器壁碰撞 ≈ {hud.collisionsPerSec.toFixed(0)} 次/秒（EMA）</div>
        </div>
        <div className="sim-note">
          示意模拟：分子数与速率均按比例缩放，仅反映统计规律（v ∝ √T，Maxwell–Boltzmann 分布）；
          基准 p₀、T₀ 取实验第一个有效数据点
        </div>
      </div>
    </section>
  );
}
