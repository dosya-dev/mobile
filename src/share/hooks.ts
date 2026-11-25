import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/ui/toast";
import { t } from "@/lib/i18n";
import {
  createShareLink, shareViaEmail, listMyShares, revokeShare, createFolderShareLink, shareFolderViaEmail,
  updateShare, getShareAnalytics, getFolderShareExclusions, getWorkspaceDefaultExpiryDays,
  listSharedWithMe,
  type CreateLinkOpts, type EmailOpts,
} from "./api";
import type { AnalyticsRange, ShareUpdateInput } from "./types";
import { useMe } from "@/profile/hooks";

export function useMyShares(workspaceId: string | null) {
  return useQuery({
    queryKey: ["shares", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listMyShares(workspaceId as string),
  });
}

/**
 * Private links other people sent to this address.
 *
 * Not keyed by workspace: a link can arrive from a workspace you are not a
 * member of, which is the case the sender meant to cover.
 */
export function useSharedWithMe() {
  return useQuery({ queryKey: ["shares-with-me"], queryFn: listSharedWithMe });
}

/**
 * One link's analytics at one range.
 *
 * The range is part of the key so switching 7/30/90 shows the cached answer
 * instantly on the way back, rather than re-fetching a range already seen.
 */
export function useShareAnalytics(linkId: string | null, range: AnalyticsRange) {
  return useQuery({
    queryKey: ["share-analytics", linkId, range],
    enabled: !!linkId,
    queryFn: () => getShareAnalytics(linkId as string, range),
  });
}

/**
 * What a folder link will leave behind - hidden or locked items.
 *
 * Advisory, so it never blocks the sheet: a failed read reports 0 rather than
 * an error, exactly as web treats the same call.
 */
export function useFolderShareExclusions(folderId: string | null) {
  return useQuery({
    queryKey: ["folder-share-exclusions", folderId],
    enabled: !!folderId,
    queryFn: () => getFolderShareExclusions(folderId as string).catch(() => 0),
  });
}

/**
 * The workspace's default share expiry, for pre-filling the picker.
 *
 * Also advisory: a workspace with no setting, or a failed read, both resolve to
 * null and the sheet falls back to the product default rather than blocking.
 */
export function useWorkspaceShareDefault(workspaceId: string | null) {
  return useQuery({
    queryKey: ["workspace-share-default", workspaceId],
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
    queryFn: () => getWorkspaceDefaultExpiryDays(workspaceId as string).catch(() => null),
  });
}

export function useShareMutations() {
  const qc = useQueryClient();
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : t("common.error.somethingWentWrong"), "error");

  /** Both the list and any open detail screen are stale after a write. */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shares"] });
    qc.invalidateQueries({ queryKey: ["share-analytics"] });
  };

  return {
    createLink: useMutation({ mutationFn: (v: { fileId: string; opts: CreateLinkOpts }) => createShareLink(v.fileId, v.opts), onSuccess: invalidate, onError }),
    email: useMutation({ mutationFn: (v: { fileId: string; opts: EmailOpts }) => shareViaEmail(v.fileId, v.opts), onSuccess: () => { invalidate(); toast(t("common.status.emailSent")); }, onError }),
    revoke: useMutation({ mutationFn: (linkId: string) => revokeShare(linkId), onSuccess: () => { invalidate(); toast(t("common.status.revoked")); }, onError }),
    createFolderLink: useMutation({ mutationFn: (v: { folderId: string; opts: CreateLinkOpts }) => createFolderShareLink(v.folderId, v.opts), onSuccess: invalidate, onError }),
    folderEmail: useMutation({ mutationFn: (v: { folderId: string; opts: EmailOpts }) => shareFolderViaEmail(v.folderId, v.opts), onSuccess: () => { invalidate(); toast(t("common.status.emailSent")); }, onError }),
    update: useMutation({
      mutationFn: (v: { linkId: string; input: ShareUpdateInput }) => updateShare(v.linkId, v.input),
      onSuccess: () => { invalidate(); toast(t("common.status.linkUpdated")); },
      onError,
    }),
  };
}

/**
 * True when the signed-in user is on the Free plan, so the API will clamp
 * their links to 7 days (create.ts FREE_SHARE_LINK_MAX_EXPIRY_DAYS).
 *
 * Reads the /api/me query the root layout already keeps warm
 * (useAppearanceSync), so it adds no request. Unknown - still loading, or an
 * older server with no `plan` - reads as NOT free: the server clamps either
 * way, and locking a paid user's choices would be the worse mistake.
 */
export function useIsFreePlan(): boolean {
  const { data } = useMe();
  return data?.plan?.id === "free";
}
