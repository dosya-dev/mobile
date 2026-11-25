import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useSharedValue, type SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { measureInWindow } from "./dragMeasure";
import { autoScrollStep, canDropOn, itemsForDrag, type DragItem, type MoveItems } from "./dragMove";
import { LONG_PRESS_MS } from "./dragTiming";
import type { DragHandle, DropTargetRef } from "./dragHandle";
import type { MoveTarget } from "./MoveConfirmDialog";

const SCROLL_TICK_MS = 40;
/** A hold may wander this far and still count as a hold rather than a drag. */
const HOLD_SLOP = 12;

interface Rect { x: number; y: number; w: number; h: number }
interface Point { x: number; y: number }

export interface DragState {
  /** The row or card the hold started on. */
  item: DragItem;
  /** Everything the drag carries (the selection, when the item is part of it). */
  items: MoveItems;
}

export interface UseDragMoveOptions {
  /** False in views where nothing can be dragged (library kinds, the Hidden filter) and with no workspace. */
  enabled: boolean;
  /** The folder the listed items live in: the drop rules refuse it as a destination. */
  sourceFolderId: string | null;
  selectedFiles: ReadonlySet<string>;
  selectedFolders: ReadonlySet<string>;
  /** Whether the role may move this kind of item at all: no handle is given otherwise. */
  canDrag: (item: DragItem) => boolean;
  nameOfFolder: (id: string) => string;
  /** A release over a folder. Nothing has moved: the caller confirms first. */
  onDrop: (items: MoveItems, target: MoveTarget) => void;
  /** A hold released without moving: the caller opens the item's actions. */
  onHold: (item: DragItem) => void;
}

const itemKey = (item: DragItem) => `${item.kind}-${item.id}`;

/**
 * Hold a row or card, move the finger, drop it on a folder.
 *
 * Built on react-native-gesture-handler. Each source gets two gestures that
 * run together: a LongPress (LONG_PRESS_MS, HOLD_SLOP) that arms the drag,
 * gives a haptic tick and turns the list's scrolling off, and a Pan allowed to
 * activate only after that same hold. A finger that moves before the hold is
 * up fails both, so a scroll is a scroll; a finger that lifts without moving
 * ends the LongPress with success and is reported through onHold; a finger
 * that moves after the hold activates the Pan, which owns the touch from
 * there (the list, a gesture-handler FlatList, is cancelled natively).
 *
 * The Pan's callbacks are worklets: the ghost's position and the folder under
 * the finger are computed on the UI thread from shared values (the folder
 * rectangles, the list's scroll offset, the area's origin), so the card stays
 * on the finger even while JavaScript is busy. Only changes of the hovered
 * folder and the begin/end of a drag cross to JavaScript.
 *
 * Folder rows register their root view; at drag start each is measured once
 * in window coordinates, and the list's scroll delta since then shifts the
 * finger instead of re-measuring on every move. Rows that mount during an
 * edge auto-scroll are measured as they appear.
 */
