"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const START_ANGLE = -135; // knob pointer at volume 0
const SWEEP = 270; // degrees from 0 to 100
const WHEEL_PX_PER_STEP = 25; // one mouse-wheel notch (~100px) moves the volume by 4
const DRAG_PX_PER_STEP = 2;

const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** SVG arc along the knob's scale, from one angle to another (0° = 12 o'clock). */
function arcPath(from: number, to: number) {
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return `${(50 + 45 * Math.sin(rad)).toFixed(2)} ${(50 - 45 * Math.cos(rad)).toFixed(2)}`;
  };
  return `M ${point(from)} A 45 45 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

type VolumeKnobProps = {
  value: number;
  onChange: (value: number) => void;
  size?: number;
  className?: string;
};

/**
 * A rotary volume knob. Hover and scroll the mouse wheel to turn it; it can
 * also be dragged up/down or adjusted with the arrow keys when focused.
 */
export function VolumeKnob({ value, onChange, size = 56, className }: VolumeKnobProps) {
  const knobRef = useRef<HTMLDivElement>(null);
  // Includes changes made since the last render, so fast scrolling never drops steps.
  const latest = useRef(value);
  const drag = useRef<{ y: number; from: number } | null>(null);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  function set(next: number) {
    const v = clamp(next);
    if (v === latest.current) return;
    latest.current = v;
    onChange(v);
  }

  const onWheelSteps = useEffectEvent((steps: number) => set(latest.current + steps));

  // React's wheel handlers are passive, so listen natively to stop the page scrolling.
  useEffect(() => {
    const knob = knobRef.current;
    if (!knob) return;
    let carry = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const px = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      carry -= px / WHEEL_PX_PER_STEP;
      const steps = Math.trunc(carry);
      if (steps !== 0) {
        carry -= steps;
        onWheelSteps(steps);
      }
    };
    knob.addEventListener("wheel", onWheel, { passive: false });
    return () => knob.removeEventListener("wheel", onWheel);
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const changes: Record<string, number> = {
      ArrowUp: 5,
      ArrowRight: 5,
      ArrowDown: -5,
      ArrowLeft: -5,
      PageUp: 10,
      PageDown: -10,
      Home: -100,
      End: 100,
    };
    if (!(event.key in changes)) return;
    event.preventDefault();
    event.stopPropagation(); // don't also trigger the deck's arrow-key skipping
    set(latest.current + changes[event.key]);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, from: latest.current };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    set(drag.current.from + (drag.current.y - event.clientY) / DRAG_PX_PER_STEP);
  }

  function endDrag() {
    drag.current = null;
  }

  const angle = START_ANGLE + (SWEEP * value) / 100;

  return (
    <div
      ref={knobRef}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      title="Hover and scroll the mouse wheel to change the volume"
      className={`knob ${className ?? ""}`}
      style={{ width: size, height: size, "--knob-size": `${size}px`, "--angle": `${angle}deg` } as CSSProperties}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <svg viewBox="0 0 100 100" className="knob-scale" aria-hidden>
        <path d={arcPath(START_ANGLE, START_ANGLE + SWEEP)} className="knob-track" />
        {value > 0 && <path d={arcPath(START_ANGLE, angle)} className="knob-level" />}
      </svg>
      <div className="knob-cap" aria-hidden />
      <div className="knob-shine" aria-hidden>
        {value}
      </div>
    </div>
  );
}
