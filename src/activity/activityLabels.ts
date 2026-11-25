import type { MessageKey } from "@/i18n/keys";
import { t as moduleT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";

/**
 * The activity vocabulary in the chosen language.
 *
 * catalog.generated.ts is a byte-identical copy shared with web and the API, so
 * it cannot call t(); it keeps the English phrases. These tables hold catalog
 * KEYS (never text), and the text is produced at call time with the current
 * language. A code with no key here is one the API grew after this app shipped:
 * callers show the server's own code as sent.
 */

/** Action code -> the full-sentence message ("{actor} uploaded{ {subject}}"). */
const SENTENCE_KEYS: Record<string, MessageKey> = {
  file_uploaded: "activity.message.actorUploadedHasSubjectSelectTrueSubjectOther",
  file_version_uploaded: "activity.message.actorUploadedANewVersionOfHasSubjectSelectTrueSubjectOther",
  file_downloaded: "activity.message.actorDownloadedHasSubjectSelectTrueSubjectOther",
  file_deleted: "activity.message.actorDeletedHasSubjectSelectTrueSubjectOther",
  file_permanently_deleted: "activity.message.actorPermanentlyDeletedHasSubjectSelectTrueSubjectOther",
  file_restored: "activity.message.actorRestoredHasSubjectSelectTrueSubjectOther",
  file_renamed: "activity.message.actorRenamedHasSubjectSelectTrueSubjectOther",
  file_moved: "activity.message.actorMovedHasSubjectSelectTrueSubjectOther",
  file_copied: "activity.message.actorCopiedHasSubjectSelectTrueSubjectOther",
  file_locked: "activity.message.actorLockedHasSubjectSelectTrueSubjectOther",
  file_hidden: "activity.message.actorChangedVisibilityOfHasSubjectSelectTrueSubjectOther",
  folder_created: "activity.message.actorCreatedFolderHasSubjectSelectTrueSubjectOther",
  folder_renamed: "activity.message.actorRenamedFolderHasSubjectSelectTrueSubjectOther",
  folder_moved: "activity.message.actorMovedFolderHasSubjectSelectTrueSubjectOther",
  folder_deleted: "activity.message.actorDeletedFolderHasSubjectSelectTrueSubjectOther",
  file_shared: "activity.message.actorSharedHasSubjectSelectTrueSubjectOther",
  file_shared_email: "activity.message.actorSharedViaEmailHasSubjectSelectTrueSubjectOther",
  folder_shared: "activity.message.actorSharedFolderHasSubjectSelectTrueSubjectOther",
  link_revoked: "activity.message.actorRevokedLinkForHasSubjectSelectTrueSubjectOther",
  file_request_created: "activity.message.actorCreatedFileRequestHasSubjectSelectTrueSubjectOther",
  file_request_uploaded: "activity.message.actorUploadedToRequestHasSubjectSelectTrueSubjectOther",
  file_request_revoked: "activity.message.actorRevokedFileRequestHasSubjectSelectTrueSubjectOther",
  member_invited: "activity.message.actorInvitedHasSubjectSelectTrueSubjectOther",
  member_joined: "activity.message.actorJoinedHasSubjectSelectTrueSubjectOther",
  member_removed: "activity.message.actorRemovedHasSubjectSelectTrueSubjectOther",
  member_left: "activity.message.actorLeftTheWorkspaceHasSubjectSelectTrueSubjectOther",
  invite_revoked: "activity.message.actorRevokedInviteForHasSubjectSelectTrueSubjectOther",
  ownership_transferred: "activity.message.actorTransferredOwnershipToHasSubjectSelectTrueSubjectOther",
  member_anchor_updated: "activity.message.actorChangedTheFolderAccessOfHasSubjectSelectTrueSubjectOther",
  member_role_changed: "activity.message.actorChangedTheRoleOfHasSubjectSelectTrueSubjectOther",
  workspace_created: "activity.message.actorCreatedWorkspaceHasSubjectSelectTrueSubjectOther",
  workspace_updated: "activity.message.actorUpdatedWorkspaceHasSubjectSelectTrueSubjectOther",
  workspace_settings_changed: "activity.message.actorChangedSettingsHasSubjectSelectTrueSubjectOther",
  settings_updated: "activity.message.actorUpdatedSettingsHasSubjectSelectTrueSubjectOther",
  role_updated: "activity.message.actorUpdatedRoleHasSubjectSelectTrueSubjectOther",
  role_deleted: "activity.message.actorDeletedRoleHasSubjectSelectTrueSubjectOther",
  role_changed: "activity.message.actorChangedRoleOfHasSubjectSelectTrueSubjectOther",
  comment_added: "activity.message.actorCommentedOnHasSubjectSelectTrueSubjectOther",
  comment_deleted: "activity.message.actorDeletedCommentOnHasSubjectSelectTrueSubjectOther",
  file_unlocked: "activity.message.actorUnlockedHasSubjectSelectTrueSubjectOther",
  folder_unlocked: "activity.message.actorUnlockedFolderHasSubjectSelectTrueSubjectOther",
  folder_locked: "activity.message.actorLockedFolderHasSubjectSelectTrueSubjectOther",
  file_unhidden: "activity.message.actorChangedVisibilityOfHasSubjectSelectTrueSubjectOther",
  folder_hidden: "activity.message.actorChangedVisibilityOfFolderHasSubjectSelectTrueSubjectOther",
  folder_unhidden: "activity.message.actorChangedVisibilityOfFolderHasSubjectSelectTrueSubjectOther",
  files_batch_deleted: "activity.message.actorDeletedMultipleFilesHasSubjectSelectTrueSubjectOther",
  share_link_unlocked: "activity.message.actorUnlockedShareLinkHasSubjectSelectTrueSubjectOther",
  comment_edited: "activity.message.actorEditedCommentOnHasSubjectSelectTrueSubjectOther",
  role_created: "activity.message.actorCreatedRoleHasSubjectSelectTrueSubjectOther",
  favourite_added: "activity.message.actorFavouritedHasSubjectSelectTrueSubjectOther",
  favourite_removed: "activity.message.actorUnfavouritedHasSubjectSelectTrueSubjectOther",
  group_created: "activity.message.actorCreatedGroupHasSubjectSelectTrueSubjectOther",
  group_updated: "activity.message.actorUpdatedGroupHasSubjectSelectTrueSubjectOther",
  group_deleted: "activity.message.actorDeletedGroupHasSubjectSelectTrueSubjectOther",
  group_item_added: "activity.message.actorAddedToGroupHasSubjectSelectTrueSubjectOther",
  group_item_removed: "activity.message.actorRemovedFromGroupHasSubjectSelectTrueSubjectOther",
  dmca_reported: "activity.message.actorReportedDMCAHasSubjectSelectTrueSubjectOther",
  sync_session_started: "activity.message.actorStartedASyncHasSubjectSelectTrueSubjectOther",
  sync_session_completed: "activity.message.actorCompletedASyncHasSubjectSelectTrueSubjectOther",
  sync_session_failed: "activity.message.actorSyncFailedHasSubjectSelectTrueSubjectOther",
  profile_updated: "activity.message.actorUpdatedProfileHasSubjectSelectTrueSubjectOther",
  plan_changed: "activity.message.actorChangedPlanHasSubjectSelectTrueSubjectOther",
  gumroad_license_redeemed: "activity.message.actorRedeemedAGumroadPackageHasSubjectSelectTrueSubjectOther",
  voucher_redeemed: "activity.message.actorRedeemedACouponCodeHasSubjectSelectTrueSubjectOther",
};

/** Category or action value -> the filter chip's label. */
const OPTION_KEYS: Record<string, MessageKey> = {
  files: "activity.option.files",
  folders: "activity.option.folders",
  sharing: "activity.option.sharing",
  members: "activity.option.members",
  workspace: "activity.option.workspace",
  comments: "activity.option.comments",
  file_uploaded: "activity.option.fileUploaded",
  file_version_uploaded: "activity.option.versionUploaded",
  file_downloaded: "activity.option.fileDownloaded",
  file_deleted: "activity.option.fileDeleted",
  file_permanently_deleted: "activity.option.permanentlyDeleted",
  file_restored: "activity.option.fileRestored",
  file_renamed: "activity.option.fileRenamed",
  file_moved: "activity.option.fileMoved",
  file_copied: "activity.option.fileCopied",
  file_locked: "activity.option.fileLocked",
  file_hidden: "activity.option.fileHidden",
  folder_created: "activity.option.folderCreated",
  folder_renamed: "activity.option.folderRenamed",
  folder_moved: "activity.option.folderMoved",
  folder_deleted: "activity.option.folderDeleted",
  file_shared: "activity.option.fileSharedLink",
  file_shared_email: "activity.option.fileSharedEmail",
  folder_shared: "activity.option.folderShared",
  link_revoked: "activity.option.linkRevoked",
  file_request_created: "activity.option.fileRequestCreated",
  file_request_uploaded: "activity.option.requestUpload",
  file_request_revoked: "activity.option.requestRevoked",
  member_invited: "activity.option.memberInvited",
  member_joined: "activity.option.memberJoined",
  member_removed: "activity.option.memberRemoved",
  member_left: "activity.option.memberLeft",
  invite_revoked: "activity.option.inviteRevoked",
  ownership_transferred: "activity.option.ownershipTransferred",
  member_role_changed: "activity.option.memberRoleChanged",
  member_anchor_updated: "activity.option.folderAccessChanged",
  workspace_created: "activity.option.workspaceCreated",
  workspace_updated: "activity.option.workspaceUpdated",
  workspace_settings_changed: "activity.option.settingsChanged",
  role_updated: "activity.option.roleUpdated",
  role_deleted: "activity.option.roleDeleted",
  comment_added: "activity.option.commentAdded",
  comment_deleted: "activity.option.commentDeleted",
};

/**
 * The sentence template for an action, with `{actor}` and `{subject}` left in
 * place for the caller to fill with styled spans. Null for an unknown code.
 */
export function activitySentenceTemplate(action: string, hasSubject: boolean, tr: T = moduleT): string | null {
  const key = SENTENCE_KEYS[action];
  if (!key) return null;
  return tr(key, { hasSubject: String(hasSubject) });
}

/** The plain sentence ("Ada uploaded report.pdf"), for labels read aloud. Null for an unknown code. */
export function activitySentence(action: string, actor: string, subject?: string | null, tr: T = moduleT): string | null {
  const key = SENTENCE_KEYS[action];
  if (!key) return null;
  return tr(key, { actor, subject: subject ?? "", hasSubject: String(!!subject) });
}

/** A filter chip's label for a category or action value; `fallback` (the shared English) for one this app has no key for. */
export function activityActionLabel(value: string, fallback: string, tr: T = moduleT): string {
  const key = OPTION_KEYS[value];
  return key ? tr(key) : fallback;
}
