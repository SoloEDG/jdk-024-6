import type { Workspace } from "../shared/types";
import type { Command } from "../shared/commands";
import { idleSession, isBusy } from "../shared/initial";
import { random } from "../shared/random";
import { selectWater } from "../features/waters";
import {
  chooseBait,
  tune,
  consumeBait,
  resupply,
  attraction,
  biteDelay,
} from "../features/tackle";
import { prepareCast, tickSession, strike } from "../features/fishing";
import { landCatch, releaseCatch } from "../features/collection";
import { claimReward } from "../features/challenges";
import {
  camSet,
  camShutter,
  camCancel,
  camTick,
  trayClose,
  reseedCamera,
  acceptPhoto,
  setCover,
  removePhoto,
  markDeveloped,
} from "../features/camera";
export function gameReducer(state: Workspace, c: Command): Workspace {
  const { doc, session: s, camera } = state;
  const busy = isBusy(s);
  switch (c.type) {
    case "spot": {
      if (busy || camera.shooting) return state;
      const next = selectWater(doc, c.id);
      return next === doc
        ? state
        : { ...state, doc: next, camera: reseedCamera(camera, doc, c.id) };
    }
    case "bait":
      return busy ? state : { ...state, doc: chooseBait(doc, c.id) };
    case "power":
      return { ...state, doc: tune(doc, "power", c.value) };
    case "drag":
      return busy ? state : { ...state, doc: tune(doc, "drag", c.value) };
    case "resupply":
      return busy
        ? state
        : {
            ...state,
            doc: resupply(doc),
            notice: "鱼饵已补给，带上好心情出发。",
          };
    case "charge-start":
      return s.phase === "ready" && doc.stock[doc.bait] > 0
        ? {
            ...state,
            session: {
              ...idleSession(),
              phase: "charging",
              message: "再次点击，把鱼饵抛向水面。",
            },
          }
        : state;
    case "cast": {
      if (s.phase !== "charging") return state;
      const consumed = consumeBait(doc);
      if (!consumed) return state;
      const cast = prepareCast(
        doc,
        s.charge,
        attraction(doc.spot, doc.bait),
        (r) => biteDelay(doc.bait, r),
      );
      return {
        ...state,
        doc: {
          ...consumed,
          seed: cast.seed,
          stats: { ...doc.stats, casts: doc.stats.casts + 1 },
        },
        session: cast.session,
      };
    }
    case "strike":
      return { ...state, session: strike(s) };
    case "reel":
      return s.phase === "fighting"
        ? { ...state, session: { ...s, reeling: c.held } }
        : state;
    case "tick": {
      const dt = Math.min(0.1, Math.max(0, c.dt));
      const next = tickSession(s, doc, dt);
      let seed = doc.seed;
      const rand = () => {
        const [r, n] = random(seed);
        seed = n;
        return r;
      };
      const camNext = camTick(camera, dt, Date.now(), rand);
      let updated = doc;
      if (next.phase === "landed" && s.phase !== "landed")
        updated = landCatch(doc, next, Date.now());
      if (next.phase === "escaped" && s.phase !== "escaped")
        updated = {
          ...updated,
          stats: { ...updated.stats, escapes: updated.stats.escapes + 1 },
        };
      if (seed !== doc.seed) updated = { ...updated, seed };
      if (next === s && camNext === camera && updated === doc) return state;
      return { ...state, doc: updated, session: next, camera: camNext };
    }
    case "next":
      return s.phase === "landed" || s.phase === "escaped"
        ? { ...state, session: idleSession() }
        : state;
    case "release":
      return { ...state, doc: releaseCatch(doc, c.id) };
    case "claim":
      return { ...state, doc: claimReward(doc, c.id) };
    case "cam-set":
      return { ...state, camera: camSet(camera, c.patch) };
    case "cam-shutter": {
      const r = camShutter(camera, doc.spot);
      return r.cam === camera && !r.notice
        ? state
        : { ...state, camera: r.cam, notice: r.notice || state.notice };
    }
    case "cam-cancel": {
      const r = camCancel(camera);
      return { ...state, camera: r.cam, notice: r.notice || state.notice };
    }
    case "tray-close": {
      const r = trayClose(camera);
      return r.cam === camera ? state : { ...state, camera: r.cam, notice: r.notice };
    }
    case "frame-developed": {
      if (camera.pending.some((p) => p.id === c.id))
        return {
          ...state,
          camera: {
            ...camera,
            pending: camera.pending.map((p) =>
              p.id === c.id ? { ...p, ready: true } : p,
            ),
          },
        };
      const r = markDeveloped(doc, c.id);
      return r.doc === doc
        ? state
        : { ...state, doc: r.doc, notice: r.notice || state.notice };
    }
    case "photo-accept": {
      const photo = camera.pending.find((p) => p.id === c.id);
      if (!photo) return state;
      const r = acceptPhoto(doc, photo, c.cover);
      return {
        ...state,
        doc: r.doc,
        camera: { ...camera, pending: camera.pending.filter((p) => p.id !== c.id) },
        notice: r.notice,
      };
    }
    case "photo-cover": {
      const next = setCover(doc, c.id);
      return next === doc
        ? state
        : { ...state, doc: next, notice: "已设为图鉴封面。" };
    }
    case "photo-remove": {
      const next = removePhoto(doc, c.id);
      return next === doc
        ? state
        : { ...state, doc: next, notice: "照片已移除，图像已释放。" };
    }
  }
}
