import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { formatBytes } from "@/lib/format";
import { t as translate, useT } from "@/lib/i18n";
import type { IconName } from "@/ui/Icon";
import type { FileItem, FolderItem } from "@/files/types";
import { LARGE_FOLDER_BYTES, canPin, estimateFolder, pinFile, pinFolder, unpin } from "../pins";
import { useIsPinned } from "./offlineState";

/**
 * "Make available offline" / "Remove from offline" for the Files sheets and the
 * viewer's More sheet. One row, whichever applies; none at all for an item
 * canPin refuses (restricted, or in the Vault), so a tap can never end in a
 * pin that could not fill.
 */

export interface OfflineRow {
  id: "make-available-offline" | "remove-from-offline";
  label: string;
  icon: IconName;
  onPress: () => void;
}

type Target = { kind: "file"; item: FileItem } | { kind: "folder"; item: FolderItem };

interface PendingFolder { folder: FolderItem; workspaceId: string; files: number; additionalBytes: number }

/** The large-folder question, held outside the sheet that asked it (the sheet unmounts as it closes). */
export const useOfflinePinConfirm = create<{ pending: PendingFolder | null; set(p: PendingFolder | null): void }>((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}));

function failed(): void {
  toast(translate("offline.error.weCouldnTMakeThisAvailableOffline"), "error");
}

/**
 * Pin a folder, asking first when it would add more than LARGE_FOLDER_BYTES.
 * The estimate needs the server; when it cannot be had the pin is not made,
 * rather than made blind.
 */
export async function requestPinFolder(folder: FolderItem, workspaceId: string): Promise<void> {
  let estimate: { files: number; additionalBytes: number };
  try {
    estimate = await estimateFolder(workspaceId, folder.id);
  } catch {
    failed();
    return;
  }
  if (estimate.additionalBytes > LARGE_FOLDER_BYTES) {
    useOfflinePinConfirm.getState().set({ folder, workspaceId, ...estimate });
    return;
  }
  await pinFolder(folder, workspaceId).catch(failed);
}

export function useOfflineRow(target: Target | null, workspaceId: string | null, opts: { inVault?: boolean } = {}): OfflineRow | null {
  const t = useT();
  const pinned = useIsPinned(target?.item.id ?? "");
  const kind = target?.kind ?? null;
  const item = target?.item ?? null;
  const inVault = !!opts.inVault;
  // Memoised on what decides the row, so a caller's own memo (the viewer's
  // More list) is not invalidated on every render.
  return useMemo((): OfflineRow | null => {
    if (!item || !kind) return null;
    if (pinned) {
      return {
        id: "remove-from-offline",
        label: t("offline.action.removeFromOffline"),
        icon: "close-circle-outline",
        onPress: () => { void unpin(item.id); },
      };
    }
    if (!workspaceId || !canPin(item, { inVault }).ok) return null;
    return {
      id: "make-available-offline",
      label: t("offline.action.makeAvailableOffline"),
      icon: "arrow-down-circle",
      onPress: () => {
        if (kind === "file") void pinFile(item as FileItem, workspaceId).catch(failed);
        else void requestPinFolder(item as FolderItem, workspaceId);
      },
    };
  }, [item, kind, pinned, workspaceId, inVault, t]);
}

/**
 * Which mounted OfflinePinConfirm shows the dialog. Every FileBrowser mounts
 * one, and the Files root and a folder screen are both mounted at once; two
 * native Modals for one question would stack. The most recently mounted host
 * (the screen on top) owns it, and the one below takes over when it goes.
 */
const useConfirmHosts = create<{ hosts: number[] }>(() => ({ hosts: [] }));
let nextHost = 0;

/** Mount on any screen that shows folder sheets; only one of them renders. */
export function OfflinePinConfirm() {
  const t = useT();
  const pending = useOfflinePinConfirm((s) => s.pending);
  const set = useOfflinePinConfirm((s) => s.set);
  const [me] = useState(() => (nextHost += 1));
  const owner = useConfirmHosts((s) => s.hosts[s.hosts.length - 1]);
  useEffect(() => {
    useConfirmHosts.setState((s) => ({ hosts: [...s.hosts, me] }));
    return () => useConfirmHosts.setState((s) => ({ hosts: s.hosts.filter((h) => h !== me) }));
  }, [me]);
  if (owner !== me) return null;
  return (
    <ConfirmDialog
      visible={pending !== null}
      title={t("common.heading.areYouSure")}
      message={pending
        ? t("offline.description.weLlDownloadCountFilesSizeFromFolderToThisPhone", {
          count: pending.files,
          size: formatBytes(pending.additionalBytes),
          folder: pending.folder.name,
        })
        : undefined}
      confirmLabel={t("common.action.download")}
      onCancel={() => set(null)}
      onConfirm={() => {
        if (!pending) return;
        set(null);
        void pinFolder(pending.folder, pending.workspaceId).catch(failed);
      }}
    />
  );
}
