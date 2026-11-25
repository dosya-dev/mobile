import * as FileSystem from "expo-file-system/legacy";
import { apiRequest, API_BASE_URL } from "@/api";
import { getAccessToken } from "@/auth/authStore";
import type { UploadItem } from "@/upload/types";
import { sourceTimeHeaders } from "@/upload/sourceTime";
import { UploadHttpError } from "@/upload/uploadError";
import { t } from "@/lib/i18n";

const B64 = FileSystem.EncodingType.Base64;

export interface PartPlan {
  partNumber: number; // 1-indexed (server requires >= 1)
  position: number;
  length: number;
}

export function planParts(fileSize: number, partSize: number): PartPlan[] {
  const parts: PartPlan[] = [];
  let n = 1;
  for (let pos = 0; pos < fileSize; pos += partSize) {
    parts.push({ partNumber: n, position: pos, length: Math.min(partSize, fileSize - pos) });
    n += 1;
  }
  return parts;
}

export function remainingParts(plan: PartPlan[], uploadedPartNumbers: number[]): PartPlan[] {
  const done = new Set(uploadedPartNumbers);
  return plan.filter((p) => !done.has(p.partNumber));
}

interface ResumableInit {
  ok: true;
  session_id: string;
  upload_url: string;
  resumable: {
    part_size: number;
    total_parts: number;
    part_upload_url: string;
    complete_url: string;
    status_url: string;
  } | null;
}
interface StatusResponse { ok: true; uploaded_parts: number[]; total_parts: number | null }
interface CompleteResponse { ok: true; file: { id: string } }

// A durable, JSON-serializable snapshot of the server-side multipart session.
// Persisted in the ledger (backup_assets.mp_session) so a killed/failed
// upload can resume against the SAME session on the next run instead of
// calling /api/upload/init again (which would orphan the prior session
// server-side and restart the part count from zero).
export interface ResumableSession {
  sessionId?: string;
  partSize: number;
  partUploadUrl: string;
  statusUrl: string;
  completeUrl: string;
}

export async function uploadResumable(
  item: UploadItem,
  workspaceId: string,
  onProgress: (p: number) => void,
  opts?: { savedSession?: ResumableSession | null; onSession?: (s: ResumableSession) => Promise<void> },
): Promise<string> {
  let session: ResumableSession;
  if (opts?.savedSession) {
    // Reusing a session persisted from a prior (killed/failed) run - skip
    // init entirely so we don't spawn a second server-side session.
    session = opts.savedSession;
  } else {
    const init = await apiRequest<ResumableInit>("/api/upload/init", {
      method: "POST",
      body: { workspace_id: workspaceId, file_name: item.name, file_size: item.size, mime_type: item.mime, folder_id: item.folderId },
    });
    if (!init.resumable) {
      throw new Error(t("common.error.serverDidNotReturnAResumableSessionForALargeFile"));
    }
    session = {
      sessionId: init.session_id,
      partSize: init.resumable.part_size,
      partUploadUrl: init.resumable.part_upload_url,
      statusUrl: init.resumable.status_url,
      completeUrl: init.resumable.complete_url,
    };
    // Persist BEFORE uploading any part so a crash mid-upload still has a
    // saved session to resume against on the next run.
    await opts?.onSession?.(session);
  }

  const { partSize, partUploadUrl, statusUrl, completeUrl } = session;
  const plan = planParts(item.size, partSize);

  // Resume: skip parts already stored server-side (idempotent parts also make
  // re-PUT safe, but skipping saves the bytes).
  let uploaded: number[] = [];
  try {
    const status = await apiRequest<StatusResponse>(statusUrl, { method: "GET" });
    uploaded = status.uploaded_parts ?? [];
  } catch {
    // Fresh session - no parts yet.
  }

  const token = getAccessToken();
  const remaining = remainingParts(plan, uploaded);
  let sent = uploaded.length;
  // Backup ids embed the iOS Photos id ("<UUID>/L0/001"). Its slashes would
  // put the part file in directories that do not exist and fail the write, so
  // the id is flattened the same way runner.ts names its cache copy.
  const tmpKey = item.id.replace(/[^a-zA-Z0-9]/g, "_");

  for (const part of remaining) {
    const b64 = await FileSystem.readAsStringAsync(item.uri, { encoding: B64, position: part.position, length: part.length });
    const tmp = `${FileSystem.cacheDirectory}bk_part_${tmpKey}_${part.partNumber}`;
    await FileSystem.writeAsStringAsync(tmp, b64, { encoding: B64 });
    try {
      const res = await FileSystem.uploadAsync(`${API_BASE_URL}${partUploadUrl}/${part.partNumber}`, tmp, {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          "Content-Type": "application/octet-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res || res.status >= 400) {
        // Carries the status so the controller's transient rule (a 5xx on one
        // part of a 13-part video is retried instead of failing the whole file
        // permanently) does not depend on the wording, which is translated.
        throw new UploadHttpError(
          t("common.error.partPartNumberUploadFailedStatus", { partNumber: String(part.partNumber), status: String(res?.status ?? "?") }),
          res?.status ?? null,
        );
      }
    } finally {
      await FileSystem.deleteAsync(tmp, { idempotent: true });
    }
    sent += 1;
    onProgress(sent / plan.length);
  }

  const done = await apiRequest<CompleteResponse>(completeUrl, {
    method: "POST",
    headers: sourceTimeHeaders(item),
  });
  return done.file?.id ?? "";
}
