export type SpotId = "reed" | "brook" | "deep";
export type BaitId = "worm" | "corn" | "fly";
export type FishId = "crucian" | "perch" | "carp" | "trout" | "bass" | "pike";
export type Phase =
  "ready" | "charging" | "waiting" | "bite" | "fighting" | "landed" | "escaped";
export interface FishSpecies {
  id: FishId;
  name: string;
  latin: string;
  color: string;
  rarity: string;
  min: number;
  max: number;
  strength: number;
  waters: SpotId[];
  baits: BaitId[];
  note: string;
}
export interface Catch {
  id: string;
  fish: FishId;
  weight: number;
  spot: SpotId;
  bait: BaitId;
  time: number;
  duration: number;
  peakTension: number;
}
export interface JournalEntry {
  count: number;
  best: number;
  first: number;
}
export type Clarity = "clear" | "partial" | "glimpse";
export interface CamSettings {
  focal: number;
  focus: number;
  pan: number;
  exposure: number;
  precision: number;
  mode: "single" | "burst";
  burst: number;
}
export interface CamKey {
  t: number;
  focal: number;
  focus: number;
  pan: number;
}
export interface ShootState {
  start: number;
  frames: number;
  frameDur: number;
  done: number;
  precision: number;
  keys: CamKey[];
  spot: SpotId;
  seed: number;
}
export interface CameraState {
  settings: CamSettings;
  sceneSeed: number;
  sceneClock: number;
  shooting: ShootState | null;
  pending: Photo[];
}
export interface WeedParams {
  u: number;
  z: number;
  h: number;
  sw: number;
  per: number;
  ph: number;
}
export interface TrackRec {
  sp: FishId;
  z: number;
  len: number;
  dir: 1 | -1;
  u: number[];
  w: number[];
  oc: number[];
}
export interface ExposureRecord {
  v: 1;
  seed: number;
  spot: SpotId;
  t0: number;
  takenAt: number;
  T: number;
  dt: number;
  n: number;
  fi: number;
  fc: number;
  cam: { pan: number[]; fo: number[]; fc: number[] };
  weeds: WeedParams[];
  tracks: TrackRec[];
}
export interface Finding {
  sp: FishId;
  clarity: Clarity;
  parts: number;
  visibleTime: number;
  coverage: number;
  blur: number;
}
export interface Photo {
  id: string;
  ready: boolean;
  developAt: number;
  bytes: number;
  record: ExposureRecord;
  findings: Finding[];
  coverWhenReady?: number;
}
export interface PhotoMark {
  clarity: Clarity;
  photoId: string;
}
export interface GameDocument {
  version: 1;
  spot: SpotId;
  bait: BaitId;
  power: number;
  drag: number;
  seed: number;
  stock: Record<BaitId, number>;
  bag: Catch[];
  journal: Partial<Record<FishId, JournalEntry>>;
  stats: { casts: number; catches: number; escapes: number; released: number };
  claimed: string[];
  photos: Photo[];
  cover: { photoId: string; seq: number } | null;
  photoSeq: number;
  photographed: Partial<Record<FishId, PhotoMark>>;
}
export interface Session {
  id: string;
  phase: Phase;
  clock: number;
  charge: number;
  castPower: number;
  spot: SpotId;
  bait: BaitId;
  fish: FishId | null;
  weight: number;
  biteAt: number;
  progress: number;
  tension: number;
  energy: number;
  slackTime: number;
  overload: number;
  peak: number;
  reeling: boolean;
  duration: number;
  message: string;
}
export interface Workspace {
  doc: GameDocument;
  session: Session;
  camera: CameraState;
  notice: string;
}
