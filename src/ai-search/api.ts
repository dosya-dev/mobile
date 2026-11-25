// Client side of AI search. Ported from apps/desktop/src/renderer/lib/ai-search.ts
// (itself a port of apps/web/src/lib/ai-search.ts) - keep the three in step.
//
// GET/PUT /api/workspaces/:id/ai-search  settings + status + can_edit (PUT: owner or change_ai_search)
// GET     /api/search/content            the content search itself
//
// Content search is the expensive request (an embedding and an index scan per
// call), so its rules live here: a 429 comes back as `busy` with the server's
// Retry-After (never as an empty answer), and a workspace without AI search
// (402 / 409) comes back as `unavailable` and is not asked again for a while.
//
// Mobile differences: requests go through apiRequest, so a 401 refreshes the
// token like every other call, and there is no in-flight sharing (the search
// screen is the only caller and cancels its own superseded request).
import { apiRequest, ApiError } from "@/api";
import { normalizeSearchFile, type SearchFileRow } from "@/files/api";
import type { FileItem } from "@/files/types";

// ── Settings ───────────────────────────────────────────────

export interface AiLimits {
  vectorBudget: number;
  imagesMax: number;
  documentsMax: number;
  docChunksMax: number;
  backfillUnits: number;
  monthUnits: number;
}

export interface AiSearchSettings { enabled: boolean; index_existing: boolean; excluded_folders: string[] }

export interface AiSearchStatus {
  files_total: number; indexed: number; pending: number; partial: number; unsupported: number; capped: number;
  failed: number; images: number; documents: number; chunks: number;
  /** null = the owner's plan has no AI search. */
  limits: AiLimits | null;
  backfill_units_remaining: number; month_units_remaining: number; month_reset_at: number | null;
  estimated_finish_at: number | null; paused: boolean;
}

export interface AiSearchSettingsResponse { ok: true; settings: AiSearchSettings; status: AiSearchStatus; can_edit: boolean }

export type AiSearchPauseReason = "maintenance" | "planLimit" | "monthlyAllowance";

/**
 * Why indexing is not moving, or null when it is (or has nothing to do).
 * Platform pause first: no upgrade helps with it.
 */
export function pauseReason(status: AiSearchStatus): AiSearchPauseReason | null {
  if (status.paused) return "maintenance";
  const l = status.limits;
  if (!l) return null;
  if (status.capped > 0 || (l.imagesMax > 0 && status.images >= l.imagesMax) || (l.documentsMax > 0 && status.documents >= l.documentsMax)) return "planLimit";
  if (status.pending > 0 && status.backfill_units_remaining <= 0 && status.month_units_remaining <= 0) {
    return l.monthUnits > 0 ? "monthlyAllowance" : "planLimit";
  }
  return null;
}

function isSettingsResponse(v: unknown): v is AiSearchSettingsResponse {
  const r = v as Partial<AiSearchSettingsResponse> | null;
  return !!r && typeof r === "object" && !!r.settings && typeof r.settings.enabled === "boolean" && !!r.status && typeof r.status === "object";
}

export const aiSearchKey = (wsId: string | null | undefined) => ["ai-search", wsId] as const;

/** GET /api/workspaces/:id/ai-search; null when the answer is not the expected shape. */
export async function fetchWorkspaceAiSearch(wsId: string): Promise<AiSearchSettingsResponse | null> {
  const res = await apiRequest<unknown>(`/api/workspaces/${wsId}/ai-search`);
  if (!isSettingsResponse(res)) return null;
  return { ...res, settings: { ...res.settings, excluded_folders: res.settings.excluded_folders ?? [] }, can_edit: res.can_edit === true };
}

/**
 * PUT /api/workspaces/:id/ai-search. Throws ApiError on refusal; its message
 * is the server's code (ai_search_not_in_plan, ai_search_needs_object_home,
 * ai_search_unavailable_for_vault, rate_limited, ...).
 */
export async function updateWorkspaceAiSearch(wsId: string, patch: Partial<AiSearchSettings>): Promise<AiSearchSettings | null> {
  const res = await apiRequest<{ ok?: boolean; settings?: AiSearchSettings }>(`/api/workspaces/${wsId}/ai-search`, { method: "PUT", body: patch });
  return res?.settings ?? null;
}

/** A folder of /api/folders/tree, for the excluded-folder names and picker. */
export interface TreeFolder { id: string; name: string; parent_id: string | null }

export async function fetchFolderTree(wsId: string): Promise<TreeFolder[]> {
  const res = await apiRequest<{ ok: true; folders?: TreeFolder[] }>(`/api/folders/tree?workspace_id=${encodeURIComponent(wsId)}`);
  return res.folders ?? [];
}

/**
 * The tree flattened depth first, siblings by name, each with its depth -
 * the order a picker lists it in. A folder whose parent is missing from the
 * answer is treated as top level rather than dropped.
 */
