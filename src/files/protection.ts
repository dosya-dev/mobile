import type { LockMode, HiddenMode } from "./mutations";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";

/**
 * Lock and hide rules for mobile.
 *
 * Mobile-local rather than in @dosya-dev/shared: mobile is decoupled from that
 * package (see src/lib/format.ts), and web and desktop already ship their own
 * lock and hide UI. Only mobile is gaining these controls.
 */

/** Matches apps/web/src/components/lock-modal.tsx. */
export const MIN_LOCK_PASSWORD_LENGTH = 8;

/**
 * The hide modes mobile can author. `users` and `roles` need a searchable
 * member or role multi-select, which mobile deliberately does not ship, so it
 * can CLEAR those modes but never create one. Keeping the list and the
 * predicate in one place stops a radio group drifting from the rule.
 */
export const SETTABLE_HIDDEN_MODES: readonly HiddenMode[] = ["none", "everyone"] as const;

export function isHiddenModeSettable(mode: HiddenMode): boolean {
  return SETTABLE_HIDDEN_MODES.includes(mode);
}

export function requiresPassword(mode: LockMode): boolean {
  return mode === "full_lock";
}

export interface ProtectionInput {
  lock_mode?: string | null;
  hidden_mode?: string | null;
  /** How many users or roles the hide rule names, when the caller has it. */
  hidden_rule_count?: number | null;
}

/**
 * One-line human label for a file's protection state, or null when it has none.
 *
 * This is what mobile shows for a hide mode it cannot author: the user can see
 * that a rule exists and clear it, even where they cannot edit its targets. A
 * screen that simply showed "not hidden" for a file hidden from three roles
 * would be lying.
 */
export function describeProtection(input: ProtectionInput): string | null {
  const lock = (input.lock_mode ?? "none") as LockMode;
  if (lock === "full_lock") return t("files.status.locked");
  if (lock === "view_only") return t("common.status.viewOnly");

  const hidden = (input.hidden_mode ?? "none") as HiddenMode;
  const n = input.hidden_rule_count;
  if (hidden === "everyone") return t("file-security.label.hiddenFromEverybody");
  if (hidden === "users") {
    return n == null ? t("file-security.label.hiddenFromSpecificUsers") : t("files.label.hiddenFromNPluralOneUserOtherUsers", { n });
  }
  if (hidden === "roles") {
    return n == null ? t("file-security.label.hiddenFromSpecificRoles") : t("files.label.hiddenFromNPluralOneRoleOtherRoles", { n });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lock dialog model. Ported from apps/web/src/lib/lock-mode.ts word for word,
// so the three clients describe the same lock_mode the same way - a copy
// change there is a copy change here.

export type LockKind = "file" | "folder";

// `label` is a getter over t, so the exported constant holds no text and a
// language switch is picked up the next time it is read.
export const LOCK_MODE_OPTIONS: readonly { value: LockMode; readonly label: string }[] = [
  { value: "none", get label() { return t("file-security.label.unlocked"); } },
  { value: "view_only", get label() { return t("common.status.viewOnly"); } },
  { value: "full_lock", get label() { return t("common.label.password"); } },
];

// Each sentence maps to shipped behaviour in the API's download-guard and
// share lock-gate: view_only denies the bytes but not the preview; full_lock
// hands out one-hour unlock tokens, seals a folder against additions, and
// refuses share links to the item.
const LOCK_DESCRIPTIONS: Record<LockKind, Record<LockMode, MessageKey>> = {
  file: {
    none: "file-security.label.anyoneWithAccessToItCanOpenDownloadAnd",
    view_only: "file-security.label.membersCanPreviewItInTheViewerButNot",
    full_lock: "file-security.description.opensOnlyWithAPasswordAnUnlockLastsAn",
  },
  folder: {
    none: "file-security.label.anyoneWithAccessToItCanOpenItAnd",
    view_only: "file-security.label.membersCanBrowseAndPreviewWhatIsInsideBut",
    full_lock: "file-security.description.opensOnlyWithAPasswordWhileItIsLocked",
  },
};

export function describeLockMode(kind: LockKind, mode: LockMode): string {
  return t(LOCK_DESCRIPTIONS[kind][mode]);
}

/** What the primary button will do. Neutral while the current mode is unknown. */
export function lockActionLabel(input: { selected: LockMode; current: LockMode; loading?: boolean }): string {
  if (input.loading) return t("file-security.apply");
  if (input.selected === "none") return t("file-security.action.removeLock");
  if (input.selected === "view_only") return t("file-security.action.setViewOnly");
  return input.current === "full_lock" ? t("common.action.updatePassword") : t("file-security.action.lockWithPassword");
}

/**
 * Whether pressing the button would do anything the server accepts. A password
 * lock always needs a password - the server has no "keep the old one" path -
 * so re-choosing Password on a locked item is a password change, not a no-op.
 */
export function canApplyLock(input: { selected: LockMode; current: LockMode; password: string; loading?: boolean }): boolean {
  if (input.loading) return false;
  if (requiresPassword(input.selected)) return input.password.trim().length >= MIN_LOCK_PASSWORD_LENGTH;
  return input.selected !== input.current;
}

export function passwordFieldLabel(current: LockMode): string {
  return current === "full_lock" ? t("common.label.newPassword") : t("common.label.password");
}

export function passwordHint(current: LockMode): string {
  const min = String(MIN_LOCK_PASSWORD_LENGTH);
  return current === "full_lock"
    ? t("files.description.atLeastMinCharactersReplacesTheCurrentOne", { min })
    : t("files.description.atLeastMinCharacters", { min });
}

/**
 * The "already locked" line. `lockedWhen` is pre-formatted by the caller.
 * Mobile's list rows carry only lock_mode, so here it usually degrades to the
 * bare "Currently ..." form. Null when there is no lock.
 */
export function describeLockStatus(input: { lock_mode: string; locked_by_name?: string | null; lockedWhen?: string | null }): string | null {
  const mode = input.lock_mode;
  if (mode !== "full_lock" && mode !== "view_only") return null;
  const by = input.locked_by_name?.trim();
  const when = input.lockedWhen?.trim();
  if (!by && !when) return mode === "full_lock" ? t("file-security.label.currentlyPasswordLocked") : t("file-security.label.currentlyViewOnly");
  if (by && when) return t("files.description.modeSelectFullLockPasswordLockSetByByWhenOtherViewOnlySet", { mode, by, when });
  if (by) return t("files.description.modeSelectFullLockPasswordLockSetByByOtherViewOnlySetBy", { mode, by });
  return t("files.description.modeSelectFullLockPasswordLockSetWhenOtherViewOnlySetWhen", { mode, when: when as string });
}

/** The chip under the title. `size` is pre-formatted; unknown parts are left out. */
export function describeLockTarget(input: { kind: LockKind; extension?: string | null; size?: string | null; file_count?: number | null }): string {
  const ext = input.extension?.trim();
  const hasCount = input.kind === "folder" && typeof input.file_count === "number";
  return t("files.label.kindInFiles", {
    kind: input.kind,
    hasCount: String(hasCount),
    count: hasCount ? (input.file_count as number) : 0,
    hasExtension: String(!!ext),
    extension: ext ? ext.toUpperCase() : "",
    hasSize: String(!!input.size),
    size: input.size ?? "",
  });
}