export function useDragMove(opts: UseDragMoveOptions) {
  const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });

  const [armed, setArmed] = useState(false);
  const [active, setActive] = useState<DragState | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activeRef = useRef<DragState | null>(null);

  // `any`: the ref is handed to whichever FlatList<ItemT> the caller renders,
  // and FlatList's row type is invariant through its props.
  const listRef = useRef<FlatList<any>>(null);
  const areaRef = useRef<View | null>(null);
  const targets = useRef(new Map<string, View>());
  const targetRefs = useRef(new Map<string, DropTargetRef>());
  const handles = useRef(new Map<string, DragHandle>());

  // UI-thread state. `rects` are stored in the frame of the scroll offset at
  // drag start; `blocked` are the folders a drop may not land on this drag.
  const area = useSharedValue<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const rects = useSharedValue<Record<string, Rect>>({});
  const blocked = useSharedValue<string[]>([]);
  const scrollY = useSharedValue(0);
  const scrollAtMeasure = useSharedValue(0);
  const over = useSharedValue<string | null>(null);
  const finger = useSharedValue<Point>({ x: 0, y: 0 });
  const dragging = useSharedValue(false);
  const ghostX: SharedValue<number> = useSharedValue(0);
  const ghostY: SharedValue<number> = useSharedValue(0);

  const contentHeight = useRef(0);
  const listHeight = useRef(0);
  const startPoint = useRef<Point | null>(null);
  const scrollArmed = useRef(false);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  const measureTarget = useCallback((id: string, view: View, retry = true) => {
    measureInWindow(view, (x, y, w, h) => {
      // A view measured in the commit it mounted in can answer all zeros; ask
      // again a moment later rather than keep an unreachable target.
      if (w === 0 && h === 0) {
        if (retry) setTimeout(() => { if (targets.current.get(id) === view) measureTarget(id, view, false); }, 50);
        return;
      }
      rects.value = { ...rects.value, [id]: { x, y: y + (scrollY.value - scrollAtMeasure.value), w, h } };
    });
  }, [rects, scrollAtMeasure, scrollY]);

  const measureArea = useCallback(() => {
    if (areaRef.current) measureInWindow(areaRef.current, (x, y, w, h) => { area.value = { x, y, w, h }; });
  }, [area]);

  const stopTicker = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  /** Pure, so the auto-scroll can re-hit-test on the JS side after it moved the list. */
  const hitTest = useCallback((p: Point): string | null => {
    const yy = p.y + (scrollY.value - scrollAtMeasure.value);
    for (const [id, r] of Object.entries(rects.value)) {
      if (p.x >= r.x && p.x < r.x + r.w && yy >= r.y && yy < r.y + r.h) return blocked.value.includes(id) ? null : id;
    }
    return null;
  }, [blocked, rects, scrollAtMeasure, scrollY]);

  const publishOver = useCallback((id: string | null) => {
    if (id === over.value) return;
    over.value = id;
    setOverId(id);
  }, [over]);

  const tick = useCallback(() => {
    const p = finger.value;
    const s = startPoint.current;
    if (!s || !activeRef.current) return;
    const step = autoScrollStep({
      finger: p, start: s, area: area.value, armed: scrollArmed.current,
      scrollY: scrollY.value, maxScrollY: contentHeight.current - listHeight.current,
    });
    scrollArmed.current = step.armed;
    if (step.next === null) return;
    scrollY.value = step.next;
    listRef.current?.scrollToOffset({ offset: step.next, animated: false });
    publishOver(hitTest(p));
  }, [area, finger, hitTest, publishOver, scrollY]);

  const reset = useCallback(() => {
    stopTicker();
    activeRef.current = null;
    startPoint.current = null;
    scrollArmed.current = false;
    dragging.value = false;
    over.value = null;
    rects.value = {};
    blocked.value = [];
    setArmed(false);
    setActive(null);
    setOverId(null);
  }, [blocked, dragging, over, rects, stopTicker]);

  useEffect(() => stopTicker, [stopTicker]);

  // --- JS-side steps the worklets call into. Stable identities: the worklets
  // capture them once per handle. They read `latest` for the options.

  /** The hold is up: scrolling off, a tick in the hand. */
  const arm = useCallback(() => {
    setArmed(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  /** The hold ended. Without a drag in between it was a plain long press. */
  const holdEnded = useCallback((item: DragItem, success: boolean) => {
    if (activeRef.current) return;
    setArmed(false);
    if (success) latest.current.onHold(item);
  }, []);

  const begin = useCallback((item: DragItem, x: number, y: number) => {
    const { selectedFiles, selectedFolders, sourceFolderId } = latest.current;
    const st: DragState = { item, items: itemsForDrag(item, selectedFiles, selectedFolders) };
    activeRef.current = st;
    setActive(st);
    setArmed(true);
    // Folder-onto-itself and back-into-the-source are refused on the UI thread
    // by id; the pure rule still decides, here, which ids those are.
    blocked.value = [...st.items.folderIds, ...(sourceFolderId ? [sourceFolderId] : [])]
      .filter((id) => !canDropOn(st.items, id, sourceFolderId));
    scrollAtMeasure.value = scrollY.value;
    rects.value = {};
    measureArea();
    for (const [id, view] of targets.current) measureTarget(id, view);
    startPoint.current = { x, y };
    finger.value = { x, y };
    stopTicker();
    ticker.current = setInterval(tick, SCROLL_TICK_MS);
  }, [blocked, finger, measureArea, measureTarget, rects, scrollAtMeasure, scrollY, stopTicker, tick]);

  const finish = useCallback((success: boolean) => {
    const st = activeRef.current;
    const target = over.value;
    reset();
    if (success && st && target !== null) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      latest.current.onDrop(st.items, { id: target, name: latest.current.nameOfFolder(target) });
    }
  }, [over, reset]);

  const buildHandle = useCallback((item: DragItem): DragHandle => {
    const key = itemKey(item);
    const pan = Gesture.Pan()
      .withTestId(`drag-${key}`)
      .maxPointers(1)
      .activateAfterLongPress(LONG_PRESS_MS)
      .onStart((e) => {
        "worklet";
        dragging.value = true;
        finger.value = { x: e.absoluteX, y: e.absoluteY };
        ghostX.value = e.absoluteX - area.value.x;
        ghostY.value = e.absoluteY - area.value.y;
        runOnJS(begin)(item, e.absoluteX, e.absoluteY);
      })
      .onUpdate((e) => {
        "worklet";
        if (!dragging.value) return;
        const p = { x: e.absoluteX, y: e.absoluteY };
        finger.value = p;
        ghostX.value = p.x - area.value.x;
        ghostY.value = p.y - area.value.y;
        const yy = p.y + (scrollY.value - scrollAtMeasure.value);
        let hit: string | null = null;
        const all = rects.value;
        for (const id in all) {
          const r = all[id];
          if (p.x >= r.x && p.x < r.x + r.w && yy >= r.y && yy < r.y + r.h) {
            hit = blocked.value.indexOf(id) >= 0 ? null : id;
            break;
          }
        }
        if (hit !== over.value) {
          over.value = hit;
          runOnJS(setOverId)(hit);
        }
      })
      .onFinalize((_e, success) => {
        "worklet";
        if (!dragging.value) return;
        dragging.value = false;
        runOnJS(finish)(success);
      });
    const hold = Gesture.LongPress()
      .withTestId(`hold-${key}`)
      .minDuration(LONG_PRESS_MS)
      .maxDistance(HOLD_SLOP)
      .onStart(() => {
        "worklet";
        runOnJS(arm)();
      })
      .onEnd((_e, success) => {
        "worklet";
        runOnJS(holdEnded)(item, success);
      });
    return { gesture: Gesture.Simultaneous(hold, pan), key };
  }, [arm, area, begin, blocked, dragging, finger, finish, ghostX, ghostY, holdEnded, over, rects, scrollAtMeasure, scrollY]);

  const { enabled, canDrag } = opts;
  const handle = useCallback((item: DragItem): DragHandle | undefined => {
    if (!enabled || !canDrag(item)) return undefined;
    const key = itemKey(item);
    let h = handles.current.get(key);
    if (!h) {
      h = buildHandle(item);
      handles.current.set(key, h);
    }
    return h;
  }, [enabled, canDrag, buildHandle]);

  const targetRef = useCallback((id: string): DropTargetRef => {
    let fn = targetRefs.current.get(id);
    if (!fn) {
      fn = (view) => {
        if (view) {
          targets.current.set(id, view);
          if (activeRef.current) measureTarget(id, view);
        } else {
          targets.current.delete(id);
          if (id in rects.value) {
            const next = { ...rects.value };
            delete next[id];
            rects.value = next;
          }
        }
      };
      targetRefs.current.set(id, fn);
    }
    return fn;
  }, [measureTarget, rects]);

  // A new FlatList instance (the list/grid toggle keys it) starts at offset 0
  // and sends no scroll event for that, so the offset is reset with it.
  const setList = useCallback((inst: FlatList<any> | null) => {
    if (inst !== listRef.current) {
      listRef.current = inst;
      scrollY.value = 0;
    }
  }, [scrollY]);

  const areaProps = useMemo(() => ({
    ref: (view: View | null) => { areaRef.current = view; },
    collapsable: false,
    onLayout: measureArea,
  }), [measureArea]);

  const listProps = useMemo(() => ({
    ref: setList,
    scrollEnabled: !armed,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { scrollY.value = e.nativeEvent.contentOffset.y; },
    onContentSizeChange: (_w: number, h: number) => { contentHeight.current = h; },
    onLayout: (e: LayoutChangeEvent) => { listHeight.current = e.nativeEvent.layout.height; },
  }), [armed, scrollY, setList]);

  return { handle, targetRef, areaProps, listProps, armed, active, overId, ghostX, ghostY };
}