export function flattenTree(folders: TreeFolder[]): { folder: TreeFolder; depth: number }[] {
  const ids = new Set(folders.map((f) => f.id));
  const children = new Map<string | null, TreeFolder[]>();
  for (const f of folders) {
    const parent = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null;
    const list = children.get(parent);
    if (list) list.push(f);
    else children.set(parent, [f]);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out: { folder: TreeFolder; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ folder: f, depth });
      visit(f.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** Map an update refusal to the message the user sees, or null for the generic one. */
export type UpdateErrorKind = "notInPlan" | "notForWorkspace" | "rateLimited" | null;
export function updateErrorKind(err: unknown): UpdateErrorKind {
  const code = err instanceof ApiError ? err.code ?? err.message : null;
  if (code === "ai_search_not_in_plan") return "notInPlan";
  if (code === "ai_search_needs_object_home" || code === "ai_search_unavailable_for_vault") return "notForWorkspace";
  if (code === "rate_limited" || (err instanceof ApiError && err.status === 429)) return "rateLimited";
  return null;
}

// ── Content search ─────────────────────────────────────────

/** The name-search file row plus what the content index adds. */
export type ContentHit = FileItem & {
  score: number; snippet: string; page: number | null; source: "vector" | "keyword" | "both";
};

export type ContentSearchResult =
  | { kind: "ok"; files: ContentHit[]; partial: boolean }
  /** 429: the limiter or the index admission said no. Retry after `retryAfterS`. */
  | { kind: "busy"; retryAfterS: number }
  /** 402 / 409: no AI search in this workspace. Hide content results silently. */
  | { kind: "unavailable" }
  /** Anything else (network, 5xx, cancelled). Also hidden: never shown as "no matches". */
  | { kind: "error" };

export interface ContentSearchOptions {
  signal?: AbortSignal;
}

export const CONTENT_DEBOUNCE_MS = 400;
/** How long a workspace without AI search is not asked again. */
export const UNAVAILABLE_TTL_MS = 5 * 60_000;
/** Longest wait honoured before the one retry after a 429. */
export const MAX_RETRY_WAIT_S = 10;

const unavailableUntil = new Map<string, number>();

/** Forget a cached "no AI search here", e.g. after the owner switches it on. */
export function forgetContentAvailability(wsId: string): void { unavailableUntil.delete(wsId); }

/** Test seam: drop every cached answer. */
export function resetContentSearchState(): void { unavailableUntil.clear(); }

type RawHit = SearchFileRow & { score: number; snippet?: string | null; page?: number | null; source: ContentHit["source"] };

export async function searchContent(wsId: string, q: string, opts: ContentSearchOptions = {}): Promise<ContentSearchResult> {
  const until = unavailableUntil.get(wsId);
  if (until !== undefined) {
    if (Date.now() < until) return { kind: "unavailable" };
    unavailableUntil.delete(wsId);
  }
  const qs = new URLSearchParams({ workspace_id: wsId, q });
  try {
    const res = await apiRequest<{ ok: true; files?: RawHit[]; partial?: boolean }>(`/api/search/content?${qs.toString()}`, { signal: opts.signal });
    if (!Array.isArray(res.files)) return { kind: "error" };
    const files = res.files.map((f) => ({ ...normalizeSearchFile(f), snippet: f.snippet ?? "", page: f.page ?? null }));
    return { kind: "ok", files, partial: !!res.partial };
  } catch (err) {
    if (!(err instanceof ApiError)) return { kind: "error" };
    if (err.status === 429) return { kind: "busy", retryAfterS: err.retryAfterS ?? 1 };
    if (err.status === 402 || err.status === 409) {
      unavailableUntil.set(wsId, Date.now() + UNAVAILABLE_TTL_MS);
      return { kind: "unavailable" };
    }
    return { kind: "error" };
  }
}

/**
 * searchContent with the UI's 429 rule: on `busy`, tell the caller (so it can
 * show "busy, retrying"), wait the server's Retry-After (capped), try once
 * more. A second `busy` is returned as is. A cancelled wait resolves `error`.
 */
export async function searchContentWithRetry(
  wsId: string, q: string, opts: ContentSearchOptions & { onBusy?: (retryAfterS: number) => void } = {},
): Promise<ContentSearchResult> {
  const first = await searchContent(wsId, q, opts);
  if (first.kind !== "busy") return first;
  opts.onBusy?.(first.retryAfterS);
  const waited = await new Promise<boolean>((resolve) => {
    if (opts.signal?.aborted) { resolve(false); return; }
    const timer = setTimeout(() => { opts.signal?.removeEventListener("abort", onAbort); resolve(true); }, Math.min(first.retryAfterS, MAX_RETRY_WAIT_S) * 1000);
    const onAbort = () => { clearTimeout(timer); resolve(false); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
  if (!waited) return { kind: "error" };
  return searchContent(wsId, q, opts);
}

/** The indexer decides "image" by MIME type; the name's extension is the fallback. */
export function isImageHit(f: Pick<ContentHit, "mime_type" | "name">): boolean {
  return (f.mime_type ?? "").startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/i.test(f.name);
}
