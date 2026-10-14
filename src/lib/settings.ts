// Deck settings that are remembered between visits.
import { isAudioFormat, type AudioFormat } from "./audioFormats";
import type { RackSort } from "./rackStore";
import type { Repeat } from "./sequencer";
import { createStoredValue } from "./stored";

const numberBetween = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && value >= min && value <= max ? value : undefined;

const boolean = (value: unknown) => (typeof value === "boolean" ? value : undefined);

export const useVolume = createStoredValue("tapedeck:volume", 80, numberBetween(0, 100));
export const useSpeed = createStoredValue("tapedeck:speed", 1, numberBetween(0.25, 2));
export const useAutoNext = createStoredValue("tapedeck:auto-next", true, boolean);

/** AUTO-REVERSE switch: repeat nothing, the current track, or the whole tape. */
export const useRepeat = createStoredValue<Repeat>("tapedeck:repeat", "off", (value) =>
  value === "off" || value === "one" || value === "all" ? value : undefined,
);
export const useShuffle = createStoredValue("tapedeck:shuffle", false, boolean);
/** Mechanical sound effects: off unless the listener turns them on. */
export const useSoundFx = createStoredValue("tapedeck:sound-fx", false, boolean);

export const useRackSort = createStoredValue<RackSort>("tapedeck:rack-sort", "added", (value) =>
  value === "added" || value === "played" || value === "title" ? value : undefined,
);

/** The format "Save audio" last used. */
export const useAudioFormat = createStoredValue<AudioFormat>("tapedeck:audio-format", "mp3", (value) =>
  isAudioFormat(value) ? value : undefined,
);
