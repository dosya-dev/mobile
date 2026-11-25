import { apiRequest, ApiError } from "@/api";

/** Cap shared with the API: `POST /api/upload/init-batch` and
 * `POST /api/upload/complete-direct` both refuse more than this many entries
 * in one call. `initBatch` slices to it; `completeDirect` chunks by it. */
export const BATCH_MAX = 200;

export interface InitBatchEntry {
  client_ref: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  folder_id: string | null;
}

export interface InitBatchUpload {
  client_ref: string;
  session_id: string;
  url: string;
  headers: Record<string, string>;
  expires_at: number;
}

export interface InitBatchRefusal {
  client_ref: string;
  error: string;
  code?: string;
}

export interface CompleteEntry {
  session_id: string;
  fingerprint?: string | null;
  source_created_at?: number;
  source_modified_at?: number;
}

export interface CompleteResult {
  session_id: string;
  file_id: string;
  version: number;
  size_bytes: number;
}

export interface CompleteRefusal {
  session_id: string;
  code: string;
  error: string;
}

/** Thrown when the API refuses a batch with `code: "direct_unavailable"` -
 * an EU-bucket workspace, where direct-to-storage upload cannot work. The
 * transport catches this specifically and falls back to the in-process
 * runner rather than treating it as a generic failure. */
export class DirectUnavailableError extends Error {
  constructor() {
    super("Direct upload is not available for this workspace");
    this.name = "DirectUnavailableError";
  }
}

/**
 * A 404 counts as direct-unavailable too: the route simply is not there. That
 * is what an app whose API has not caught up with it sees (a TestFlight build
 * against an older deployment, a rollback), and without this the transport
 * treated it as a per-asset failure and burned an attempt on every photo in
 * the library against an endpoint that could never answer.
 */
function isDirectUnavailable(e: unknown): boolean {
  return e instanceof ApiError && (e.code === "direct_unavailable" || e.status === 404);
}

/**
 * The API could not answer at all, as opposed to answering "no": a 5xx, or no
 * response (the client raises `ApiError(..., 0)` for a network failure).
 *
 * Told apart from a refusal because the transport counts these: a handful in a
 * row means the direct path is not working right now, whatever the reason, and
 * the in-process uploader is a better answer than staging a batch per run that
 * can never be handed over.
 */
export function isInitBatchOutage(e: unknown): boolean {
  if (e instanceof DirectUnavailableError) return false;
  if (e instanceof ApiError) return e.status >= 500 || e.status === 0;
  // Anything that is not an ApiError never reached the request layer.
  return true;
}

export async function initBatch(
  workspaceId: string,
  files: InitBatchEntry[],
): Promise<{ uploads: InitBatchUpload[]; refused: InitBatchRefusal[] }> {
  try {
    const res = await apiRequest<{ ok: true; uploads: InitBatchUpload[]; refused: InitBatchRefusal[] }>(
      "/api/upload/init-batch",
      { method: "POST", body: { workspace_id: workspaceId, files: files.slice(0, BATCH_MAX) } },
    );
    return { uploads: res.uploads ?? [], refused: res.refused ?? [] };
  } catch (e) {
    if (isDirectUnavailable(e)) throw new DirectUnavailableError();
    throw e;
  }
}

export async function completeDirect(
  entries: CompleteEntry[],
): Promise<{ completed: CompleteResult[]; refused: CompleteRefusal[] }> {
  const completed: CompleteResult[] = [];
  const refused: CompleteRefusal[] = [];
  for (let i = 0; i < entries.length; i += BATCH_MAX) {
    const res = await apiRequest<{ ok: true; completed: CompleteResult[]; refused: CompleteRefusal[] }>(
      "/api/upload/complete-direct",
      { method: "POST", body: { sessions: entries.slice(i, i + BATCH_MAX) } },
    );
    completed.push(...(res.completed ?? []));
    refused.push(...(res.refused ?? []));
  }
  return { completed, refused };
}
