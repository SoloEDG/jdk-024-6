import { fishCatalog } from "../../../shared/catalog";
import { clamp, random } from "../../../shared/random";
import type { FishId, SpotId, WeedParams } from "../../../shared/types";

export const SCENE = {
  uMax: 6,
  vMax: 4,
  camV: 1.6,
  slots: 8,
};

export interface Swimmer {
  slot: number;
  k: number;
  sp: FishId;
  z: number;
  len: number;
  dir: 1 | -1;
  speed: number;
  u0: number;
  v0: number;
  amp: number;
  per: number;
  ph: number;
  enterAt: number;
  exitAt: number;
}

export interface CamPose {
  pan: number;
  focal: number;
  focus: number;
}

const bodyLength: Record<FishId, number> = {
  crucian: 0.32,
  perch: 0.4,
  carp: 0.62,
  trout: 0.46,
  bass: 0.56,
  pike: 0.9,
};

function mix(seed: number, a: number, b: number) {
  return (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
}

function spotPool(spot: SpotId) {
  return fishCatalog
    .filter((f) => f.waters.includes(spot))
    .map((f) => ({
      id: f.id,
      w: f.rarity === "稀有" ? 0.4 : f.rarity === "少见" ? 0.75 : 1,
    }));
}

function activation(seed: number, spot: SpotId, slot: number, k: number, enterAt: number): Swimmer {
  let s = mix(seed, slot, k);
  const next = () => {
    const [r, n] = random(s);
    s = n;
    return r;
  };
  const pool = spotPool(spot);
  let pick = next() * pool.reduce((n, p) => n + p.w, 0);
  const sp = (pool.find((p) => (pick -= p.w) <= 0) ?? pool[0]).id;
  const dir: 1 | -1 = next() < 0.5 ? 1 : -1;
  const speed = 0.45 + next() * 0.5;
  const z = 1.2 + next() * 6.8;
  const v0 = 0.7 + next() * 2.6;
  const amp = 0.08 + next() * 0.3;
  const per = 2.8 + next() * 3.5;
  const ph = next() * Math.PI * 2;
  const len = bodyLength[sp] * (0.85 + next() * 0.3);
  const span = SCENE.uMax + 2 + len;
  const totalDur = (span * 2) / speed;
  // 每槽的第一条鱼在场景开始时已游到途中，画面立即有鱼群
  const enter = k === 0 ? enterAt - next() * totalDur : enterAt;
  return {
    slot,
    k,
    sp,
    z,
    len,
    dir,
    speed,
    u0: dir === 1 ? -span : span,
    v0,
    amp,
    per,
    ph,
    enterAt: enter,
    exitAt: enter + totalDur,
  };
}

function gapFor(seed: number, slot: number, k: number) {
  const [r] = random(mix(seed ^ 0x6a09e667, slot, k));
  return 1.5 + r * 7.5;
}

export function sceneAt(seed: number, spot: SpotId, t: number): Swimmer[] {
  const out: Swimmer[] = [];
  for (let slot = 0; slot < SCENE.slots; slot++) {
    let enter = 0;
    for (let k = 0; k < 100000; k++) {
      const sw = activation(seed, spot, slot, k, enter);
      if (t < sw.enterAt) break;
      if (t <= sw.exitAt) {
        out.push(sw);
        break;
      }
      enter = sw.exitAt + gapFor(seed, slot, k);
    }
  }
  return out;
}

export function swimmerPos(sw: Swimmer, t: number) {
  const u = sw.u0 + sw.dir * sw.speed * (t - sw.enterAt);
  const v = clamp(
    sw.v0 + sw.amp * Math.sin((2 * Math.PI * t) / sw.per + sw.ph),
    0.25,
    SCENE.vMax - 0.2,
  );
  return { u, v };
}

export function sceneWeeds(seed: number): WeedParams[] {
  let s = (seed ^ 0x3c6ef372) >>> 0;
  const next = () => {
    const [r, n] = random(s);
    s = n;
    return r;
  };
  const count = 2 + Math.floor(next() * 3);
  const out: WeedParams[] = [];
  for (let i = 0; i < count; i++)
    out.push({
      u: -7 + next() * 14,
      z: 1 + next() * 2.2,
      h: 1.6 + next() * 1.8,
      sw: 0.25 + next() * 0.4,
      per: 3.5 + next() * 3,
      ph: next() * Math.PI * 2,
    });
  return out;
}

export function weedOffset(w: WeedParams, t: number, v: number) {
  const top = SCENE.vMax - w.h;
  const frac = clamp((SCENE.vMax - v) / w.h, 0, 1);
  return w.sw * Math.sin((2 * Math.PI * t) / w.per + w.ph) * Math.pow(frac, 1.2) * (v >= top ? 1 : 0);
}

export function fovHalf(focal: number) {
  return { halfW: 18 / focal, halfH: 12 / focal };
}

export function project(cam: CamPose, u: number, v: number, z: number) {
  const { halfW, halfH } = fovHalf(cam.focal);
  const theta = (cam.pan * Math.PI) / 180;
  const uc = u - z * Math.tan(theta);
  return { x: uc / (z * halfW), y: -(v - SCENE.camV) / (z * halfH) };
}

export function defocus(cam: CamPose, z: number) {
  return clamp(
    (Math.abs(z - cam.focus) * (cam.focal / 50) * 0.55) / Math.max(cam.focus, 0.6),
    0,
    1,
  );
}

/** Thirds of the fish body: bit0 head, bit1 mid, bit2 tail. Head faces swim direction. */
export function thirdRange(sw: Swimmer, u: number, third: number): [number, number] {
  const half = sw.len / 2;
  const sixth = sw.len / 6;
  if (third === 1) return [u - sixth, u + sixth];
  const local: [number, number] = third === 0 ? [sixth, half] : [-half, -sixth];
  const [a, b] = sw.dir === 1 ? local : [-local[1], -local[0]];
  return [u + a, u + b];
}

export function popcount(n: number) {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}
