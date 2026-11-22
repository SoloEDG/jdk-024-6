import { species } from "../../../shared/catalog";
import type {
  CamSettings,
  ExposureRecord,
  Photo,
  SpotId,
  TrackRec,
  WeedParams,
} from "../../../shared/types";
import { water } from "../../waters";
import {
  SCENE,
  defocus,
  fovHalf,
  project,
  sceneAt,
  sceneWeeds,
  swimmerPos,
  weedOffset,
  type CamPose,
} from "../model/scene";

const aspect: Record<string, number> = {
  pike: 0.3,
  carp: 0.5,
  trout: 0.38,
  crucian: 0.46,
  perch: 0.44,
  bass: 0.42,
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a: string, b: string, f: number) {
  const A = rgb(a);
  const B = rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * f)).join(",")})`;
}

function toScreen(p: { x: number; y: number }, W: number, H: number) {
  return { x: (p.x * 0.5 + 0.5) * W, y: (0.5 - p.y * 0.5) * H };
}

function fishBody(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.bezierCurveTo(0.32, -0.42, -0.05, -0.5, -0.3, -0.18);
  ctx.lineTo(-0.52, -0.42);
  ctx.lineTo(-0.42, 0);
  ctx.lineTo(-0.52, 0.42);
  ctx.lineTo(-0.3, 0.18);
  ctx.bezierCurveTo(-0.05, 0.5, 0.32, 0.42, 0.5, 0);
  ctx.closePath();
  ctx.moveTo(0.1, -0.33);
  ctx.quadraticCurveTo(-0.02, -0.72, -0.2, -0.3);
  ctx.closePath();
}

/** 按可辨段（bit0头 bit1身 bit2尾）绘制鱼影，被遮挡的段不会出现在画面上。 */
function drawFish(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  px: number,
  dir: 1 | -1,
  color: string,
  visMask: number,
  blurPx: number,
  alpha: number,
  ar: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir * px, px * ar);
  ctx.filter = blurPx >= 0.5 ? `blur(${blurPx.toFixed(1)}px)` : "none";
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const thirds: [number, number, number][] = [
    [1 / 6, 0.56, 1],
    [-1 / 6, 1 / 6, 2],
    [-0.56, -1 / 6, 4],
  ];
  for (const [a, b, bit] of thirds) {
    if (!(visMask & bit)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, -0.95, b - a, 1.9);
    ctx.clip();
    fishBody(ctx);
    ctx.fill();
    ctx.restore();
  }
  if (visMask & 1) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(18,38,36,0.9)";
    ctx.arc(0.32, -0.08, 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawWeed(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  w: WeedParams,
  pose: CamPose,
  t: number,
  alpha: number,
) {
  const { halfW } = fovHalf(pose.focal);
  const blur = defocus(pose, w.z);
  ctx.save();
  ctx.filter = blur > 0.06 ? `blur(${(blur * 6).toFixed(1)}px)` : "none";
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#1f4438";
  ctx.lineCap = "round";
  for (const off of [-0.14, 0, 0.14]) {
    const baseU = w.u + off;
    const topV = SCENE.vMax - w.h * (1 - Math.abs(off) * 1.4);
    const sway = weedOffset(w, t, topV);
    const p0 = toScreen(project(pose, baseU, SCENE.vMax + 0.1, w.z), W, H);
    const pm = toScreen(
      project(pose, baseU + sway * 0.4, (SCENE.vMax + topV) / 2, w.z),
      W,
      H,
    );
    const p1 = toScreen(project(pose, baseU + sway, topV, w.z), W, H);
    ctx.lineWidth = Math.max(1.2, (0.045 / (w.z * 2 * halfW)) * W);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.quadraticCurveTo(pm.x, pm.y, p1.x, p1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function paintBg(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  spot: SpotId,
  seed: number,
) {
  const c = water(spot).color;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, mixHex(c, "#e8f2ec", 0.55));
  g.addColorStop(0.45, c);
  g.addColorStop(1, mixHex(c, "#142e38", 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 水面透下的光柱
  ctx.save();
  let s = seed >>> 0;
  for (let i = 0; i < 3; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = (s / 4294967296) * W;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const wdt = 40 + (s / 4294967296) * 120;
    const lg = ctx.createLinearGradient(x, 0, x + wdt, H);
    lg.addColorStop(0, "rgba(240,250,240,0.20)");
    lg.addColorStop(1, "rgba(240,250,240,0)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + wdt, 0);
    ctx.lineTo(x + wdt * 2.2, H);
    ctx.lineTo(x + wdt * 0.8, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // 水底
  ctx.fillStyle = "rgba(36,52,46,0.6)";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.92);
  ctx.quadraticCurveTo(W * 0.3, H * 0.86, W * 0.55, H * 0.91);
  ctx.quadraticCurveTo(W * 0.8, H * 0.95, W, H * 0.9);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
}

/** 取景器实时画面：当前时刻的水下场景（未曝光）。 */
export function drawLive(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seed: number,
  spot: SpotId,
  clock: number,
  settings: CamSettings,
) {
  const pose: CamPose = { pan: settings.pan, focal: settings.focal, focus: settings.focus };
  paintBg(ctx, W, H, spot, seed);
  const weeds = sceneWeeds(seed);
  const swimmers = sceneAt(seed, spot, clock);
  const items: { z: number; draw: () => void }[] = [];
  for (const w of weeds)
    items.push({ z: w.z, draw: () => drawWeed(ctx, W, H, w, pose, clock, 0.75) });
  for (const sw of swimmers) {
    const { u, v } = swimmerPos(sw, clock);
    const p = project(pose, u, v, sw.z);
    if (Math.abs(p.x) > 1.3 || Math.abs(p.y) > 1.35) continue;
    const blur = defocus(pose, sw.z);
    const { halfW } = fovHalf(pose.focal);
    const px = (sw.len / (sw.z * 2 * halfW)) * W;
    const s = toScreen(p, W, H);
    items.push({
      z: sw.z,
      draw: () =>
        drawFish(
          ctx,
          s.x,
          s.y,
          px,
          sw.dir,
          species(sw.sp).color,
          7,
          blur * 8,
          0.92 - blur * 0.35,
          aspect[sw.sp] ?? 0.42,
        ),
    });
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();
}

function poseOf(rec: ExposureRecord, i: number): CamPose {
  return {
    pan: rec.cam.pan[i] / 10,
    focal: rec.cam.fo[i] / 10,
    focus: rec.cam.fc[i] / 100,
  };
}

/**
 * 由曝光过程记录重建整张成片：整段曝光的光迹累积。
 * 长曝光留下连续拖影，短曝光则定格瞬间——差别来自同一份采样数据。
 */
export function renderPhoto(rec: ExposureRecord, W: number, H: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  paintBg(ctx, W, H, rec.spot, rec.seed);
  // 水下弱光补偿：增益让光迹清晰可读，同时保留长短曝光的相对差异
  const alpha = Math.min(0.85, (rec.dt / rec.T) * 7);
  const weedZ = rec.weeds.length ? Math.min(...rec.weeds.map((w) => w.z)) : Infinity;
  const drawTrack = (tr: TrackRec) => {
    const z = tr.z / 100;
    const color = species(tr.sp).color;
    const ar = aspect[tr.sp] ?? 0.42;
    // 相邻且完全相同的采样合并绘制：1-(1-a)^n 与逐次叠加等价，但快得多
    let i = 0;
    while (i < rec.n) {
      const vis = 7 & ~tr.oc[i];
      if (!vis) {
        i++;
        continue;
      }
      let j = i + 1;
      while (
        j < rec.n &&
        tr.u[j] === tr.u[i] &&
        tr.w[j] === tr.w[i] &&
        tr.oc[j] === tr.oc[i] &&
        rec.cam.pan[j] === rec.cam.pan[i] &&
        rec.cam.fo[j] === rec.cam.fo[i] &&
        rec.cam.fc[j] === rec.cam.fc[i]
      )
        j++;
      const count = j - i;
      const pose = poseOf(rec, i);
      const pr = project(pose, tr.u[i] / 100, tr.w[i] / 100, z);
      i = j;
      if (Math.abs(pr.x) > 1.3 || Math.abs(pr.y) > 1.35) continue;
      const blur = defocus(pose, z);
      const { halfW } = fovHalf(pose.focal);
      const px = (tr.len / 100 / (z * 2 * halfW)) * W;
      const s = toScreen(pr, W, H);
      const perSample = alpha * (1 - blur * 0.45);
      const a = 1 - Math.pow(1 - perSample, count);
      drawFish(ctx, s.x, s.y, px, tr.dir, color, vis, blur * 9, a, ar);
    }
  };
  // 由远及近：远鱼 → 水草 → 近鱼，遮挡关系与记录一致
  for (const tr of rec.tracks) if (tr.z / 100 > weedZ) drawTrack(tr);
  const wStep = Math.max(1, Math.floor(rec.n / 600));
  for (let i = 0; i < rec.n; i += wStep) {
    const pose = poseOf(rec, i);
    const t = rec.t0 + i * rec.dt;
    for (const w of rec.weeds)
      drawWeed(ctx, W, H, w, pose, t, Math.min(0.5, (rec.dt / rec.T) * 2.2 * wStep));
  }
  for (const tr of rec.tracks) if (tr.z / 100 <= weedZ) drawTrack(tr);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(10,24,26,0.42)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
  return canvas;
}

/** 高分辨率明信片：1800×1200，含拍摄参数与识别结论。 */
export function renderPostcard(photo: Photo): HTMLCanvasElement {
  const W = 1800;
  const H = 1200;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f4f0e2";
  ctx.fillRect(0, 0, W, H);
  const rec = photo.record;
  const pic = renderPhoto(rec, 1640, 984);
  ctx.drawImage(pic, 80, 56);
  ctx.strokeStyle = "#c9c2ac";
  ctx.lineWidth = 2;
  ctx.strokeRect(80, 56, 1640, 984);
  const place = water(rec.spot);
  const date = new Date(rec.takenAt);
  const clearNames = photo.findings
    .filter((f) => f.clarity === "clear")
    .map((f) => species(f.sp).name);
  ctx.fillStyle = "#3c5a52";
  ctx.font = "600 40px 'Noto Serif SC', serif";
  ctx.fillText(`静水手记 · ${place.name}`, 84, 1112);
  ctx.font = "24px 'Noto Sans SC', sans-serif";
  ctx.fillStyle = "#7a8b80";
  const settings = `${Math.round(rec.cam.fo[0] / 10)}mm · 曝光 ${rec.T}s · 对焦 ${(rec.cam.fc[0] / 100).toFixed(1)}m · 采样 ${Math.round(rec.dt * 1000)}ms · 第 ${rec.fi + 1}/${rec.fc} 张`;
  ctx.fillText(settings, 84, 1152);
  ctx.textAlign = "right";
  ctx.font = "600 26px 'Noto Serif SC', serif";
  ctx.fillStyle = "#57766b";
  ctx.fillText(
    clearNames.length ? `清晰识别：${clearNames.join(" · ")}` : "水下明信片",
    1716,
    1112,
  );
  ctx.font = "20px 'DM Sans', 'Noto Sans SC', sans-serif";
  ctx.fillStyle = "#93a29a";
  ctx.fillText(
    `${date.toLocaleDateString("zh-CN")} · STILLWATER FIELD NOTES`,
    1716,
    1152,
  );
  ctx.textAlign = "left";
  return canvas;
}
