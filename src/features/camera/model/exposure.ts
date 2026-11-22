import type {
  CamKey,
  CamSettings,
  ExposureRecord,
  SpotId,
  TrackRec,
} from "../../../shared/types";
import { clamp } from "../../../shared/random";
import {
  SCENE,
  fovHalf,
  sceneAt,
  sceneWeeds,
  swimmerPos,
  thirdRange,
  weedOffset,
  project,
  type CamPose,
  type Swimmer,
} from "./scene";

/** 每组连拍的曝光过程记录上限：2 MB。 */
export const RECORD_BUDGET = 2 * 1024 * 1024;
export const PRECISION_STEPS = [5, 10, 20, 33, 50, 100, 200];

export function framesOf(s: CamSettings) {
  return s.mode === "burst" ? s.burst : 1;
}

/** 拍摄前估算整组连拍的记录体积（按最大同时鱼数保守估计）。 */
export function estimateRecord(s: CamSettings): number {
  const frames = framesOf(s);
  const n = Math.round(s.exposure / (s.precision / 1000)) + 1;
  const perSample = 18 + SCENE.slots * 16;
  const perFrame = 1000 + n * perSample;
  const keys = Math.ceil((s.exposure * frames) / 0.08) * 30;
  return frames * perFrame + keys;
}

/** 不超上限时可维持的最高采样精度；连最粗精度都放不下时返回 null。 */
export function sustainablePrecision(s: CamSettings): number | null {
  for (let i = 0; i < PRECISION_STEPS.length; i++)
    if (estimateRecord({ ...s, precision: PRECISION_STEPS[i] }) <= RECORD_BUDGET)
      return PRECISION_STEPS[i];
  return null;
}

export function recordBytes(rec: ExposureRecord) {
  return JSON.stringify(rec).length;
}

function poseAt(keys: CamKey[], t: number): CamPose {
  if (t <= keys[0].t) return keys[0];
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i].t <= t) {
      const a = keys[i];
      const b = keys[i + 1];
      if (!b) return a;
      const f = clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
      return {
        pan: a.pan + (b.pan - a.pan) * f,
        focal: a.focal + (b.focal - a.focal) * f,
        focus: a.focus + (b.focus - a.focus) * f,
      };
    }
  }
  return keys[keys.length - 1];
}

/** 计算一条鱼在某个采样时刻被遮挡的身体段（bit0头 bit1身 bit2尾，1=不可见）。 */
function occludedMask(
  sw: Swimmer,
  u: number,
  v: number,
  pose: CamPose,
  weeds: ReturnType<typeof sceneWeeds>,
  others: { sw: Swimmer; u: number; v: number }[],
  t: number,
) {
  let oc = 0;
  const z = sw.z;
  const { halfH } = fovHalf(pose.focal);
  const yF = project(pose, u, v, z).y;
  const yHalf = (0.35 * sw.len) / 2 / (z * halfH);
  // 更近的鱼形成的遮挡区（屏幕空间）
  const occ: [number, number][] = [];
  for (const o of others) {
    if (o.sw === sw || o.sw.z >= z - 0.2) continue;
    const oy = project(pose, o.u, o.v, o.sw.z).y;
    const oHalf = (0.35 * o.sw.len) / 2 / (o.sw.z * halfH);
    if (Math.abs(oy - yF) > (yHalf + oHalf) * 0.9) continue;
    const xa = project(pose, o.u - o.sw.len / 2, o.v, o.sw.z).x;
    const xb = project(pose, o.u + o.sw.len / 2, o.v, o.sw.z).x;
    occ.push([Math.min(xa, xb), Math.max(xa, xb)]);
  }
  // 水草遮挡带（屏幕空间，草在鱼之前才遮挡）
  const bands: { x: [number, number]; yLo: number; yHi: number }[] = [];
  for (const w of weeds) {
    if (z <= w.z + 0.1) continue;
    const topV = SCENE.vMax - w.h;
    const midV = (topV + SCENE.vMax) / 2;
    const center = w.u + weedOffset(w, t, midV);
    const xa = project(pose, center - 0.24, midV, w.z).x;
    const xb = project(pose, center + 0.24, midV, w.z).x;
    const yTop = project(pose, center, topV, w.z).y;
    const yBot = project(pose, center, SCENE.vMax, w.z).y;
    bands.push({
      x: [Math.min(xa, xb), Math.max(xa, xb)],
      yLo: Math.min(yTop, yBot),
      yHi: Math.max(yTop, yBot),
    });
  }
  for (let third = 0; third < 3; third++) {
    const [a, b] = thirdRange(sw, u, third);
    const pa = project(pose, a, v, z);
    const pb = project(pose, b, v, z);
    const lo = Math.min(pa.x, pb.x);
    const hi = Math.max(pa.x, pb.x);
    // 取景框外
    if (hi < -1 || lo > 1 || Math.abs(yF) - yHalf > 1.05) {
      oc |= 1 << third;
      continue;
    }
    let hit = false;
    for (const band of bands) {
      if (yF + yHalf < band.yLo || yF - yHalf > band.yHi) continue;
      if (hi > band.x[0] && lo < band.x[1]) {
        hit = true;
        break;
      }
    }
    if (!hit)
      for (const [oa, ob] of occ)
        if (hi > oa && lo < ob) {
          hit = true;
          break;
        }
    if (hit) oc |= 1 << third;
  }
  return oc;
}

