import type { Clarity, ExposureRecord, Finding } from "../../../shared/types";
import { defocus, popcount, type CamPose } from "./scene";

export const CLARITY_LABEL: Record<Clarity, string> = {
  clear: "清晰识别",
  partial: "可辨认",
  glimpse: "惊鸿一瞥",
};

export function clarityRank(c: Clarity) {
  return c === "clear" ? 3 : c === "partial" ? 2 : 1;
}

function poseAt(rec: ExposureRecord, i: number): CamPose {
  return {
    pan: rec.cam.pan[i] / 10,
    focal: rec.cam.fo[i] / 10,
    focus: rec.cam.fc[i] / 100,
  };
}

/**
 * 依据成片中每条鱼轨迹「实际可辨的部分」判定识别等级。
 * 只读取曝光过程记录：不看曝光前后任何一帧，也不跨轨迹拼接。
 */
export function identify(rec: ExposureRecord): Finding[] {
  const out: Finding[] = [];
  for (const tr of rec.tracks) {
    let parts = 0;
    let visibleTime = 0;
    let sharpTime = 0;
    let coverSum = 0;
    let blurSum = 0;
    let blurW = 0;
    let run = 0;
    let bestRun = 0;
    for (let i = 0; i < rec.n; i++) {
      const vis = 7 & ~tr.oc[i];
      if (!vis) {
        run = 0;
        continue;
      }
      const frac = popcount(vis) / 3;
      parts |= vis;
      coverSum += frac * rec.dt;
      const blur = defocus(poseAt(rec, i), tr.z / 100);
      blurSum += blur * frac * rec.dt;
      blurW += frac * rec.dt;
      if (frac >= 0.5) {
        visibleTime += rec.dt;
        run += rec.dt;
        if (run > bestRun) bestRun = run;
        if (blur <= 0.35) sharpTime += rec.dt;
      } else {
        run = 0;
      }
    }
    if (coverSum <= 0) continue;
    const blurAvg = blurW > 0 ? blurSum / blurW : 1;
    const T = rec.T;
    const need = Math.min(0.6, 0.45 * T);
    const runNeed = Math.min(0.5, 0.4 * T);
    const clarity: Clarity =
      parts === 7 && sharpTime >= need && bestRun >= runNeed && blurAvg <= 0.4
        ? "clear"
        : visibleTime >= Math.min(0.3, 0.35 * T) && popcount(parts) >= 2
          ? "partial"
          : "glimpse";
    out.push({
      sp: tr.sp,
      clarity,
      parts,
      visibleTime: Math.round(visibleTime * 100) / 100,
      coverage: Math.round((coverSum / T) * 100) / 100,
      blur: Math.round(blurAvg * 100) / 100,
    });
  }
  return out.sort((a, b) => clarityRank(b.clarity) - clarityRank(a.clarity));
}
