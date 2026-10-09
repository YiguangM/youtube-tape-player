// Media Session: shows what's playing in the operating system's media controls
// (the Windows media flyout, Chrome's media hub) and lets hardware media keys
// drive the deck. https://developer.mozilla.org/docs/Web/API/Media_Session_API
//
// Limitation: the YouTube player runs in its own iframe and may register a media
// session of its own. Browsers route the media keys to one session per tab, so
// depending on the browser our handlers may not be the ones that receive them.
import { useEffect, useEffectEvent } from "react";

export type MediaSessionInfo = {
  title: string;
  artist: string;
  album: string;
  artwork?: string;
};

export type MediaSessionActions = {
  play: () => void;
  pause: () => void;
  stop: () => void;
  previousTrack: () => void;
  nextTrack: () => void;
  seekBy: (seconds: number) => void;
  seekTo: (seconds: number) => void;
};

type Options = {
  info: MediaSessionInfo | null;
  state: "playing" | "paused" | "none";
  position: { duration: number; position: number; playbackRate: number } | null;
  hasPrevious: boolean;
  hasNext: boolean;
  actions: MediaSessionActions;
};

const SEEK_STEP = 10;

const supported = () => typeof navigator !== "undefined" && "mediaSession" in navigator;

function setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // This browser doesn't support the action (e.g. "seekto" or "stop").
  }
}

export function useMediaSession({ info, state, position, hasPrevious, hasNext, actions }: Options) {
  const title = info?.title ?? "";
  const artist = info?.artist ?? "";
  const album = info?.album ?? "";
  const artwork = info?.artwork ?? "";
  const hasInfo = info !== null;

  useEffect(() => {
    if (!supported()) return;
    navigator.mediaSession.metadata = hasInfo
      ? new MediaMetadata({
          title,
          artist,
          album,
          artwork: artwork ? [{ src: artwork, sizes: "480x360", type: "image/jpeg" }] : [],
        })
      : null;
  }, [hasInfo, title, artist, album, artwork]);

  useEffect(() => {
    if (supported()) navigator.mediaSession.playbackState = state;
  }, [state]);

  const duration = position?.duration ?? 0;
  const at = position?.position ?? 0;
  const rate = position?.playbackRate ?? 1;
  useEffect(() => {
    if (!supported() || !navigator.mediaSession.setPositionState) return;
    try {
      if (duration > 0) {
        navigator.mediaSession.setPositionState({ duration, position: Math.min(at, duration), playbackRate: rate });
      } else {
        navigator.mediaSession.setPositionState();
      }
    } catch {
      // Ignore positions the browser rejects (e.g. while a video is loading).
    }
  }, [duration, at, rate]);

  // Handlers call the latest actions, so they only need registering once.
  const run = useEffectEvent((action: MediaSessionAction, details: MediaSessionActionDetails) => {
    switch (action) {
      case "play":
        return actions.play();
      case "pause":
        return actions.pause();
      case "stop":
        return actions.stop();
      case "previoustrack":
        return actions.previousTrack();
      case "nexttrack":
        return actions.nextTrack();
      case "seekbackward":
        return actions.seekBy(-(details.seekOffset ?? SEEK_STEP));
      case "seekforward":
        return actions.seekBy(details.seekOffset ?? SEEK_STEP);
      case "seekto":
        if (details.seekTime !== undefined) actions.seekTo(details.seekTime);
        return;
    }
  });

  useEffect(() => {
    if (!supported()) return;
    const always: MediaSessionAction[] = ["play", "pause", "stop", "seekbackward", "seekforward", "seekto"];
    for (const action of always) setHandler(action, (details) => run(action, details));
    return () => always.forEach((action) => setHandler(action, null));
  }, []);

  // Only offer previous / next when there is somewhere to go.
  useEffect(() => {
    if (!supported()) return;
    setHandler("previoustrack", hasPrevious ? (details) => run("previoustrack", details) : null);
    setHandler("nexttrack", hasNext ? (details) => run("nexttrack", details) : null);
  }, [hasPrevious, hasNext]);

  useEffect(
    () => () => {
      if (!supported()) return;
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    },
    [],
  );
}
