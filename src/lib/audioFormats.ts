// The audio formats "Save audio" offers (used by the deck and by /api/audio).

export type AudioFormat = "mp3" | "m4a" | "opus";

export const AUDIO_FORMATS: { id: AudioFormat; name: string; hint: string; mime: string }[] = [
  { id: "mp3", name: "MP3", hint: "Plays on everything", mime: "audio/mpeg" },
  { id: "m4a", name: "M4A (AAC)", hint: "Smaller files, made for Apple devices", mime: "audio/mp4" },
  { id: "opus", name: "Opus", hint: "Smallest, keeps YouTube's original sound", mime: "audio/ogg" },
];

export function isAudioFormat(value: unknown): value is AudioFormat {
  return AUDIO_FORMATS.some((f) => f.id === value);
}

export function audioFormat(id: AudioFormat) {
  return AUDIO_FORMATS.find((f) => f.id === id) ?? AUDIO_FORMATS[0];
}
