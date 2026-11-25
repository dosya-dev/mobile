import type { CommentRow } from "./api";
import { formatDateWith } from "@/lib/format-locale";
import { t } from "@/lib/i18n";

/** Characters of a parent body quoted on a reply. */
export const QUOTE_LENGTH = 60;

/** The same author within this many seconds continues a visual run. */
export const RUN_GAP_SECONDS = 300;

export interface DaySection {
  key: string;
  label: string;
  comments: CommentRow[];
}

export interface Quote {
  author: string;
  excerpt: string;
}

function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / a written date, matching web's separators. */
export function dayLabel(ts: number, now: number): string {
  const key = dayKey(ts);
  if (key === dayKey(now)) return t("common.label.today");
  if (key === dayKey(now - 86400)) return t("comments.label.yesterday");
  // English keeps the "en-US" this call site always pinned.
  return formatDateWith(ts, { month: "long", day: "numeric", year: "numeric" }, "en-US");
}

/**
 * Runs of comments under a day heading, input order preserved.
 *
 * Grouping lives here rather than in the screen so the list never formats a date
 * mid-render, and so the boundary case - two comments minutes apart but on
 * opposite sides of midnight - has a test.
 */
export function groupByDay(comments: CommentRow[], now: number): DaySection[] {
  const out: DaySection[] = [];
  for (const c of comments) {
    const key = dayKey(c.created_at);
    const last = out[out.length - 1];
    if (last && last.key === key) last.comments.push(c);
    else out.push({ key, label: dayLabel(c.created_at, now), comments: [c] });
  }
  return out;
}

/**
 * The line a reply shows above itself.
 *
 * Null when there is no parent, and null when the parent is no longer in the
 * list: replies cascade server-side, but a client can hold an orphan between a
 * delete and a refetch, and an orphan must still render.
 */
export function quotedParent(c: CommentRow, all: CommentRow[]): Quote | null {
  if (!c.parent_id) return null;
  const parent = all.find((x) => x.id === c.parent_id);
  if (!parent) return null;
  const body = parent.body.trim();
  return {
    author: parent.user_name,
    excerpt: body.length > QUOTE_LENGTH ? `${body.slice(0, QUOTE_LENGTH)}…` : body,
  };
}

/** The API allows the author and nobody else. */
export function canEdit(c: CommentRow, userId: string | null): boolean {
  return !!userId && c.user_id === userId;
}

/**
 * The API allows the author, or a workspace owner/admin on anyone's comment.
 *
 * Compared case-insensitively: role_name comes from the roles table and the
 * server's own check is lowercase, so a stored "Owner" must not hide the control
 * from the one person allowed to use it.
 */
export function canDelete(c: CommentRow, userId: string | null, roleName: string | null): boolean {
  if (canEdit(c, userId)) return true;
  const role = (roleName ?? "").toLowerCase();
  return role === "owner" || role === "admin";
}

/** Whether this bubble prints its author header, or continues the one above. */
export function isRunStart(c: CommentRow, previous: CommentRow | undefined): boolean {
  if (!previous) return true;
  if (previous.user_id !== c.user_id) return true;
  return c.created_at - previous.created_at > RUN_GAP_SECONDS;
}
