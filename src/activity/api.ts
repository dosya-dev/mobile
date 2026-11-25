import { apiRequest } from "@/api/client";

/** Everything the endpoint knows about a row. Forensic fields arrive null for
 * a non-privileged viewer looking at someone else's row - the API scrubs them
 * server-side (see gateActivityRow), so the UI simply omits what is missing
 * rather than deciding who may see what. */
export interface ActivityRow {
  id: string;
  action: string;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  /** The item's name as the audit row recorded it. Stripped for items this
   * viewer cannot open, so it can be null on a row that has one. */
  resource_name: string | null;
  /** Legacy alias the feed also renders; older rows carry only this one. */
  entity_name: string | null;
  meta: Record<string, unknown> | null;
  outcome: string | null;
  source: string | null;
  source_ip: string | null;
  user_agent: string | null;
  session_id: string | null;
  on_behalf_of: string | null;
  obo_name: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  created_at: number;
}

/** A workspace member, for the "who" filter. */
export interface ActivityMember {
  id: string;
  name: string | null;
  email: string | null;
}

/** What the user has narrowed the feed to. Empty sets mean "everything". */
export interface ActivityFilters {
  categories: string[];
  actions: string[];
  userIds: string[];
}

export const NO_FILTERS: ActivityFilters = { categories: [], actions: [], userIds: [] };

export function hasAnyFilter(f: ActivityFilters): boolean {
  return f.categories.length > 0 || f.actions.length > 0 || f.userIds.length > 0;
}

export interface ActivityPage {
  activities: ActivityRow[];
  /** Workspace members, for the filter. The endpoint repeats them on every
   * page; only the first page's copy is worth keeping. */
  members: ActivityMember[];
  /** Rows matching the current filter, across all pages - what the header counts. */
  total: number;
  hasMore: boolean;
}

interface Raw {
  activities?: ActivityRow[];
  members?: ActivityMember[];
  pagination?: { page: number; per_page: number; total: number };
}

/**
 * One page of the workspace activity feed.
 *
 * hasMore is derived here rather than in the screen. The API reports totals, not
 * a cursor, and page arithmetic is exactly the sort of thing a screen gets subtly
 * wrong on the last page - an off-by-one shows a "Load older" button that fetches
 * nothing.
 *
 * The filters map onto the endpoint's own comma-separated `category`, `action`
 * and `user_id` parameters. An empty list is omitted entirely rather than sent
 * as an empty string: `category=` would parse to no valid categories and the
 * endpoint would quietly ignore it, which happens to be right today and would
 * stop being right the moment it validates its input.
 */
export async function listActivity(
  workspaceId: string,
  page: number,
  filters: ActivityFilters = NO_FILTERS,
): Promise<ActivityPage> {
  const qs = new URLSearchParams({ workspace_id: workspaceId, page: String(page) });
  if (filters.categories.length) qs.set("category", filters.categories.join(","));
  if (filters.actions.length) qs.set("action", filters.actions.join(","));
  // The endpoint caps user_id at 50 binds; a workspace with more members than
  // that would silently lose the tail, so stop before it has to.
  if (filters.userIds.length) qs.set("user_id", filters.userIds.slice(0, 50).join(","));
  const res = await apiRequest<{ ok: true } & Raw>(`/api/activity?${qs.toString()}`);
  const activities = res.activities ?? [];
  const p = res.pagination;
  const hasMore = p ? p.page * p.per_page < p.total : false;
  return { activities, members: res.members ?? [], total: p?.total ?? activities.length, hasMore };
}
