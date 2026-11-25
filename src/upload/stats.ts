import type { UploadItem } from "./types";

export interface UploadStats {
  totalCount: number;
  doneCount: number;
  uploadingCount: number;
  activeCount: number; // uploading + queued
  erroredCount: number;
  totalBytes: number;
  uploadedBytes: number;
  remainingBytes: number;
  pct: number; // 0..100 by bytes
  bytesPerSec: number;
  etaSec: number | null;
}

/**
 * Aggregate upload stats over the current batch (all not-yet-cleared items).
 * Speed = uploadedBytes / elapsedSinceStart (cumulative average - same as the
 * desktop sync engine, no EMA); ETA = remainingBytes / speed.
 */
export function computeUploadStats(
  items: UploadItem[],
  startedAt: number | null,
  now: number,
  // Baseline for backup items folded out of the live array mid-run
  // (useUploadStore.settledBk) - they still count as done work for
  // totals, progress, and the cumulative-average speed.
  settled: { count: number; bytes: number } = { count: 0, bytes: 0 },
): UploadStats {
  let totalBytes = settled.bytes;
  let uploadedBytes = settled.bytes;
  let doneCount = settled.count;
  let uploadingCount = 0;
  let queuedCount = 0;
  let erroredCount = 0;
  for (const i of items) {
    const size = i.size > 0 ? i.size : 0;
    totalBytes += size;
    switch (i.status) {
      case "done":
        uploadedBytes += size;
        doneCount++;
        break;
      case "uploading":
        uploadedBytes += size * Math.min(1, Math.max(0, i.progress || 0));
        uploadingCount++;
        break;
      case "queued":
        queuedCount++;
        break;
      case "error":
        erroredCount++;
        break;
    }
  }
  const remainingBytes = Math.max(0, totalBytes - uploadedBytes);
  const pct = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
  const elapsedSec = startedAt != null ? Math.max(0.001, (now - startedAt) / 1000) : 0;
  const bytesPerSec = elapsedSec > 0 ? uploadedBytes / elapsedSec : 0;
  const etaSec = bytesPerSec > 0 && remainingBytes > 0 ? remainingBytes / bytesPerSec : null;
  return {
    totalCount: items.length + settled.count,
    doneCount,
    uploadingCount,
    activeCount: uploadingCount + queuedCount,
    erroredCount,
    totalBytes,
    uploadedBytes,
    remainingBytes,
    pct,
    bytesPerSec,
    etaSec,
  };
}
