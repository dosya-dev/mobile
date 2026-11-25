import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type StageRequest = { localId: string; kind: "original" | "pairedVideo" };
export type StagedFile = { localId: string; kind: "original" | "pairedVideo"; path: string; size: number; filename: string; mime: string };
export type StageFailure = { localId: string; kind: "original" | "pairedVideo"; reason: "unreadable" | "empty" | "nospace" | "budget" };
export type Job = { jobId: string; path: string; url: string; headers: Record<string, string> };
export type JobState = { jobId: string; state: "queued" | "running" | "done" | "failed"; bytesSent: number; bytesTotal: number; httpStatus?: number; etag?: string; error?: string };
export type JobResult = { jobId: string; ok: boolean; httpStatus?: number; etag?: string; error?: string };
export interface BackgroundUploadNative {
  stage(assets: StageRequest[]): Promise<{ staged: StagedFile[]; failed: StageFailure[] }>;
  enqueue(jobs: Job[], allowsCellular: boolean): Promise<void>;
  pending(): Promise<JobState[]>;
  drain(): Promise<JobResult[]>;
  cancel(jobIds: string[]): Promise<void>;
  stagingUsage(): Promise<{ bytes: number; files: number }>;
  removeStaged(paths: string[]): Promise<void>;
  /**
   * Deletes every staged file the caller did not name, plus any abandoned
   * `.part` export older than 24 hours. Files a persisted job still points at
   * are kept whatever `keepPaths` says.
   *
   * Optional: a JS bundle can be newer than the installed native binary (an
   * OTA update over an older build), and a missing function would throw on
   * every settle. Callers check before calling.
   */
  sweepStaging?(keepPaths: string[]): Promise<void>;
  addListener(event: "onJobFinished", fn: (r: JobResult) => void): { remove(): void };
  addListener(event: "onProgress", fn: (p: { bytesSent: number; bytesTotal: number }) => void): { remove(): void };
}

/** Staging budget: how much of the app container the queued batch may hold.
 * A staged copy is deleted the moment its job result is acknowledged. */
export const STAGING_MAX_BYTES = 500 * 1024 * 1024;
export const STAGING_MAX_FILES = 200;

/**
 * The native module, or null where it cannot exist: Android keeps the
 * in-process runner behind its foreground service, and Jest has no native
 * side. Every caller treats null as "use the in-process transport".
 */
export function backgroundUploadNative(): BackgroundUploadNative | null {
  if (Platform.OS !== "ios") return null;
  return requireOptionalNativeModule<BackgroundUploadNative>("DosyaBackgroundUpload");
}
