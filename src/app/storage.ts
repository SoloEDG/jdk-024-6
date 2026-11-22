import { newDocument } from "../shared/initial";
import { fishCatalog } from "../shared/catalog";
import type { FishId, GameDocument, Photo, PhotoMark } from "../shared/types";
import { identify } from "../features/camera/model/identify";
const key = "stillwater-jdk024-v1";
const spots = ["reed", "brook", "deep"];
const fishIds = fishCatalog.map((f) => f.id);
function validPhoto(p: unknown): p is Photo {
  if (!p || typeof p !== "object") return false;
  const ph = p as Photo;
  const r = ph.record;
  if (
    typeof ph.id !== "string" ||
    typeof ph.ready !== "boolean" ||
    !Number.isFinite(ph.developAt) ||
    !Number.isFinite(ph.bytes) ||
    !r ||
    r.v !== 1 ||
    !spots.includes(r.spot) ||
    ![r.seed, r.t0, r.takenAt, r.T, r.dt].every(Number.isFinite) ||
    r.T <= 0 ||
    r.dt <= 0 ||
    !Number.isInteger(r.n) ||
    r.n < 2 ||
    r.n > 20000 ||
    !Number.isInteger(r.fi) ||
    !Number.isInteger(r.fc) ||
    !r.cam ||
    ![r.cam.pan, r.cam.fo, r.cam.fc].every(
      (a) => Array.isArray(a) && a.length === r.n && a.every(Number.isFinite),
    ) ||
    !Array.isArray(r.weeds) ||
    r.weeds.length > 6 ||
    !Array.isArray(r.tracks) ||
    r.tracks.length > 8 ||
    !Array.isArray(ph.findings)
  )
    return false;
  return r.tracks.every(
    (t) =>
      t &&
      fishIds.includes(t.sp) &&
      (t.dir === 1 || t.dir === -1) &&
      [t.z, t.len].every(Number.isFinite) &&
      [t.u, t.w, t.oc].every((a) => Array.isArray(a) && a.length === r.n),
  );
}
function normalizePhotos(
  d: GameDocument,
): Pick<GameDocument, "photos" | "cover" | "photoSeq" | "photographed"> {
  const raw = Array.isArray(d.photos) ? d.photos : [];
  const photos = raw
    .filter(validPhoto)
    .slice(0, 12)
    .map((p) => ({
      ...p,
      ready: p.ready || p.developAt <= Date.now(),
      // 识别结论始终由曝光记录重建，保证与画面一致
      findings: identify(p.record),
    }));
  const photographed: GameDocument["photographed"] = {};
  for (const [id, m] of Object.entries(d.photographed ?? {})) {
    if (!fishIds.includes(id as FishId) || !m || typeof m !== "object") continue;
    const clarity = (m as PhotoMark).clarity;
    if (clarity === "clear" || clarity === "partial" || clarity === "glimpse")
      photographed[id as FishId] = {
        clarity,
        photoId: String((m as PhotoMark).photoId ?? ""),
      };
  }
  let photoSeq = Number.isInteger(d.photoSeq) ? d.photoSeq : 0;
  let cover =
    d.cover && typeof d.cover.photoId === "string" && Number.isInteger(d.cover.seq)
      ? { photoId: d.cover.photoId, seq: d.cover.seq }
      : null;
  // 离开期间完成冲印的照片按请求顺序补设封面；迟到照片不覆盖更晚的选择
  for (const p of photos) {
    if (typeof p.coverWhenReady === "number")
      photoSeq = Math.max(photoSeq, p.coverWhenReady);
    if (
      p.ready &&
      p.coverWhenReady !== undefined &&
      (!cover || cover.seq < p.coverWhenReady)
    )
      cover = { photoId: p.id, seq: p.coverWhenReady };
  }
  if (cover) photoSeq = Math.max(photoSeq, cover.seq);
  if (cover && !photos.some((p) => p.id === cover!.photoId)) cover = null;
  return { photos, cover, photoSeq, photographed };
}
function valid(value: unknown): value is GameDocument {
  if (!value || typeof value !== "object") return false;
  const d = value as GameDocument;
  const baits = ["worm", "corn", "fly"];
  return (
    d.version === 1 &&
    spots.includes(d.spot) &&
    baits.includes(d.bait) &&
    Number.isFinite(d.power) &&
    d.power >= 0.15 &&
    d.power <= 0.95 &&
    Number.isFinite(d.drag) &&
    d.drag >= 0.15 &&
    d.drag <= 0.95 &&
    Number.isInteger(d.seed) &&
    !!d.stock &&
    baits.every(
      (b) =>
        Number.isInteger(d.stock[b as keyof typeof d.stock]) &&
        d.stock[b as keyof typeof d.stock] >= 0,
    ) &&
    !!d.stats &&
    ["casts", "catches", "escapes", "released"].every(
      (k) =>
        Number.isInteger(d.stats[k as keyof typeof d.stats]) &&
        d.stats[k as keyof typeof d.stats] >= 0,
    ) &&
    Array.isArray(d.claimed) &&
    d.claimed.every((c) => typeof c === "string") &&
    Array.isArray(d.bag) &&
    d.bag.every(
      (c) =>
        c &&
        typeof c.id === "string" &&
        fishIds.includes(c.fish) &&
        spots.includes(c.spot) &&
        baits.includes(c.bait) &&
        [c.weight, c.time, c.duration, c.peakTension].every(Number.isFinite),
    ) &&
    !!d.journal &&
    Object.entries(d.journal).every(
      ([id, e]) =>
        fishIds.includes(id as (typeof fishIds)[number]) &&
        e &&
        Number.isInteger(e.count) &&
        e.count > 0 &&
        Number.isFinite(e.best) &&
        Number.isFinite(e.first),
    ) &&
    Array.isArray(d.photos) &&
    (d.cover === null ||
      (typeof d.cover.photoId === "string" && Number.isInteger(d.cover.seq))) &&
    Number.isInteger(d.photoSeq) &&
    !!d.photographed &&
    typeof d.photographed === "object"
  );
}
export function loadGame(): { doc: GameDocument; notice: string; recovery?: true } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { doc: newDocument(), notice: "" };
    const parsed: unknown = JSON.parse(raw);
    const merged =
      parsed && typeof parsed === "object"
        ? { ...(parsed as GameDocument), ...normalizePhotos(parsed as GameDocument) }
        : parsed;
    return valid(merged)
      ? { doc: merged, notice: "" }
      : {
          doc: newDocument(),
          notice: "本地手记格式或版本无法读取，已保留原手记并开启临时游玩。",
          recovery: true,
        };
  } catch {
    return {
      doc: newDocument(),
      notice: "无法读取本地手记，已暂停自动保存，本次可以临时游玩。",
      recovery: true,
    };
  }
}
export function saveGame(doc: GameDocument) {
  try {
    localStorage.setItem(key, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}
