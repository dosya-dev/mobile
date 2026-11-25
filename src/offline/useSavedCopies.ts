import { useCallback, useEffect, useMemo, useState } from "react";
import { savedCopy, type SavedCopy } from "./read";

/**
 * The saved offline copies of a handful of files - the viewer's current page,
 * the photo pages either side of it, and a Live Photo's motion twin.
 *
 * A key is absent while its lookup is running, then holds the copy or null.
 * The difference matters: a page must not render (and fail) its network
 * source before we know whether a saved copy should be shown instead.
 * Keyed by id and version, so a newer saved version is looked up again.
 *
 * `recheck(id)` forgets one answer and looks again: a saved copy that fails to
 * load may simply be gone (an unpin or a sync removed it while the viewer was
 * open), and the fresh lookup says so instead of the cached one.
 */
export function useSavedCopies(items: readonly { id: string; version: number }[]): {
  copies: Readonly<Record<string, SavedCopy | null>>;
  recheck: (id: string) => void;
} {
  const key = items.map((i) => `${i.id}@${i.version}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wanted = useMemo(() => items, [key]);
  const [found, setFound] = useState<Record<string, { at: string; copy: SavedCopy | null }>>({});
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    for (const { id, version } of wanted) {
      const at = `${id}@${version}`;
      if (found[id]?.at === at) continue;
      savedCopy(id)
        .catch(() => null)
        .then((copy) => {
          if (alive) setFound((m) => (m[id]?.at === at ? m : { ...m, [id]: { at, copy } }));
        });
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, nonce]);

  const recheck = useCallback((id: string) => {
    setFound((m) => {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
    setNonce((n) => n + 1);
  }, []);

  const copies = useMemo(() => {
    const out: Record<string, SavedCopy | null> = {};
    for (const { id, version } of wanted) {
      const f = found[id];
      if (f && f.at === `${id}@${version}`) out[id] = f.copy;
    }
    return out;
  }, [found, wanted]);

  return { copies, recheck };
}
