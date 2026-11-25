import { useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { useShareMutations, useIsFreePlan } from "./hooks";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { Sheet, SheetTitle, FieldLabel, Segmented, ExpiryPicker, ToggleRow, Notice, FreeExpiryHint } from "./controls";
import { choicesForExisting, daysForKey, freeMaxExpiryAt, isExpiryLockedOnFree, CUSTOM } from "./expiry";
import { DatePickerSheet } from "./DatePickerSheet";
import type { ShareAnalyticsLink, ShareUpdateInput } from "./types";
import { useT } from "@/lib/i18n";
import { formatDateWith, localDigits } from "@/lib/format-locale";
import { inputStartAlign } from "@/lib/direction";

/**
 * Change a link that is already out in the world.
 *
 * The point of the whole screen: the token does not change, so every URL
 * already sent keeps working. Before PATCH /api/shares/:id existed, moving an
 * expiry meant revoking and creating a new link - a new address, and everyone
 * holding the old one silently locked out.
 *
 * Only fields the user actually touched are sent. A sheet that posted its whole
 * form would let a stale view clobber a change made from another device.
 */
export function EditShareSheet({ visible, link, recipientEmails, onClose }: {
  visible: boolean;
  link: ShareAnalyticsLink;
  recipientEmails: string[];
  onClose: () => void;
}) {
  const { update } = useShareMutations();
  const { tokens } = useColorTheme();
  const t = useT();
  const now = Math.floor(Date.now() / 1000);
  // apply-update.ts clamps a Free creator's new expiry to 7 days without
  // refusing. The link's CURRENT expiry still shows as selected even when it
  // is past the cap (a link made on a paid plan); only moving to one is locked.
  const isFreePlan = useIsFreePlan();

  const initial = useMemo(() => choicesForExisting(link.expires_at, now), [link.expires_at, now]);
  const [expiryKey, setExpiryKey] = useState(initial.selectedKey);
  const [passwordOn, setPasswordOn] = useState(link.is_password_protected);
  const [password, setPassword] = useState("");
  const [viewOnly, setViewOnly] = useState(link.lock_mode === "view_only");
  const [accessMode, setAccessMode] = useState(link.access_mode);
  const [customExpiry, setCustomExpiry] = useState<number | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState(link.max_downloads == null ? "" : String(link.max_downloads));
  const [error, setError] = useState("");

  // Re-seed whenever the sheet opens, so a second visit shows the link's
  // CURRENT state rather than whatever was left on screen last time.
  useEffect(() => {
    if (!visible) return;
    setExpiryKey(initial.selectedKey);
    setPasswordOn(link.is_password_protected);
    setPassword("");
    setViewOnly(link.lock_mode === "view_only");
    setAccessMode(link.access_mode);
    setCustomExpiry(null);
    setDatePickerOpen(false);
    setMaxDownloads(link.max_downloads == null ? "" : String(link.max_downloads));
    setError("");
  }, [visible, initial.selectedKey, link.is_password_protected, link.lock_mode, link.access_mode, link.max_downloads]);

  const expiryChanged = expiryKey !== initial.selectedKey;
  const passwordChanged = passwordOn !== link.is_password_protected || password.trim().length > 0;
  const lockChanged = viewOnly !== (link.lock_mode === "view_only");
  const accessChanged = accessMode !== link.access_mode;
  const capChanged = maxDownloads.trim() !== (link.max_downloads == null ? "" : String(link.max_downloads));
  const anyChange = expiryChanged || passwordChanged || lockChanged || accessChanged || capChanged;

  const submit = () => {
    setError("");
    const input: ShareUpdateInput = {};

    if (expiryChanged) {
      if (expiryKey === CUSTOM.key) {
        if (customExpiry === null) { setError(t("shared-links.error.pickADateForTheLinkToExpire")); return; }
        if (isFreePlan && customExpiry > freeMaxExpiryAt(now)) { setError(t("sharing.label.freePlanLinksLastUpTo7Days")); return; }
        input.expiresAt = customExpiry;
      } else {
        const days = daysForKey(initial.choices, expiryKey);
        if (days === undefined) { setError(t("shared-links.error.pickHowLongThisLinkShouldLast")); return; }
        const chosen = initial.choices.find((c) => c.key === expiryKey);
        if (isFreePlan && chosen && isExpiryLockedOnFree(chosen)) { setError(t("sharing.label.freePlanLinksLastUpTo7Days")); return; }
        input.expiresInDays = days;
      }
    }
    if (capChanged) {
      const raw = maxDownloads.trim();
      if (!raw) {
        input.maxDownloads = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1) {
          setError(t("common.error.downloadLimitMustBeAWholeNumberOfAtLeast1"));
          return;
        }
        // Lowering the cap below what has already been taken would leave the
        // link instantly spent, which is a revoke by another name.
        if (n < link.download_count) {
          setError(t("shared-links.error.thisLinkHasAlreadyBeenDownloadedDownloadCountTimesSetTheLimitToDownloadCountOr", { downloadCount: link.download_count }));
          return;
        }
        input.maxDownloads = n;
      }
    }
    if (passwordChanged) {
      if (!passwordOn) {
        input.password = null;
      } else {
        const pw = password.trim();
        // Turning protection ON with no password would create a link the UI
        // calls protected and the server would refuse - say so here instead.
        if (!pw) { setError(t("common.error.enterAPasswordOrTurnPasswordProtectionOff")); return; }
        input.password = pw;
      }
    }
    if (lockChanged) input.lockMode = viewOnly ? "view_only" : "none";
    if (accessChanged) {
      input.accessMode = accessMode;
      // Restricting a link needs somebody on the list. The recipients already
      // on file count, so only an empty list is a problem worth naming.
      if (accessMode === "restricted" && recipientEmails.length === 0) {
        setError(t("shared-links.error.thisLinkHasNoInvitedPeopleYetSendItByEmailFirstToRestrict"));
        return;
      }
    }

    try {
      update.mutate({ linkId: link.link_id, input }, { onSuccess: onClose });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shared-links.error.couldNotSaveThoseChanges"));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <SheetTitle
        title={t("shared-links.heading.editThisLink")}
        subtitle={t("shared-links.description.theAddressStaysTheSameChangesApplyTheMomentYouSave")}
        onClose={onClose}
      />

      <View style={{ gap: 8 }}>
        <FieldLabel>{t("common.label.expires")}</FieldLabel>
        <ExpiryPicker
          choices={initial.choices}
          value={expiryKey}
          onChange={(k) => {
            setExpiryKey(k);
            if (k === CUSTOM.key) setDatePickerOpen(true);
          }}
          isLocked={isFreePlan ? isExpiryLockedOnFree : undefined}
          lockedHint={t("sharing.label.freePlanLinksLastUpTo7Days")}
        />
        {expiryKey === CUSTOM.key && customExpiry ? (
          <Text className="text-[11px] text-muted-foreground">
            {t("common.description.worksThroughDate", { date: formatDateWith(customExpiry * 1000, { day: "numeric", month: "long", year: "numeric" }) })}
          </Text>
        ) : null}
        {isFreePlan ? <FreeExpiryHint text={t("sharing.label.freePlanLinksLastUpTo7Days")} /> : null}
      </View>

      <ToggleRow
        icon="key-outline"
        label={t("common.label.password")}
        hint={link.is_password_protected && passwordOn ? t("shared-links.description.leaveBlankToKeepTheCurrentPassword") : undefined}
        value={passwordOn}
        onChange={setPasswordOn}
        testID="toggle-password"
      />
      {passwordOn ? (
        <TextField
          value={password}
          onChangeText={setPassword}
          placeholder={link.is_password_protected ? t("shared-links.placeholder.newPasswordOptional") : t("common.placeholder.password")}
          secureTextEntry
          autoCapitalize="none"
          testID="password-field"
        />
      ) : null}

      <ToggleRow
        icon="eye-outline"
        label={t("common.label.viewOnlyNoDownloads")}
        hint={t("common.description.noDownloadButtonAndImagesOpenAsAReducedSizePreviewRatherThanThe")}
        value={viewOnly}
        onChange={setViewOnly}
        testID="toggle-view-only"
      />

      {/* Only offered where it is meaningful: a public link has no recipient
          list to fall back on, so restricting it here would refuse. */}
      {link.access_mode === "restricted" || recipientEmails.length > 0 ? (
        <View style={{ gap: 8 }}>
          <FieldLabel>{t("shared-links.label.whoCanOpenIt")}</FieldLabel>
          <Segmented
            testID="access"
            value={accessMode}
            onChange={(k) => setAccessMode(k as typeof accessMode)}
            options={[
              { key: "public", label: t("shared-links.label.anyoneWithTheLink") },
              { key: "restricted", label: t("shared-links.label.onlyInvitedHasCountSelectTrueCountOther", { hasCount: String(recipientEmails.length > 0), count: localDigits(recipientEmails.length) }) },
            ]}
          />
        </View>
      ) : null}

      {!viewOnly ? (
        <View style={{ gap: 8 }}>
          <FieldLabel hint={link.download_count > 0 ? t("shared-links.label.downloadcountTakenSoFar", { downloadCount: link.download_count }) : t("common.label.optional")}>
            {t("common.label.downloadLimit")}
          </FieldLabel>
          <View className="flex-row items-center gap-2 rounded-lg border border-border bg-background px-3">
            <Icon name="download-outline" size={14} color={tokens.mutedForeground} />
            <TextInput
              testID="max-downloads"
              value={maxDownloads}
              onChangeText={setMaxDownloads}
              placeholder={t("common.placeholder.unlimited")}
              placeholderTextColor={tokens.mutedForeground}
              keyboardType="number-pad"
              className="flex-1 py-2.5 text-foreground"
              style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
            />
          </View>
        </View>
      ) : null}

      {/* Named consequences, because these two changes take away access people
          already have. */}
      {lockChanged && viewOnly && link.download_count > 0 ? (
        <Notice>
          {t("shared-links.description.turningOnViewOnlyStopsTheDownloadCountPluralOnePersonOtherPeopleWhoAlready", { downloadCount: link.download_count })}
        </Notice>
      ) : null}
      {accessChanged && accessMode === "restricted" ? (
        <Notice>
          {t("shared-links.description.anyoneWhoIsNotOnTheInvitedListLosesAccessIncludingPeopleYouAlready")}
        </Notice>
      ) : null}

      {error ? <Text className="text-xs text-destructive" testID="edit-error">{error}</Text> : null}

      <Button
        title={t("common.action.saveChanges")}
        onPress={submit}
        disabled={!anyChange}
        loading={update.isPending}
        testID="save-link"
      />
      {!anyChange ? (
        <Text className="text-center text-[11px] text-muted-foreground">{t("shared-links.description.nothingChangedYet")}</Text>
      ) : null}

      <DatePickerSheet
        visible={datePickerOpen}
        initial={customExpiry ?? link.expires_at}
        maxAt={isFreePlan ? freeMaxExpiryAt(now) : undefined}
        onCancel={() => {
          setDatePickerOpen(false);
          if (customExpiry === null) setExpiryKey(initial.selectedKey);
        }}
        onPick={(at) => { setCustomExpiry(at); setDatePickerOpen(false); }}
      />
    </Sheet>
  );
}
