/**
 * Inbox state, mobile's copy.
 *
 * Mirrors packages/shared/src/notifications/inbox.ts - keep the two in sync.
 * Mobile is deliberately decoupled from @dosya-dev/shared (see src/lib/format.ts),
 * so it carries its own copy rather than importing that one; the duplication is
 * covered by the tests beside this file.
 */

import { t } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

export interface InboxItem {
  id: string;
  kind: "personal" | "broadcast";
  type: string;
  category: string;
  priority: string;
  title: string;
  body: string | null;
  icon: string | null;
  /** Server-authored WEB route. Translate with mapActionPath before routing. */
  link_path: string | null;
  /** JSON string; parse with parseActions. */
  actions: string | null;
  actor_name: string | null;
  created_at: number;
  read_at: number | null;
  dismissed_at: number | null;
}

export interface NotificationAction {
  handler: "navigate" | "dismiss";
  label: string;
  params?: { path?: string };
}

export interface InboxSummary {
  unread: number;
  latest: InboxItem | null;
}

/**
 * The badge count and the list live together on purpose: they are updated in one
 * step or not at all, which is what stops the badge disagreeing with the list
 * after an optimistic update.
 */
export interface InboxState {
  items: InboxItem[];
  unread: number;
}

const KNOWN_HANDLERS = new Set(["navigate", "dismiss"]);

export function parseActions(json: string | null): NotificationAction[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) => a && typeof a.label === "string" && KNOWN_HANDLERS.has(a.handler),
    ) as NotificationAction[];
  } catch {
    return [];
  }
}

export function isUnread(item: InboxItem): boolean {
  return item.read_at == null;
}

export function relativeTime(createdAt: number, now: number): string {
  const s = Math.max(0, now - createdAt);
  if (s < 60) return t("common.label.justNow");
  if (s < 3600) return t("common.label.minutesM", { minutes: localDigits(Math.floor(s / 60)) });
  if (s < 86400) return t("common.label.hoursH", { hours: localDigits(Math.floor(s / 3600)) });
  return t("common.label.daysD", { days: localDigits(Math.floor(s / 86400)) });
}

/**
 * Reducers return the SAME object reference when nothing changed, so a double
 * tap cannot decrement `unread` twice for one item.
 */
export function applyRead(state: InboxState, id: string, now: number): InboxState {
  const target = state.items.find((i) => i.id === id);
  if (!target || !isUnread(target)) return state;
  return {
    items: state.items.map((i) => (i.id === id ? { ...i, read_at: now } : i)),
    unread: Math.max(0, state.unread - 1),
  };
}

export function applyReadAll(state: InboxState, now: number): InboxState {
  return {
    items: state.items.map((i) => (isUnread(i) ? { ...i, read_at: now } : i)),
    unread: 0,
  };
}

export function applyDismiss(state: InboxState, id: string): InboxState {
  const target = state.items.find((i) => i.id === id);
  if (!target) return state;
  return {
    items: state.items.filter((i) => i.id !== id),
    unread: isUnread(target) ? Math.max(0, state.unread - 1) : state.unread,
  };
}

/**
 * Flatten paginated responses. A row can legitimately appear on two pages when a
 * new notification lands between fetches, so dedupe by id and re-sort rather
 * than trusting page order.
 */
export function mergeInboxPages(pages: InboxItem[][]): InboxItem[] {
  const seen = new Map<string, InboxItem>();
  for (const page of pages) {
    for (const it of page) if (!seen.has(it.id)) seen.set(it.id, it);
  }
  return [...seen.values()].sort((a, b) => b.created_at - a.created_at);
}

/** Groups for a sectioned list. Local midnight, not UTC - "Today" is a claim about the viewer's calendar. */
export function groupByDay(items: InboxItem[], now: number): { label: string; items: InboxItem[] }[] {
  const midnight = new Date(now * 1000);
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = Math.floor(midnight.getTime() / 1000);
  const today: InboxItem[] = [];
  const earlier: InboxItem[] = [];
  for (const it of items) (it.created_at >= startOfToday ? today : earlier).push(it);
  const groups: { label: string; items: InboxItem[] }[] = [];
  if (today.length) groups.push({ label: t("common.label.today"), items: today });
  if (earlier.length) groups.push({ label: t("common.label.earlier"), items: earlier });
  return groups;
}
