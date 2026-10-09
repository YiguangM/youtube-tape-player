// Track order for mixtapes.
//
// `played` is the history of tracks played (the last one is the current track)
// and `queue` holds the tracks still to come in this cycle. Shuffling builds the
// queue from every other track, so nothing repeats until each track has played;
// PREV walks back through `played`, the actual play history.

export type Sequence = { count: number; played: number[]; queue: number[] };
export type Repeat = "off" | "one" | "all";

const MAX_HISTORY = 500;

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** The tracks after `current`: in order, or every other track shuffled. */
function upcoming(count: number, current: number, shuffle: boolean): number[] {
  return shuffle ? shuffled(range(0, count).filter((i) => i !== current)) : range(current + 1, count);
}

export function currentTrack(sequence: Sequence): number {
  return sequence.played[sequence.played.length - 1];
}

export function startSequence(count: number, first: number, shuffle: boolean): Sequence {
  const start = Math.min(Math.max(0, first), Math.max(0, count - 1));
  return { count, played: [start], queue: upcoming(count, start, shuffle) };
}

/** Whether there is a next track (with repeat-all, a mixtape never runs out). */
export function hasNext(sequence: Sequence, repeat: Repeat): boolean {
  return sequence.queue.length > 0 || (repeat === "all" && sequence.count > 0);
}

/** Moves to the next track, or returns null at the end of the tape. */
export function nextInSequence(sequence: Sequence, shuffle: boolean, repeat: Repeat): Sequence | null {
  const played = (next: number) => [...sequence.played, next].slice(-MAX_HISTORY);
  if (sequence.queue.length > 0) {
    return { ...sequence, played: played(sequence.queue[0]), queue: sequence.queue.slice(1) };
  }
  if (repeat !== "all" || sequence.count === 0) return null;

  // Start a new cycle. A shuffled cycle avoids replaying the track that just ended.
  const current = currentTrack(sequence);
  let cycle = shuffle ? shuffled(range(0, sequence.count)) : range(0, sequence.count);
  if (shuffle && sequence.count > 1 && cycle[0] === current) cycle = [...cycle.slice(1), cycle[0]];
  return { ...sequence, played: played(cycle[0]), queue: cycle.slice(1) };
}

/**
 * Steps back through the play history, or returns null at its start. When
 * shuffled, NEXT then retraces the way forward; in order, the tracks after the
 * new current one simply follow in order (so the last track ends the tape).
 */
export function previousInSequence(sequence: Sequence, shuffle: boolean): Sequence | null {
  if (sequence.played.length < 2) return null;
  const current = currentTrack(sequence);
  const played = sequence.played.slice(0, -1);
  const queue = shuffle ? [current, ...sequence.queue] : range(played[played.length - 1] + 1, sequence.count);
  return { ...sequence, played, queue };
}

/** Turns shuffle on or off from the current track onwards. */
export function reshuffle(sequence: Sequence, shuffle: boolean): Sequence {
  return { ...sequence, queue: upcoming(sequence.count, currentTrack(sequence), shuffle) };
}
