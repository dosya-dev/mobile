import { useEffect, useState } from "react";
import { checkForUpdate, type UpdateCheck } from "./sideloadUpdate";
import { getDistributionChannel, getInstalledVersionCode } from "./runtime";

/**
 * The update check as a hook, with a module-scoped cache.
 *
 * Deliberately NOT built on react-query, unlike most data in this app. The
 * only consumer is a banner at the foot of Settings, and going through the
 * query client would make every screen that renders it require a
 * QueryClientProvider - a real coupling, for a value that has nothing to do
 * with the signed-in account and changes a few times a month. The cache below
 * is the whole of what react-query would have given us here.
 *
 * The cache is module-scoped rather than per-hook so remounting Settings does
 * not re-check, and `inflight` is shared so two simultaneous mounts make one
 * request.
 */

/** Six hours: this channel releases a few times a month. */
const TTL_MS = 6 * 60 * 60 * 1000;

let cached: { at: number; result: UpdateCheck } | null = null;
let inflight: Promise<UpdateCheck> | null = null;

/** Test seam; not used by the app. */
export function __resetSideloadUpdateCache(): void {
  cached = null;
  inflight = null;
}

async function load(now: number): Promise<UpdateCheck> {
  if (cached && now - cached.at < TTL_MS) return cached.result;
  if (inflight) return inflight;

  inflight = checkForUpdate({
    channel: getDistributionChannel(),
    installedVersionCode: getInstalledVersionCode(),
  })
    .then((result) => {
      // A failed check is NOT cached: the common cause is being offline, and
      // pinning that for six hours would mean a user who opens Settings on a
      // train never sees an update for the rest of the day. A definite
      // answer - available, up-to-date, or not-applicable - is cached.
      if (result.status !== "unavailable") cached = { at: now, result };
      return result;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function useSideloadUpdate(): UpdateCheck | undefined {
  const [result, setResult] = useState<UpdateCheck | undefined>(
    () => cached?.result,
  );

  useEffect(() => {
    // Nothing to do on a store build or on iOS, and checking would be wrong
    // rather than merely wasteful - see sideloadUpdate.ts. Short-circuited
    // here too so the effect never even starts a promise.
    if (getDistributionChannel() !== "direct") return;
    if (getInstalledVersionCode() == null) return;

    let active = true;
    void load(Date.now()).then((r) => {
      if (active) setResult(r);
    });
    return () => {
      active = false;
    };
  }, []);

  return result;
}
