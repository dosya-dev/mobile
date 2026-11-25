import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";

export interface Bookmark { id: string; location: string; label: string; createdAt: string }
export interface ReadingState { version: 1; location: string | null; percent: number; bookmarks: Bookmark[] }

export const EMPTY_STATE: ReadingState = { version: 1, location: null, percent: 0, bookmarks: [] };

const dir = () => `${FileSystem.documentDirectory}reader-state/`;
const pathFor = (fileId: string) => `${dir()}${fileId}.json`;

function isReadingState(v: unknown): v is ReadingState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return s.version === 1 && Array.isArray(s.bookmarks) && typeof s.percent === "number";
}

/** Load per-book state; any read/parse/shape failure degrades to EMPTY_STATE. */
export async function loadReadingState(fileId: string): Promise<ReadingState> {
  try {
    const raw = await FileSystem.readAsStringAsync(pathFor(fileId));
    const parsed: unknown = JSON.parse(raw);
    return isReadingState(parsed) ? parsed : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

export async function saveReadingState(fileId: string, state: ReadingState): Promise<void> {
  await FileSystem.makeDirectoryAsync(dir(), { intermediates: true }).catch(() => {});
  await FileSystem.writeAsStringAsync(pathFor(fileId), JSON.stringify(state));
}

/**
 * Per-fileId write queue. Every caller that wants to mutate a book's reading
 * state - the position saver's debounced flush, bookmark add/remove from the
 * UI - must go through `updateReadingState` rather than doing its own
 * load-mutate-save, otherwise two independent read-modify-write cycles can
 * interleave and silently drop one side's change (e.g. a bookmark toggle
 * racing a debounced position flush).
 *
 * Each queue slot always settles (fulfilled or rejected) before the next
 * queued operation starts, and a rejection is never left dangling in the
 * map - so one failed write degrades that single call without wedging
 * subsequent updates for the same fileId.
 */
const writeQueues = new Map<string, Promise<unknown>>();

export async function updateReadingState(
  fileId: string,
  mutate: (state: ReadingState) => ReadingState,
): Promise<ReadingState> {
  const previous = writeQueues.get(fileId) ?? Promise.resolve();
  let result: ReadingState;
  const op = previous.then(async () => {
    const current = await loadReadingState(fileId);
    result = mutate(current);
    await saveReadingState(fileId, result);
  });
  // Always resolves, whether `op` fulfilled or rejected, so the next caller
  // for this fileId is never blocked by this call's failure.
  writeQueues.set(
    fileId,
    op.then(
      () => {},
      () => {},
    ),
  );
  await op;
  return result!;
}

export function addBookmark(state: ReadingState, location: string, label: string, id?: string): ReadingState {
  const bookmark: Bookmark = { id: id ?? Crypto.randomUUID(), location, label, createdAt: new Date().toISOString() };
  return { ...state, bookmarks: [...state.bookmarks, bookmark] };
}

export function removeBookmark(state: ReadingState, id: string): ReadingState {
  return { ...state, bookmarks: state.bookmarks.filter((b) => b.id !== id) };
}

export function hasBookmarkAt(state: ReadingState, location: string): Bookmark | undefined {
  return state.bookmarks.find((b) => b.location === location);
}

/**
 * Debounced position persistence. Reads the current file on each write so
 * bookmarks added elsewhere are never clobbered by a stale in-memory copy.
 */
export function createPositionSaver(fileId: string, debounceMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: { location: string; percent: number } | null = null;

  const write = async () => {
    if (!latest) return;
    const { location, percent } = latest;
    await updateReadingState(fileId, (current) => ({ ...current, location, percent }));
  };

  return {
    update(location: string, percent: number) {
      latest = { location, percent };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void write().catch(() => {}); }, debounceMs);
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null; }
      await write();
    },
  };
}
