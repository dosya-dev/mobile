import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { makeMutable, runOnJS, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

/** How long the header cross-fade (and anything else following `progress`) takes. */
export const SELECTION_FADE_MS = 220;
const ROW_STEP_MS = 28;
const COL_STEP_MS = 14;
const MAX_DELAY_MS = 300;

/**
 * The wave's delay for the tile at (row, col): rows count from the first one on
 * screen, so the wave always starts at the top-left of what the person sees.
 * A tile outside the visible rows gets none - nobody is watching it arrive.
 */
export function staggerDelay(row: number, col: number, firstVisibleRow: number, visibleRows: number): number {
  "worklet";
  if (row < firstVisibleRow || row >= firstVisibleRow + visibleRows) return 0;
  return Math.min(MAX_DELAY_MS, (row - firstVisibleRow) * ROW_STEP_MS + col * COL_STEP_MS);
}

/** The first visible row and how many rows are visible, from a list's viewable item indexes. */
export function visibleRowsOf(items: readonly { index: number | null }[], columns: number): { first: number; count: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of items) {
    if (it.index === null || it.index === undefined) continue;
    const row = Math.floor(it.index / columns);
    if (row < lo) lo = row;
    if (row > hi) hi = row;
  }
  return lo === Infinity ? { first: 0, count: 0 } : { first: lo, count: hi - lo + 1 };
}

export interface SelectionMotion {
  /** 0 -> 1 over SELECTION_FADE_MS as selection mode turns on (and back). The header follows it. */
  progress: SharedValue<number>;
  /** 0 or 1, flipped at once: what each check circle animates towards, with its own delay. */
  active: SharedValue<number>;
  /** The list's first visible row, from onViewableItemsChanged. */
  firstVisibleRow: SharedValue<number>;
  /** How many rows are visible from there. */
  visibleRows: SharedValue<number>;
  /** The list reports what is on screen. Stable identity. */
  reportVisibleRows: (first: number, count: number) => void;
  /**
   * Whether tiles should have their check circles mounted: true from the moment
   * selection starts until the way-out fade has finished, so leaving is the
   * same one shared-value change as entering (no per-check exit animations),
   * and the checks unmount in one pass after it.
   */
  checksMounted: boolean;
}

/**
 * The shared values that drive every check circle and the header swap. One
 * change (selection on/off) is one write here; each tile reads it on the UI
 * thread, so entering selection re-renders no tile for the motion's sake.
 */
export function useSelectionMotionState(selecting: boolean): SelectionMotion {
  const reduced = useReducedMotion();
  const progress = useSharedValue(selecting ? 1 : 0);
  const active = useSharedValue(selecting ? 1 : 0);
  const firstVisibleRow = useSharedValue(0);
  const visibleRows = useSharedValue(0);
  const [checksMounted, setChecksMounted] = useState(selecting);
  // Mounted in the same render selection starts (derived state), so the checks
  // are there from the first frame of the fade-in.
  if (selecting && !checksMounted) setChecksMounted(true);

  // In an effect, not during render: tiles that mount in the same commit (their
  // checks appear with selection mode) start from 0 and see this as a change.
  useEffect(() => {
    const to = selecting ? 1 : 0;
    active.value = to;
    if (reduced) {
      progress.value = to;
      if (!selecting) setChecksMounted(false);
      return;
    }
    progress.value = withTiming(to, { duration: SELECTION_FADE_MS }, (finished) => {
      "worklet";
      // Cancelled (selection started again mid-fade): the checks stay.
      if (finished && to === 0) runOnJS(setChecksMounted)(false);
    });
  }, [selecting, reduced, active, progress]);

  const reportVisibleRows = useCallback((first: number, count: number) => {
    firstVisibleRow.value = first;
    visibleRows.value = count;
  }, [firstVisibleRow, visibleRows]);

  return useMemo(
    () => ({ progress, active, firstVisibleRow, visibleRows, reportVisibleRows, checksMounted: checksMounted || selecting }),
    [progress, active, firstVisibleRow, visibleRows, reportVisibleRows, checksMounted, selecting],
  );
}

const Ctx = createContext<SelectionMotion | null>(null);

let fallback: SelectionMotion | null = null;
/** Outside a provider (a lone tile): checks are simply there. */
function settled(): SelectionMotion {
  fallback ??= {
    progress: makeMutable(1),
    active: makeMutable(1),
    firstVisibleRow: makeMutable(0),
    visibleRows: makeMutable(0),
    reportVisibleRows: () => {},
    checksMounted: true,
  };
  return fallback;
}

/** Provides a motion made elsewhere (FileBrowser makes it so its own list can report rows). */
export function SelectionMotionScope({ value, children }: { value: SelectionMotion; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Owns the selection motion for everything under it. */
export function SelectionMotionProvider({ selecting, children }: { selecting: boolean; children: ReactNode }) {
  const value = useSelectionMotionState(selecting);
  return <SelectionMotionScope value={value}>{children}</SelectionMotionScope>;
}

export function useSelectionMotion(): SelectionMotion {
  return useContext(Ctx) ?? settled();
}
