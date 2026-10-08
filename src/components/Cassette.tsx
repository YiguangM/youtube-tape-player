"use client";

import { useEffect, useId, useRef } from "react";

const LEFT = { x: 130, y: 114 };
const RIGHT = { x: 270, y: 114 };
const PACK_MIN = 19; // tape radius on an empty hub
const PACK_MAX = 50; // tape radius on a full hub
const TAPE_SPEED = 85; // SVG units of tape per second at play speed

const PALETTES = [
  ["#e4572e", "#f3a712"],
  ["#2e86ab", "#f6c85f"],
  ["#3a7d44", "#f4d35e"],
  ["#b83227", "#1b998b"],
  ["#6c4ab6", "#f49d37"],
  ["#1f4e79", "#e26d5c"],
] as const;

/** Each tape gets its own label colours, picked from its video ID. */
export function tapeColors(id: string): readonly [string, string] {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

/** Radius of a tape pack holding `fraction` of the tape (area-proportional). */
function packRadius(fraction: number) {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.sqrt(PACK_MIN ** 2 + (PACK_MAX ** 2 - PACK_MIN ** 2) * f);
}

type CassetteProps = {
  id: string;
  title: string;
  author: string;
  /** 0..1 how far through the tape we are */
  progress: number;
  /** 0 = still, 1 = playing, larger = fast wind; negative = rewinding */
  motion: number;
  /** Small print on the bottom-right of the label */
  note?: string;
};

export function Cassette({ id, title, author, progress, motion, note = "TYPE I · NORMAL" }: CassetteProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const leftReel = useRef<SVGGElement>(null);
  const rightReel = useRef<SVGGElement>(null);
  const progressRef = useRef(progress);
  const angles = useRef({ left: 0, right: 0 });
  const [stripe, accent] = tapeColors(id);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Spin the reels. Like a real cassette, tape moves past the head at a
  // constant speed, so the fuller reel turns slower than the emptier one.
  useEffect(() => {
    if (motion === 0) return;
    // Animate with the window this cassette is drawn in: the floating player keeps
    // spinning even while the main window is hidden and its frames are paused.
    const view = leftReel.current?.ownerDocument.defaultView ?? window;
    if (view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const p = progressRef.current;
      const toDegrees = (radius: number) => ((TAPE_SPEED * motion * dt) / radius) * (180 / Math.PI);
      angles.current.left += toDegrees(packRadius(1 - p));
      angles.current.right += toDegrees(packRadius(p));
      leftReel.current?.setAttribute("transform", `rotate(${angles.current.left} ${LEFT.x} ${LEFT.y})`);
      rightReel.current?.setAttribute("transform", `rotate(${angles.current.right} ${RIGHT.x} ${RIGHT.y})`);
      frame = view.requestAnimationFrame(tick);
    };
    frame = view.requestAnimationFrame(tick);
    return () => view.cancelAnimationFrame(frame);
  }, [motion]);

  return (
    <svg
      viewBox="0 0 400 256"
      className="block h-auto w-full drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]"
      role="img"
      aria-label={`Cassette tape: ${title}`}
    >
      <defs>
        <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3b41" />
          <stop offset="1" stopColor="#222226" />
        </linearGradient>
        <clipPath id={`${uid}-window`}>
          <rect x="86" y="80" width="228" height="68" rx="10" />
        </clipPath>
      </defs>

      {/* Shell */}
      <rect x="3" y="3" width="394" height="250" rx="14" fill={`url(#${uid}-shell)`} stroke="#0c0c0e" strokeWidth="2" />

      {/* Label */}
      <rect x="24" y="18" width="352" height="162" rx="8" fill="#f3ecdc" />
      <rect x="24" y="62" width="352" height="4" fill={accent} />
      <rect x="24" y="68" width="352" height="94" fill={stripe} />
      <text x="36" y="50" fontSize="24" fontWeight="800" fill="#2b2622" fontFamily="var(--font-geist-sans), sans-serif">
        A
      </text>
      <line x1="64" y1="55" x2="362" y2="55" stroke="#d3c9b3" strokeWidth="1" />
      <foreignObject x="64" y="22" width="298" height="34">
        <div className="cassette-title">{title}</div>
      </foreignObject>
      <text x="36" y="174" fontSize="11" fill="#4a433b" fontFamily="var(--font-permanent-marker), cursive">
        {author ? truncate(author, 34) : ""}
      </text>
      <text x="364" y="174" fontSize="8" letterSpacing="1" textAnchor="end" fill="#8a8072" fontFamily="var(--font-geist-sans), sans-serif">
        {note}
      </text>

      {/* Window with tape packs */}
      <rect x="86" y="80" width="228" height="68" rx="10" fill="#140f0c" />
      <g clipPath={`url(#${uid}-window)`}>
        <circle cx={LEFT.x} cy={LEFT.y} r={packRadius(1 - progress)} fill="#4b3326" />
        <circle cx={RIGHT.x} cy={RIGHT.y} r={packRadius(progress)} fill="#4b3326" />
        <circle cx={LEFT.x} cy={LEFT.y} r={PACK_MIN + 1} fill="none" stroke="#3a271d" strokeWidth="1" />
        <circle cx={RIGHT.x} cy={RIGHT.y} r={PACK_MIN + 1} fill="none" stroke="#3a271d" strokeWidth="1" />
        <rect x="86" y="80" width="228" height="22" fill="#ffffff" opacity="0.05" />
      </g>
      <g ref={leftReel}>
        <Hub cx={LEFT.x} cy={LEFT.y} />
      </g>
      <g ref={rightReel}>
        <Hub cx={RIGHT.x} cy={RIGHT.y} />
      </g>
      <rect x="86" y="80" width="228" height="68" rx="10" fill="none" stroke="#0b0907" strokeWidth="2" />

      {/* Head opening along the bottom edge */}
      <path d="M96 253 L116 196 H284 L304 253 Z" fill="#2d2d32" stroke="#0c0c0e" strokeWidth="1.5" />
      <rect x="112" y="247" width="176" height="3" fill="#4b3326" />
      <circle cx="136" cy="228" r="6" fill="#0b0b0c" />
      <circle cx="264" cy="228" r="6" fill="#0b0b0c" />
      <rect x="188" y="222" width="24" height="15" rx="2" fill="#0b0b0c" />
      <rect x="158" y="234" width="12" height="9" rx="2" fill="#0b0b0c" />
      <rect x="230" y="234" width="12" height="9" rx="2" fill="#0b0b0c" />

      {/* Screws */}
      {[
        [13, 13],
        [387, 13],
        [13, 243],
        [387, 243],
        [200, 207],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r="4.5" fill="#9b9ba3" stroke="#55555c" strokeWidth="1" />
          <path d={`M${cx - 2.5} ${cy} H${cx + 2.5} M${cx} ${cy - 2.5} V${cy + 2.5}`} stroke="#4a4a50" strokeWidth="1" />
        </g>
      ))}
    </svg>
  );
}

function Hub({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <circle cx={cx} cy={cy} r="17" fill="#f4f1ea" stroke="#bdb6a8" strokeWidth="1" />
      <circle cx={cx} cy={cy} r="10.5" fill="#1a1714" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect
          key={i}
          x={cx - 1.6}
          y={cy - 10.5}
          width="3.2"
          height="4.5"
          rx="0.8"
          fill="#f4f1ea"
          transform={`rotate(${i * 60} ${cx} ${cy})`}
        />
      ))}
    </>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
