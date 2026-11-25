import { create } from "zustand";

// The root ErrorBoundary sits above the navigator, so when it catches a
// render error there is no router to push. It parks the report here, resets,
// and PendingReportRedirect (app/_layout.tsx) pushes the screen once the tree
// is back. The screen itself takes params; this store is only that hand-off.

export interface ReportPrefill {
  from?: string | null;
  errorRef?: string | null;
  errorMessage?: string | null;
}

interface ParkedReport extends ReportPrefill {
  parkedAt: number;
}

/** A parked report older than this is abandoned rather than pushed: the user
 *  dismissed the crash, did something else for a while, and a screen full of
 *  stale "what went wrong" context would be confusing rather than helpful. */
export const PENDING_TTL_MS = 2 * 60_000;

interface ReportState {
  pending: ParkedReport | null;
  setPending: (p: ReportPrefill | null) => void;
  consumePending: () => ReportPrefill | null;
}

export const useReportStore = create<ReportState>((set, get) => ({
  pending: null,
  setPending: (p) => set({ pending: p ? { ...p, parkedAt: Date.now() } : null }),
  consumePending: () => {
    const p = get().pending;
    if (!p) return null;
    set({ pending: null });
    if (Date.now() - p.parkedAt > PENDING_TTL_MS) return null;
    const { parkedAt: _parkedAt, ...rest } = p;
    return rest;
  },
}));
