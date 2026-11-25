/**
 * The workspace's upload rules, fetched once and memoised briefly.
 *
 * Mobile's half of what apps/web/src/lib/upload-limits.ts and
 * apps/desktop/src/renderer/lib/upload-limits.ts do. Only the transport differs
 * between the three - the rules themselves come from the generated policy copy,
 * which is byte-identical to packages/shared/src/validation/policy.ts and to
 * what the server runs.
 */
import { apiRequest } from "@/api/client";
import {
  checkUploadFile, checkBatchFitsQuota, summariseRejections as summariseRejectionsEnglish,
  type UploadLimits,
} from "@/lib/validationPolicy.generated";
import { translateExternal } from "@/lib/external-text";
import { t } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

/**
 * The generated sentence for a pile of rejections, in the chosen language. Each
 * reason is translated first (they are policy messages); the one-file line is
 * composed here from the catalog; a single reason over several files is the
 * generated "reason (N files)" matched against its catalog entry; several
 * reasons are composed from the catalog's "top reason, and N other reasons".
 */
export function summariseRejections(rejected: { name: string; reason: string }[]): string {
  const translated = rejected.map((r) => ({ name: r.name, reason: translateExternal(r.reason) }));
  if (translated.length === 1) {
    return t("backup.error.nameReason", { name: translated[0]!.name, reason: translated[0]!.reason });
  }
  const byReason = new Map<string, number>();
  for (const r of translated) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
  if (byReason.size > 1) {
    const [top, topCount] = [...byReason.entries()].sort((x, y) => y[1] - x[1])[0]!;
    return t("common.error.topreasonTopcountFilesAndOthersPluralOneOtherReasonOther", {
      topReason: top,
      topCount: localDigits(topCount),
      others: byReason.size - 1,
    });
  }
  return translateExternal(summariseRejectionsEnglish(translated));
}

/** Matches the server's own KV TTL for these figures. */
const TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: UploadLimits }>();
const inflight = new Map<string, Promise<UploadLimits>>();

export function clearUploadLimitsCache(): void {
  memo.clear();
  inflight.clear();
}

export async function fetchUploadLimits(workspaceId: string): Promise<UploadLimits> {
  const hit = memo.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const existing = inflight.get(workspaceId);
  if (existing) return existing;

  const req = apiRequest<UploadLimits & { ok: boolean }>(
    `/api/workspaces/${workspaceId}/upload-limits`,
  )
    .then((res) => {
      const value: UploadLimits = {
        allowed_extensions: res.allowed_extensions ?? null,
        blocked_extensions: res.blocked_extensions ?? null,
        max_file_size_gb: res.max_file_size_gb ?? null,
        storage_remaining_bytes: res.storage_remaining_bytes ?? null,
      };
      memo.set(workspaceId, { at: Date.now(), value });
      return value;
    })
    // Fail OPEN, and on mobile that matters more than anywhere: a phone on a
    // flaky connection must not lose the ability to upload because a
    // nice-to-have pre-check could not be reached.
    .catch((): UploadLimits => ({}))
    .finally(() => { inflight.delete(workspaceId); });

  inflight.set(workspaceId, req);
  return req;
}

export interface ScreenedDrafts<T> {
  accepted: T[];
  rejected: { name: string; reason: string }[];
  /** Bytes past the remaining space, or 0. A warning, never a refusal. */
  quotaOver: number;
}

export function screenDrafts<T extends { name: string; size?: number }>(
  drafts: T[],
  limits: UploadLimits,
): ScreenedDrafts<T> {
  const accepted: T[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let total = 0;

  for (const d of drafts) {
    // A picker can hand over an item whose size is not known yet. Treat that as
    // 0 rather than guessing: the extension rule still applies, and the size
    // rule is one the server measures for real anyway.
    const size = d.size ?? 0;
    const reason = checkUploadFile({ name: d.name, size }, limits);
    if (reason) { rejected.push({ name: d.name, reason }); continue; }
    accepted.push(d);
    total += size;
  }

  const fit = checkBatchFitsQuota(total, limits);
  return { accepted, rejected, quotaOver: fit.fits ? 0 : fit.over };
}
