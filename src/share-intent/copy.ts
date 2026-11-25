import * as FileSystem from "expo-file-system/legacy";
import { makeUploadId, type UploadDraft } from "@/upload/pickers";
import { isInboxUri } from "./incoming";
import type { SharedFile } from "./types";

/**
 * Turns files handed over by Android into upload drafts, copying each one into
 * the cache first.
 *
 * The copy is the point. A content:// URI is readable only under the temporary
 * grant Android attached to the incoming intent, and that grant dies with the
 * task. The upload queue outlives it - the user's items are written to disk by
 * upload/persist.ts and re-queued on the next launch - so enqueueing the
 * original URI would yield an upload that succeeds if the user waits and fails
 * forever if they don't, with nothing in the UI to explain it. Copying converts
 * a borrowed handle into bytes we own.
 *
 * Done here, on the user's confirm, rather than natively at intent-receipt time:
 * sweepUploadCache() deletes `upload-` entries during app start-up (sparing the
 * ones the restored queue still points at), and a copy made at start-up would
 * race it.
 */
export async function toUploadDrafts(
  files: SharedFile[],
): Promise<{ drafts: UploadDraft[]; failed: string[] }> {
  const drafts: UploadDraft[] = [];
  const failed: string[] = [];

  for (const file of files) {
    const id = makeUploadId();
    // The id, not the display name, carries the uniqueness: two files shared
    // together are routinely both called "document.pdf", and the user's own
    // filename may contain "/" or characters this filesystem will not take.
    // The extension is preserved because parts of the pipeline still sniff it.
    // Prefix MUST stay "upload-" - that is what sweepUploadCache() reclaims.
    const target = `${FileSystem.cacheDirectory}upload-share-${id}${extensionOf(file.name)}`;
    try {
      await FileSystem.copyAsync({ from: file.uri, to: target });
      if (isInboxUri(file.uri)) {
        // iOS put the original in Documents/Inbox and leaves deletion to the
        // app. The cache copy is what uploads; keeping both doubles the disk
        // cost of every opened file and nothing else ever reclaims the Inbox.
        // A content:// source is never touched - that path leads into another
        // app's provider and the user's actual file.
        try {
          await FileSystem.deleteAsync(file.uri, { idempotent: true });
        } catch {
          // The copy is already ours; a stale original is a leak, not a failure.
        }
      }
      drafts.push({
        id,
        name: file.name, // what the user sees and what the server stores
        uri: target,
        size: await resolveSize(target, file.size),
        mime: file.mime,
        folderId: null, // stamped by the destination picker
        status: "queued",
        progress: 0,
      });
    } catch {
      // One unreadable file must not sink the batch - a revoked grant on one of
      // five shared photos is ordinary. The caller reports these by name so the
      // user is not told everything uploaded when it didn't.
      failed.push(file.name);
    }
  }

  return { drafts, failed };
}

function extensionOf(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1);
  // Guard against a "name" that is all extension (".gitignore"), has none, or
  // ends in something that is really part of the title ("report.final version").
  if (!name.includes(".") || !/^[A-Za-z0-9]{1,8}$/.test(ext)) return "";
  return `.${ext.toLowerCase()}`;
}

/**
 * The copy on disk is the authority. Providers are free to report SIZE as 0 or
 * omit the column, and a 0 slips past the >50MB resumable threshold in the
 * runner (so a 2GB file is attempted in one shot) and records size_bytes: 0
 * against the file on the server.
 */
async function resolveSize(uri: string, claimed: number): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && !info.isDirectory && typeof info.size === "number" && info.size > 0) {
      return info.size;
    }
  } catch {
    // Fall through to whatever the provider claimed.
  }
  return claimed > 0 ? claimed : 0;
}
