// Mechanical deck sounds, synthesized with Web Audio (no recorded samples).
// Off by default; the SOUND FX switch turns them on.

let context: AudioContext | null = null;
let enabled = false;

export function setSoundEffects(on: boolean) {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** A buffer of white noise, `seconds` long, shaped by `envelope` (0..1 over its length). */
function noise(ctx: AudioContext, seconds: number, envelope: (x: number) => number) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * envelope(i / samples.length);
  return buffer;
}

const SOUNDS = {
  click: { seconds: 0.035, frequency: 2400, q: 1.2, gain: 0.22 }, // a piano key latching
  clunk: { seconds: 0.09, frequency: 850, q: 1.2, gain: 0.45 }, // heavier mechanism
  insert: { seconds: 0.12, frequency: 600, q: 0.9, gain: 0.5 }, // cassette dropping into the door
  eject: { seconds: 0.16, frequency: 1100, q: 2.5, gain: 0.4 }, // spring-loaded door popping open
} as const;

export type DeckSound = keyof typeof SOUNDS;

/** Plays a short mechanical sound (if sound effects are on). */
export function keyClick(kind: DeckSound = "click") {
  const ctx = audio();
  if (!ctx) return;
  try {
    const sound = SOUNDS[kind];
    const source = ctx.createBufferSource();
    source.buffer = noise(ctx, sound.seconds, (x) => (1 - x) ** 3);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = sound.frequency;
    filter.Q.value = sound.q;

    const gain = ctx.createGain();
    gain.gain.value = sound.gain;

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  } catch {
    // Sound effects are a nicety; never let them break playback.
  }
}

/**
 * The whir of the tape winding while REW / FF is held: filtered noise that
 * rises in pitch as the reels speed up. Returns a function that stops it.
 */
export function startWhir(): () => void {
  const ctx = audio();
  if (!ctx) return () => {};
  try {
    const source = ctx.createBufferSource();
    source.buffer = noise(ctx, 1, () => 1);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(380, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(1300, ctx.currentTime + 4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.15);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    return () => {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.12);
      source.stop(now + 0.15);
    };
  } catch {
    return () => {};
  }
}
