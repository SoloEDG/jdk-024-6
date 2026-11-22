import type { FishId, GameDocument, Photo, PhotoMark } from "../../../shared/types";
import { species } from "../../../shared/catalog";
import { clarityRank } from "./identify";

export const ALBUM_MAX = 12;
export const ALBUM_BYTES = 3 * 1024 * 1024;

export function albumBytes(photos: Photo[]) {
  return photos.reduce((n, p) => n + p.bytes, 0);
}

function marksWith(
  photographed: GameDocument["photographed"],
  photo: Photo,
): { marks: GameDocument["photographed"]; fresh: string[] } {
  const marks: GameDocument["photographed"] = { ...photographed };
  const fresh: string[] = [];
  for (const f of photo.findings) {
    const old = marks[f.sp];
    if (!old || clarityRank(f.clarity) > clarityRank(old.clarity))
      marks[f.sp] = { clarity: f.clarity, photoId: photo.id } satisfies PhotoMark;
    if (f.clarity === "clear" && photographed[f.sp]?.clarity !== "clear")
      fresh.push(species(f.sp).name);
  }
  return { marks, fresh };
}

/** 采纳照片入册：记录识别结论、按空间上限淘汰、处理封面请求。 */
export function acceptPhoto(
  doc: GameDocument,
  photo: Photo,
  cover: boolean,
): { doc: GameDocument; notice: string } {
  const seq = doc.photoSeq + 1;
  let accepted: Photo = { ...photo };
  let nextCover = doc.cover;
  const notes: string[] = [];
  if (cover) {
    if (accepted.ready) {
      nextCover = { photoId: accepted.id, seq };
      notes.push("已设为图鉴封面。");
    } else {
      accepted.coverWhenReady = seq;
      notes.push("冲印完成后将设为图鉴封面。");
    }
  }
  const { marks, fresh } = marksWith(doc.photographed, accepted);
  if (fresh.length) notes.push(`清晰识别：${fresh.join("、")}！已收录进图鉴摄影记录。`);
  let photos = [accepted, ...doc.photos];
  // 相册空间有限：优先淘汰最早且未设为封面的照片
  while (
    photos.length > ALBUM_MAX ||
    (albumBytes(photos) > ALBUM_BYTES && photos.length > 1)
  ) {
    const idx = [...photos]
      .map((p, i) => ({ p, i }))
      .reverse()
      .find(({ p }) => p.id !== nextCover?.photoId)?.i;
    if (idx === undefined || idx === 0) break;
    photos = photos.filter((_, i) => i !== idx);
    if (!notes.some((n) => n.includes("相册"))) notes.push("相册空间不足，最早未设为封面的照片已移除。");
  }
  return {
    doc: {
      ...doc,
      photos,
      cover: nextCover,
      photoSeq: seq,
      photographed: marks,
    },
    notice: notes.join(" ") || "照片已采纳，存入相册。",
  };
}

export function setCover(doc: GameDocument, photoId: string): GameDocument {
  if (!doc.photos.some((p) => p.id === photoId)) return doc;
  return {
    ...doc,
    cover: { photoId, seq: doc.photoSeq + 1 },
    photoSeq: doc.photoSeq + 1,
  };
}

export function removePhoto(doc: GameDocument, photoId: string): GameDocument {
  if (!doc.photos.some((p) => p.id === photoId)) return doc;
  return {
    ...doc,
    photos: doc.photos.filter((p) => p.id !== photoId),
    cover: doc.cover?.photoId === photoId ? null : doc.cover,
  };
}

/** 异步冲印完成。迟到的照片绝不覆盖更晚选定的封面。 */
export function markDeveloped(
  doc: GameDocument,
  photoId: string,
): { doc: GameDocument; notice: string } {
  const photo = doc.photos.find((p) => p.id === photoId);
  if (!photo || photo.ready) return { doc, notice: "" };
  const ready: Photo = { ...photo, ready: true };
  let cover = doc.cover;
  let notice = "";
  if (
    ready.coverWhenReady !== undefined &&
    (!cover || cover.seq < ready.coverWhenReady)
  ) {
    cover = { photoId: ready.id, seq: ready.coverWhenReady };
    notice = "照片冲印完成，已设为图鉴封面。";
  }
  if (ready.coverWhenReady !== undefined) delete ready.coverWhenReady;
  return {
    doc: {
      ...doc,
      photos: doc.photos.map((p) => (p.id === photoId ? ready : p)),
      cover,
    },
    notice,
  };
}

export function clearSpecies(doc: GameDocument): FishId[] {
  return (Object.entries(doc.photographed) as [FishId, PhotoMark][])
    .filter(([, m]) => m.clarity === "clear")
    .map(([id]) => id);
}
