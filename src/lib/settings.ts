// Deck settings that are remembered between visits.
import { createStoredValue } from "./stored";

const numberBetween = (min: number, max: number) => (value: unknown) =>
  typeof value === "number" && value >= min && value <= max ? value : undefined;

const boolean = (value: unknown) => (typeof value === "boolean" ? value : undefined);

export const useVolume = createStoredValue("tapedeck:volume", 80, numberBetween(0, 100));
export const useSpeed = createStoredValue("tapedeck:speed", 1, numberBetween(0.25, 2));
export const useAutoNext = createStoredValue("tapedeck:auto-next", true, boolean);
