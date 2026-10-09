// Cassette shell colours. "smoke" is the default dark grey; "clear" is
// see-through plastic.

export type ShellId = "smoke" | "black" | "white" | "red" | "blue" | "yellow" | "clear";
export type LabelFont = "handwritten" | "typed";

type Shell = {
  id: ShellId;
  name: string;
  /** Shell gradient, top to bottom */
  top: string;
  bottom: string;
  /** Outline and the raised head section along the bottom edge */
  edge: string;
  base: string;
  /** Text colour that reads on the shell colour (used for the rack spine) */
  ink: string;
};

export const SHELLS: readonly Shell[] = [
  { id: "smoke", name: "Smoke grey", top: "#3b3b41", bottom: "#222226", edge: "#0c0c0e", base: "#2d2d32", ink: "#ffffff" },
  { id: "black", name: "Black", top: "#26262a", bottom: "#0d0d0f", edge: "#000000", base: "#18181b", ink: "#ffffff" },
  { id: "white", name: "White", top: "#f4f4f2", bottom: "#d2d2d0", edge: "#8d8d92", base: "#c4c4c6", ink: "#1d1d21" },
  { id: "red", name: "Red", top: "#c9412f", bottom: "#8f271c", edge: "#4a120c", base: "#a8331f", ink: "#ffffff" },
  { id: "blue", name: "Blue", top: "#3277c0", bottom: "#1c4d84", edge: "#0d2645", base: "#245f9e", ink: "#ffffff" },
  { id: "yellow", name: "Yellow", top: "#f3c63a", bottom: "#c99b14", edge: "#6b5208", base: "#d9ab22", ink: "#1d1d21" },
  {
    id: "clear",
    name: "Clear plastic",
    top: "rgba(225, 233, 242, 0.42)",
    bottom: "rgba(170, 184, 200, 0.28)",
    edge: "rgba(255, 255, 255, 0.55)",
    base: "rgba(200, 212, 226, 0.35)",
    ink: "#1d1d21",
  },
];

export const SHELL_IDS = SHELLS.map((s) => s.id);

export function shellById(id: ShellId | undefined): Shell {
  return SHELLS.find((s) => s.id === id) ?? SHELLS[0];
}

export const LABEL_FONTS: { id: LabelFont; name: string; family: string }[] = [
  { id: "handwritten", name: "Handwritten", family: "var(--font-permanent-marker), 'Comic Sans MS', cursive" },
  { id: "typed", name: "Typed", family: "'Courier New', Courier, ui-monospace, monospace" },
];

export function labelFamily(font: LabelFont | undefined): string {
  return (LABEL_FONTS.find((f) => f.id === font) ?? LABEL_FONTS[0]).family;
}
