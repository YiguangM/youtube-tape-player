// Sleep timer: counts down and calls onExpire when time is up.
import { useEffect, useEffectEvent, useState } from "react";

export const SLEEP_OPTIONS = [0, 15, 30, 60] as const; // minutes; 0 = off
export type SleepMinutes = (typeof SLEEP_OPTIONS)[number];

export function useSleepTimer(onExpire: () => void) {
  const [minutes, setMinutes] = useState<SleepMinutes>(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (endsAt === null) return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) {
        setEndsAt(null);
        setMinutes(0);
        expire();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  function set(next: SleepMinutes) {
    const t = Date.now();
    setMinutes(next);
    setNow(t);
    setEndsAt(next === 0 ? null : t + next * 60_000);
  }

  const remaining = endsAt === null ? 0 : Math.max(0, endsAt - now);
  return { minutes, remaining, set };
}
