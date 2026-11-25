import { Alert } from "react-native";
import { router } from "expo-router";
import { toast } from "@/ui/toast";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/queryClient";
import { storeBillingAvailable } from "@/billing/revenuecat";
import type { Workspace } from "@/files/types";
import { useUploadStore } from "./store";
import { startUploads } from "./controller";
import { fetchUploadLimits, screenDrafts, summariseRejections } from "./limits";
import { discardLivePhotoTemp } from "@/backup/livePhoto";
import type { UploadDraft } from "./pickers";

/** Only the owner's plan can be upgraded to make room. Read from the cached workspace list
 * (no extra request); an unknown role counts as not-owner, so the plain toast shows. */
function ownsWorkspace(workspaceId: string): boolean {
  const list = queryClient.getQueryData<Workspace[]>(["workspaces"]);
  return list?.find((w) => w.id === workspaceId)?.role_id === "role_owner";
}

/**
 * Pick files and start uploading them.
 *
 * Lifted verbatim out of `FileBrowser`, which was its only caller while the
 * `+` lived on the file list. The orbit button is mounted in the tab bar and
 * can start an upload from any tab, so the flow had to stop being a closure
 * over one screen's state and start taking its destination as an argument.
 */
export async function startFromPicker(params: {
  picker: () => Promise<UploadDraft[]>;
  workspaceId: string | null;
  folderId: string | null;
}): Promise<void> {
  const { workspaceId, folderId } = params;
  if (!workspaceId) return;

  const picked = (await params.picker()).map((it) => ({ ...it, folderId, workspaceId }));
  if (picked.length === 0) return;

  // Screen against the workspace's rules before anything enters the dock. A
  // blocked extension used to arrive as a failed row per file, which reads as
  // the app breaking rather than as a workspace policy.
  const limits = await fetchUploadLimits(workspaceId);
  const screened = screenDrafts(picked, limits);

  // A Live Photo's twin (see pickers.ts) rides in right behind its still. The
  // twin can pass the rules entirely on its own, but it is worthless without
  // the photo it belongs to - so when the still was refused, the twin goes
  // too, and its extracted temp file is discarded right away rather than
  // waiting for the next cache sweep.
  const acceptedSet = new Set(screened.accepted);
  const orphanedTwins = new Set<(typeof picked)[number]>();
  picked.forEach((item, i) => {
    if (!item.pairedTempUri || !acceptedSet.has(item)) return;
    const still = picked[i - 1];
    if (still && !acceptedSet.has(still)) {
      orphanedTwins.add(item);
      void discardLivePhotoTemp(item.pairedTempUri);
    }
  });
  const accepted = orphanedTwins.size > 0
    ? screened.accepted.filter((item) => !orphanedTwins.has(item))
    : screened.accepted;

  if (screened.rejected.length > 0) {
    toast(summariseRejections(screened.rejected), "error");
  }
  if (accepted.length === 0) return;
  if (screened.quotaOver > 0) {
    const message = t("upload.error.thisUploadMayNotFitInTheSpaceLeftInThisWorkspace");
    if (storeBillingAvailable() && ownsWorkspace(workspaceId)) {
      Alert.alert(t("report-problem.label.diagnosticError"), message, [
        { text: t("common.close") },
        { text: t("upgrade.action.getMoreSpace"), onPress: () => router.push("/upgrade") },
      ]);
    } else {
      toast(message, "error");
    }
  }

  useUploadStore.getState().enqueue(accepted);
  startUploads();
  // No confirmation dialog here on purpose. `toast()` is Alert.alert - a native
  // modal with an OK button - so the old "Uploading 3 files…" message stopped
  // the person mid-flow to tell them something they had just asked for. The
  // orbit disc answers instead: it sweeps its transfer arc and its centre turns
  // into a percentage, and it pulses once the moment a transfer begins so the
  // start is impossible to miss. The rejection paths above keep their dialogs -
  // those report something the person did NOT ask for and has to act on.
}
