// Minimal typings for the parts of the YouTube IFrame Player API this app uses.
// Reference: https://developers.google.com/youtube/iframe_api_reference
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  cueVideoById(video: string | YTVideoRequest): void;
  loadVideoById(video: string | YTVideoRequest): void;
  cuePlaylist(playlist: YTPlaylistRequest): void;
  loadPlaylist(playlist: YTPlaylistRequest): void;
  nextVideo(): void;
  previousVideo(): void;
  /** Video IDs in the loaded playlist, or null when a single video is loaded. */
  getPlaylist(): string[] | null;
  getPlaylistIndex(): number;
  /** Undocumented but long-standing; used only to show the current track title. */
  getVideoData?(): { title?: string; video_id?: string };
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  /** Speeds the current video allows; just [1] for live streams. */
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}

interface YTVideoRequest {
  videoId: string;
  startSeconds?: number;
}

interface YTPlaylistRequest {
  list: string;
  listType: "playlist";
  index?: number;
  startSeconds?: number;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}

interface YTPlayerOptions {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: YTPlayerEvent) => void;
    onError?: (event: YTPlayerEvent) => void;
    onPlaybackRateChange?: (event: YTPlayerEvent) => void;
  };
}

interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const PlayerState = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads YouTube's iframe API script once and resolves when `YT.Player` is usable. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);

  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      script.remove();
      reject(new Error("Couldn't load YouTube's player. Check your connection or ad blocker."));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{12,64}$/;

export function isVideoId(value: string): boolean {
  return VIDEO_ID.test(value) && value !== "videoseries";
}

export function isListId(value: string): boolean {
  return LIST_ID.test(value);
}

export type YouTubeLink = {
  videoId: string | null;
  listId: string | null;
  /** The link pointed at a YouTube Mix, which can't be played in an embedded player. */
  isMix: boolean;
};

/**
 * Pulls the video and/or playlist ID out of anything a person might paste:
 * watch links, playlist links, youtu.be short links, Shorts, embeds, live
 * links, or a bare video or playlist ID.
 */
export function parseYouTubeLink(input: string): YouTubeLink | null {
  const text = input.trim();
  if (isVideoId(text)) return { videoId: text, listId: null, isMix: false };
  if (/^(PL|OLAK5uy_)/.test(text) && isListId(text)) return { videoId: null, listId: text, isMix: false };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let videoId: string | null = null;
  if (host === "youtu.be") {
    videoId = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    videoId =
      url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? null;
  } else {
    return null;
  }

  const list = url.searchParams.get("list");
  // Mixes (RD…) are generated on the fly for each viewer, so they can't be embedded.
  const isMix = list !== null && list.startsWith("RD");
  const listId = list && !isMix && isListId(list) ? list : null;
  const video = videoId && isVideoId(videoId) ? videoId : null;

  if (!video && !listId && !isMix) return null;
  return { videoId: video, listId, isMix };
}

/** 83 -> "01:23", 3725 -> "1:02:05" */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
