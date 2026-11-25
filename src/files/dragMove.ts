/**
 * Drag-to-move in the file list: the pure rules behind it.
 *
 * Ported from apps/web/src/lib/drag-move.ts so the phone answers "what moves"
 * and "where may it land" the same way the web page does. The gesture itself
 * (PanResponder, ghost, hit test) lives in useDragMove.ts; nothing here touches
 * the screen.
 */

export interface MoveItems {
  fileIds: string[];
  folderIds: string[];
}

export interface DragItem {
  id: string;
  kind: "file" | "folder";
}

/**
 * What a drag starting on `item` carries: the whole selection when the item is
 * part of it, otherwise just the item. Dragging an unselected row never sweeps
 * the selection along - the same rule desktop file managers follow.
 */
export function itemsForDrag(item: DragItem, selectedFiles: ReadonlySet<string>, selectedFolders: ReadonlySet<string>): MoveItems {
  const inSelection = item.kind === "file" ? selectedFiles.has(item.id) : selectedFolders.has(item.id);
  if (inSelection) return { fileIds: [...selectedFiles], folderIds: [...selectedFolders] };
  return item.kind === "file" ? { fileIds: [item.id], folderIds: [] } : { fileIds: [], folderIds: [item.id] };
}

/** How many items a drag carries (what the ghost's pill and the confirm count). */
export function moveCount(items: MoveItems): number {
  return items.fileIds.length + items.folderIds.length;
}

/**
 * Whether `targetFolderId` (null = the workspace root) accepts the items.
 *
 * `sourceFolderId` is the folder the items are listed in: null for the root,
 * undefined when unknown, in which case only the folder-onto-itself rule
 * applies and the server judges the rest. A folder dropped into one of its own
 * descendants is not caught here - the listing does not know the tree - and
 * the server refuses it with its own message.
 */
export function canDropOn(items: MoveItems, targetFolderId: string | null, sourceFolderId: string | null | undefined): boolean {
  if (moveCount(items) === 0) return false;
  if (targetFolderId !== null && items.folderIds.includes(targetFolderId)) return false;
  if (sourceFolderId !== undefined && targetFolderId === sourceFolderId) return false;
  return true;
}

/**
 * Whether the current view lets items be dragged at all. The library views
 * (Docs, Images, Videos) and the Hidden filter are not folder listings, so a
 * drag there would have no meaningful "from".
 */
export function canDragInView(view: { isLibrary: boolean; isHidden: boolean }): boolean {
  return !view.isLibrary && !view.isHidden;
}

export interface AutoScrollInput {
  /** The finger and where the hold began, in the same coordinates as `area`. */
  finger: { x: number; y: number };
  start: { x: number; y: number };
  /** The list's area: top edge and height. */
  area: { y: number; h: number };
  /** Whether the finger has already travelled far enough from the hold for the edges to scroll. */
  armed: boolean;
  scrollY: number;
  maxScrollY: number;
}

export interface AutoScrollStep {
  /** The offset to scroll to, or null to leave the list where it is. */
  next: number | null;
  armed: boolean;
}

/** Finger this close to the list's top or bottom edge scrolls it, so folders off screen can be reached. */
export const EDGE = 56;
export const SCROLL_STEP = 10;
/** The finger has to travel this far from where the hold began before the edges scroll: a hold on the top row is not a request to scroll up. */
export const SCROLL_ARM_DISTANCE = 24;

/**
 * One tick of edge auto-scroll during a drag: pure, so the rule is testable
 * without a list. The edges only respond once the finger has moved
 * SCROLL_ARM_DISTANCE from the hold, and stay armed from then on.
 */
export function autoScrollStep(input: AutoScrollInput): AutoScrollStep {
  const { finger, start, area, scrollY, maxScrollY } = input;
  const armed = input.armed || Math.hypot(finger.x - start.x, finger.y - start.y) >= SCROLL_ARM_DISTANCE;
  if (!armed) return { next: null, armed };
  let next = scrollY;
  if (finger.y < area.y + EDGE) next = Math.max(0, scrollY - SCROLL_STEP);
  else if (finger.y > area.y + area.h - EDGE) next = Math.min(Math.max(0, maxScrollY), scrollY + SCROLL_STEP);
  return { next: next === scrollY ? null : next, armed };
}

/** The most frequent string (first seen wins a tie), or null for none. Picks the reason a move toast names. */
export function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (best === null || n > (counts.get(best) ?? 0)) best = v;
  }
  return best;
}
