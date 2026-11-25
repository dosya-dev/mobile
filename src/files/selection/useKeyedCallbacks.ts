import { useCallback, useRef } from "react";

/**
 * Stable per-item callbacks for a memoised list. `cb(key, fn)` returns the same
 * function for the same key on every render, and that function always calls
 * the latest `fn` given for the key - so a tile's props stay equal across a
 * parent render (React.memo holds) without the tile ever calling a stale
 * closure (an old file list, an old selection).
 */
export function useKeyedCallbacks(): (key: string, fn: () => void) => () => void {
  const latest = useRef(new Map<string, () => void>());
  const stable = useRef(new Map<string, () => void>());
  return useCallback((key: string, fn: () => void) => {
    latest.current.set(key, fn);
    let w = stable.current.get(key);
    if (!w) {
      w = () => latest.current.get(key)?.();
      stable.current.set(key, w);
    }
    return w;
  }, []);
}