/**
 * 把一段曝光窗口按给定精度采样成曝光过程记录。
 * 成片渲染与鱼种识别都只读取这份记录，保证画面与结论一致。
 */
export function finalizeFrame(
  seed: number,
  spot: SpotId,
  win: { start: number; dur: number },
  keys: CamKey[],
  precisionMs: number,
  fi: number,
  fc: number,
  takenAt: number,
): ExposureRecord {
  const weeds = sceneWeeds(seed);
  const build = (dt: number): ExposureRecord => {
    const n = Math.max(2, Math.round(win.dur / dt) + 1);
    const cam = { pan: [] as number[], fo: [] as number[], fc: [] as number[] };
    const trackMap = new Map<string, TrackRec & { last: number }>();
    for (let i = 0; i < n; i++) {
      const t = win.start + Math.min(win.dur, i * dt);
      const pose = poseAt(keys, t - win.start);
      cam.pan.push(Math.round(pose.pan * 10));
      cam.fo.push(Math.round(pose.focal * 10));
      cam.fc.push(Math.round(pose.focus * 100));
      const swimmers = sceneAt(seed, spot, t).map((sw) => ({ sw, ...swimmerPos(sw, t) }));
      for (const { sw, u, v } of swimmers) {
        const id = `${sw.slot}:${sw.k}`;
        let tr = trackMap.get(id);
        if (!tr) {
          tr = {
            sp: sw.sp,
            z: Math.round(sw.z * 100),
            len: Math.round(sw.len * 100),
            dir: sw.dir,
            u: [],
            w: [],
            oc: [],
            last: -1,
          };
          trackMap.set(id, tr);
        }
        // 快门中途才进入（或短暂离开）的鱼，缺失的采样点补为完全不可见，
        // 保证每条轨迹的数组与采样序号一一对应
        for (let gap = tr.last + 1; gap < i; gap++) {
          tr.u.push(Math.round(u * 100));
          tr.w.push(Math.round(v * 100));
          tr.oc.push(7);
        }
        tr.u.push(Math.round(u * 100));
        tr.w.push(Math.round(v * 100));
        tr.oc.push(occludedMask(sw, u, v, pose, weeds, swimmers, t));
        tr.last = i;
      }
    }
    const tracks: TrackRec[] = [];
    for (const tr of trackMap.values()) {
      // 只保留真正进入过画面的鱼
      if (tr.oc.every((m) => m === 7)) continue;
      // 提前离开画面的鱼，尾部同样补为不可见
      const { u, v } = { u: tr.u[tr.u.length - 1], v: tr.w[tr.w.length - 1] };
      while (tr.u.length < n) {
        tr.u.push(u);
        tr.w.push(v);
        tr.oc.push(7);
      }
      const { last: _last, ...rec } = tr;
      tracks.push(rec);
    }
    return {
      v: 1,
      seed,
      spot,
      t0: Math.round(win.start * 100) / 100,
      takenAt,
      T: Math.round(win.dur * 1000) / 1000,
      dt,
      n,
      fi,
      fc,
      cam,
      weeds,
      tracks,
    };
  };
  // 精度按用户选择采样；万一仍超出本张分摊的上限，则逐级降精度兜底
  const perFrame = Math.floor(RECORD_BUDGET / Math.max(1, fc));
  let dt = precisionMs / 1000;
  let rec = build(dt);
  for (let guard = 0; guard < 4 && recordBytes(rec) > perFrame; guard++) {
    dt *= 2;
    rec = build(dt);
  }
  return rec;
}
