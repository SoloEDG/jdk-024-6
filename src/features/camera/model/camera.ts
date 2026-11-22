import type {
  CameraState,
  CamSettings,
  GameDocument,
  Photo,
  SpotId,
} from "../../../shared/types";
import { clamp } from "../../../shared/random";
import { finalizeFrame, framesOf, estimateRecord, sustainablePrecision, RECORD_BUDGET, PRECISION_STEPS } from "./exposure";
import { identify } from "./identify";

export function hashSpot(spot: SpotId) {
  let h = 2166136261;
  for (let i = 0; i < spot.length; i++) {
    h ^= spot.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function initialCamera(doc: GameDocument): CameraState {
  return {
    settings: {
      focal: 32,
      focus: 2.5,
      pan: 0,
      exposure: 4,
      precision: 33,
      mode: "single",
      burst: 4,
    },
    sceneSeed: (doc.seed ^ hashSpot(doc.spot) ^ 0x5eed00d) >>> 0,
    sceneClock: 0,
    shooting: null,
    pending: [],
  };
}

export function reseedCamera(cam: CameraState, doc: GameDocument, spot: SpotId): CameraState {
  return {
    ...cam,
    sceneSeed: (doc.seed ^ hashSpot(spot) ^ 0x5eed00d) >>> 0,
    sceneClock: 0,
    shooting: null,
  };
}

function nearestPrecision(ms: number) {
  return PRECISION_STEPS.reduce((a, b) => (Math.abs(b - ms) < Math.abs(a - ms) ? b : a));
}

export function clampSettings(s: CamSettings): CamSettings {
  return {
    focal: clamp(Math.round(s.focal), 24, 85),
    focus: clamp(Math.round(s.focus * 10) / 10, 0.5, 8),
    pan: clamp(Math.round(s.pan), -40, 40),
    exposure: clamp(Math.round(s.exposure * 2) / 2, 0.5, 20),
    precision: nearestPrecision(s.precision),
    mode: s.mode === "burst" ? "burst" : "single",
    burst: clamp(Math.round(s.burst), 2, 12),
  };
}

export function camSet(cam: CameraState, patch: Partial<CamSettings>): CameraState {
  const settings = clampSettings({ ...cam.settings, ...patch });
  let shooting = cam.shooting;
  if (
    shooting &&
    (patch.focal !== undefined || patch.focus !== undefined || patch.pan !== undefined)
  ) {
    const t = Math.max(0, cam.sceneClock - shooting.start);
    const last = shooting.keys[shooting.keys.length - 1];
    // 曝光期间转动镜头/变焦/改对焦都会进入记录（节流 80ms）
    if (!last || t - last.t >= 0.08)
      shooting = {
        ...shooting,
        keys: [
          ...shooting.keys,
          { t, focal: settings.focal, focus: settings.focus, pan: settings.pan },
        ],
      };
    else
      shooting = {
        ...shooting,
        keys: [
          ...shooting.keys.slice(0, -1),
          { t: last.t, focal: settings.focal, focus: settings.focus, pan: settings.pan },
        ],
      };
  }
  return { ...cam, settings, shooting };
}

export function camShutter(
  cam: CameraState,
  spot: SpotId,
): { cam: CameraState; notice: string } {
  if (cam.shooting) return { cam, notice: "" };
  const s = cam.settings;
  if (estimateRecord(s) > RECORD_BUDGET) {
    const p = sustainablePrecision(s);
    return {
      cam,
      notice: p
        ? `连拍记录将超出 2 MB 上限，当前设置可维持 ${p} ms 精度。`
        : "记录超出 2 MB 上限，请缩短曝光时间或减少连拍张数。",
    };
  }
  const frames = framesOf(s);
  const released = cam.pending.length;
  return {
    cam: {
      ...cam,
      pending: [],
      shooting: {
        start: cam.sceneClock,
        frames,
        frameDur: s.exposure,
        done: 0,
        precision: s.precision,
        keys: [{ t: 0, focal: s.focal, focus: s.focus, pan: s.pan }],
        spot,
        seed: cam.sceneSeed,
      },
    },
    notice: released ? `已释放 ${released} 张未采纳的画面，快门开启。` : "",
  };
}

export function camCancel(cam: CameraState): { cam: CameraState; notice: string } {
  if (!cam.shooting) return { cam, notice: "" };
  const done = cam.shooting.done;
  return {
    cam: { ...cam, shooting: null },
    notice: done
      ? `连拍已停止，已曝光的 ${done} 张可在回看区采纳。`
      : "已取消拍摄，快门未开启。",
  };
}

export function trayClose(cam: CameraState): { cam: CameraState; notice: string } {
  if (!cam.pending.length) return { cam, notice: "" };
  return {
    cam: { ...cam, pending: [] },
    notice: `已释放 ${cam.pending.length} 张未采纳的画面。`,
  };
}

/** 推进水下场景时钟；曝光窗口结束时把该帧采样为曝光记录。 */
export function camTick(
  cam: CameraState,
  dt: number,
  now: number,
  rand: () => number,
): CameraState {
  const sceneClock = cam.sceneClock + dt;
  let shooting = cam.shooting;
  let pending = cam.pending;
  if (shooting) {
    let sh: NonNullable<CameraState["shooting"]> = shooting;
    let photos: Photo[] | null = null;
    while (
      sh.done < sh.frames &&
      sceneClock >= sh.start + (sh.done + 1) * sh.frameDur
    ) {
      const fi: number = sh.done;
      const record = finalizeFrame(
        sh.seed,
        sh.spot,
        { start: sh.start + fi * sh.frameDur, dur: sh.frameDur },
        sh.keys,
        sh.precision,
        fi,
        sh.frames,
        now,
      );
      const photo: Photo = {
        id: `p${now.toString(36)}-${fi}-${Math.floor(rand() * 1e6).toString(36)}`,
        ready: false,
        developAt: now + 900 + fi * 650 + Math.floor(rand() * 900),
        bytes: JSON.stringify(record).length,
        record,
        findings: identify(record),
      };
      photos = photos ? [...photos, photo] : [photo];
      sh = { ...sh, done: fi + 1 };
    }
    if (photos) pending = [...pending, ...photos];
    shooting = sh.done >= sh.frames ? null : sh;
    return { ...cam, sceneClock, shooting, pending };
  }
  return { ...cam, sceneClock };
}
