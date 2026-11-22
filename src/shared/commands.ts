import type { BaitId, CamSettings, SpotId } from "./types";
export type Command =
  | { type: "spot"; id: SpotId }
  | { type: "bait"; id: BaitId }
  | { type: "power"; value: number }
  | { type: "drag"; value: number }
  | { type: "charge-start" }
  | { type: "cast" }
  | { type: "strike" }
  | { type: "reel"; held: boolean }
  | { type: "tick"; dt: number }
  | { type: "next" }
  | { type: "release"; id: string }
  | { type: "claim"; id: string }
  | { type: "resupply" }
  | { type: "cam-set"; patch: Partial<CamSettings> }
  | { type: "cam-shutter" }
  | { type: "cam-cancel" }
  | { type: "tray-close" }
  | { type: "frame-developed"; id: string }
  | { type: "photo-accept"; id: string; cover: boolean }
  | { type: "photo-cover"; id: string }
  | { type: "photo-remove"; id: string };
