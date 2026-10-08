import { useCallback, useSyncExternalStore } from "react";

type Updater<T> = T | ((previous: T) => T);

/** Turns parsed JSON into a valid value, or undefined if it can't be used. */
type Decode<T> = (value: unknown) => T | undefined;

type StoredValueOptions<T> = {
  /** Builds the value from older storage when this key has never been written. */
  migrate?: () => T | undefined;
  /** Runs once a migrated value has been saved, e.g. to remove the old key. */
  afterMigrate?: () => void;
  /** Called with the raw text when stored data exists but can't be decoded. */
  onUnreadable?: (raw: string) => void;
};

// localStorage can be missing or throw (private windows, blocked site data), so
// every access goes through these and degrades to "nothing stored".
export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/**
 * Creates a hook for a value kept in localStorage, so it survives reloads.
 * If storage is blocked, the value just lives in memory for the visit instead
 * of breaking the page.
 */
export function createStoredValue<T>(
  key: string,
  fallback: T,
  decode: Decode<T>,
  options: StoredValueOptions<T> = {},
) {
  const listeners = new Set<() => void>();
  let raw: string | null | undefined; // undefined until first read
  let value = fallback;

  function parse(text: string | null): T {
    if (text === null) return fallback;
    try {
      const decoded = decode(JSON.parse(text));
      if (decoded !== undefined) return decoded;
    } catch {
      // Fall through to the unreadable case.
    }
    options.onUnreadable?.(text);
    return fallback;
  }

  function read(): T {
    if (raw === undefined) {
      raw = readStorage(key);
      value = parse(raw);
      if (raw === null && options.migrate) {
        const migrated = options.migrate();
        if (migrated !== undefined) {
          value = migrated;
          raw = JSON.stringify(migrated);
          if (writeStorage(key, raw)) options.afterMigrate?.();
        }
      }
    }
    return value;
  }

  function write(next: T) {
    value = next;
    raw = JSON.stringify(next);
    writeStorage(key, raw); // if this fails, the in-memory value still works
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
