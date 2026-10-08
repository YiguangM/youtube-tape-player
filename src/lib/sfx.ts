let context: AudioContext | null = null;

/**
 * A short burst of filtered noise that sounds like a deck key latching.
 * "clunk" is the heavier sound used for inserting and ejecting tapes.
 */
export function keyClick(kind: "click" | "clunk" = "click") {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();

    const duration = kind === "clunk" ? 0.09 : 0.035;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 3;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = kind === "clunk" ? 850 : 2400;
    filter.Q.value = 1.2;

    const gain = context.createGain();
    gain.gain.value = kind === "clunk" ? 0.45 : 0.22;

    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  } catch {
    // Sound effects are a nicety; never let them break playback.
  }
}
