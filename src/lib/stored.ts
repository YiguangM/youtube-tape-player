import { useCallback, useSyncExternalStore } from "react";

type Updater<T> = T | ((previous: T) => T);

/**
 * Creates a hook for a value kept in localStorage, so it survives reloads.
 * If storage is blocked (private mode, disabled cookies), the value just
 * lives in memory for the visit instead of breaking the page.
 */
export function createStoredValue<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
) {
  const listeners = new Set<() => void>();
  let raw: string | null | undefined; // undefined until first read
  let value = fallback;

  function parse(text: string | null): T {
    if (text === null) return fallback;
    try {
      const parsed: unknown = JSON.parse(text);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function read(): T {
    if (raw === undefined) {
      try {
        raw = window.localStorage.getItem(key);
      } catch {
        raw = null;
      }
      value = parse(raw);
    }
    return value;
  }

  function write(next: T) {
    value = next;
    raw = JSON.stringify(next);
    try {
      window.localStorage.setItem(key, raw);
    } catch {
      // Storage unavailable: keep the in-memory value.
    }
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    // Keep other open tabs in sync.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      raw = event.newValue;
      value = parse(raw);
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  const getServerSnapshot = () => fallback;

  return function useStoredValue(): [T, (next: Updater<T>) => void] {
    const current = useSyncExternalStore(subscribe, read, getServerSnapshot);
    const update = useCallback((next: Updater<T>) => {
      write(typeof next === "function" ? (next as (previous: T) => T)(read()) : next);
    }, []);
    return [current, update];
  };
}
