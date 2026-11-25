import { apiRequest } from "@/api/client";
import type { RequestRow, RecipientRow } from "./status";

export type { RequestRow, RecipientRow };

export interface UploadRow {
  id: string;
  file_id: string;
  uploader_email: string | null;
  uploader_name: string | null;
  created_at: number;
  file_name: string;
  size_bytes: number;
  mime_type: string | null;
  extension: string | null;
}

export async function listRequests(workspaceId: string): Promise<RequestRow[]> {
  const qs = new URLSearchParams({ workspace_id: workspaceId });
  const res = await apiRequest<{ ok: true; requests?: RequestRow[] }>(`/api/file-requests?${qs.toString()}`);
  return res.requests ?? [];
}

/**
 * Create a request, optionally inviting people.
 *
 * RECIPIENTS GO IN `emails`, AS AN ARRAY. The endpoint reads that key and no
 * other, so a scalar `recipient_email` - which is what the desktop app has been
 * sending - creates the request and invites nobody, with no error to notice.
 *
 * Keys are omitted rather than sent as null: the endpoint reads `payload.x ||
 * null` for most fields, so absence and null agree, but "only send what was
 * asked for" is the rule that keeps PATCH honest and it costs nothing to hold
 * here too.
 */
export async function createRequest(input: {
  workspaceId: string;
  title?: string;
  message?: string;
  password?: string;
  expiresInDays?: number | null;
  maxFiles?: number | null;
  maxFileSizeMb?: number | null;
  allowedExtensions?: string;
  emails?: string[];
}): Promise<{ url: string }> {
  const body: Record<string, unknown> = { workspace_id: input.workspaceId };
  if (input.title) body.title = input.title;
  if (input.message) body.message = input.message;
  if (input.password) body.password = input.password;
  if (input.expiresInDays != null) body.expires_in_days = input.expiresInDays;
  if (input.maxFiles != null) body.max_files = input.maxFiles;
  if (input.maxFileSizeMb != null) body.max_file_size_mb = input.maxFileSizeMb;
  if (input.allowedExtensions) body.allowed_extensions = input.allowedExtensions;
  if (input.emails?.length) body.emails = input.emails;

  const res = await apiRequest<{ ok: true; url?: string; request?: { url?: string } }>(
    "/api/file-requests/create",
    { method: "POST", body },
  );
  // The endpoint has been seen answering with both shapes.
  return { url: res.url ?? res.request?.url ?? "" };
}

/** Only the keys given are written. `password: ""` removes it; `expires_in_days: 0` clears the expiry. */
export async function patchRequest(id: string, patch: Record<string, unknown>): Promise<void> {
  await apiRequest(`/api/file-requests/${id}`, { method: "PATCH", body: patch });
}

/**
 * Close a request.
 *
 * DELETE is the verb, but the server sets `is_revoked = 1` and keeps the row -
 * hence the name. Calling this "delete" in UI copy makes the request's continued
 * presence in the list look like a bug.
 */
export async function revokeRequest(id: string): Promise<void> {
  await apiRequest(`/api/file-requests/${id}`, { method: "DELETE" });
}

export async function listRecipients(id: string): Promise<RecipientRow[]> {
  const res = await apiRequest<{ ok: true; recipients?: RecipientRow[] }>(`/api/file-requests/${id}/recipients`);
  return res.recipients ?? [];
}

/** 409 when the address is already a recipient, 410 when the request is closed. */
export async function addRecipient(id: string, email: string): Promise<void> {
  await apiRequest(`/api/file-requests/${id}/recipients`, {
    method: "POST",
    body: { email: email.trim().toLowerCase() },
  });
}

export async function removeRecipient(id: string, recipientId: string): Promise<void> {
  const qs = new URLSearchParams({ recipient_id: recipientId });
  await apiRequest(`/api/file-requests/${id}/recipients?${qs.toString()}`, { method: "DELETE" });
}

export async function resendInvite(id: string, recipientId: string): Promise<void> {
  await apiRequest(`/api/file-requests/${id}/resend`, {
    method: "POST",
    body: { recipient_id: recipientId },
  });
}

export async function listUploads(id: string): Promise<{ request: RequestRow | null; uploads: UploadRow[] }> {
  const res = await apiRequest<{ ok: true; request?: RequestRow; uploads?: UploadRow[] }>(
    `/api/file-requests/${id}/uploads`,
  );
  return { request: res.request ?? null, uploads: res.uploads ?? [] };
}
