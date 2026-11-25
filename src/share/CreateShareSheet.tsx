import { useEffect, useMemo, useState } from "react";
import { Pressable, Share, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import * as Clipboard from "expo-clipboard";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { toast } from "@/ui/toast";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useShareMutations, useFolderShareExclusions, useWorkspaceShareDefault, useIsFreePlan } from "./hooks";
import { Sheet, FieldLabel, Segmented, ExpiryPicker, ToggleRow, Notice, EmailChips, FreeExpiryHint } from "./controls";
import {
  choicesForDefault, daysForKey, freeMaxExpiryAt, isExpiryLockedOnFree, CUSTOM, NEVER, FREE_MAX_EXPIRY_DAYS,
} from "./expiry";
import { DatePickerSheet } from "./DatePickerSheet";
import { avatarColor, avatarLabel } from "./format";
import { formatBytes } from "@/files/format";
import { byteCount, formatDateWith, localDigits } from "@/lib/format-locale";
import { useLocale, useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { inputStartAlign } from "@/lib/direction";

/**
 * Create a share link, for a file or a whole folder.
 *
 * Replaces two near-identical full-screen forms (file/[id]/share.tsx and
 * folder/[id]/share.tsx) that between them offered four expiry choices, one
 * password, and a single email field - so "only these people" could never mean
 * more than one person, and a folder link never said what it would leave out.
 */

export type ShareTarget =
  | { kind: "file"; id: string; name: string; sizeBytes?: number | null; extension?: string | null }
  | { kind: "folder"; id: string; name: string; itemCount?: number | null };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreateShareSheet({ visible, target, onClose }: {
  visible: boolean;
  target: ShareTarget;
  onClose: () => void;
}) {
  const { tokens } = useColorTheme();
  const t = useT();
  const { locale } = useLocale();
  const workspaceId = useWorkspaceStore((s) => s.activeId);
  const { createLink, createFolderLink, email, folderEmail } = useShareMutations();

  const isFolder = target.kind === "folder";
  const exclusions = useFolderShareExclusions(isFolder && visible ? target.id : null);
  const wsDefault = useWorkspaceShareDefault(visible ? workspaceId : null);
  // The API clamps a Free creator's links to 7 days without refusing, so the
  // picker locks the longer choices and opens on the cap instead (as web does).
  const isFreePlan = useIsFreePlan();

  const [tab, setTab] = useState<"link" | "email">("link");
  const [accessMode, setAccessMode] = useState<"public" | "restricted">("public");
  const [expiryKey, setExpiryKey] = useState("");
  const [passwordOn, setPasswordOn] = useState(false);
  const [password, setPassword] = useState("");
  const [viewOnly, setViewOnly] = useState(false);
  /** "Remove photo metadata": photos leave through the link without EXIF/XMP/IPTC. */
  const [stripMetadata, setStripMetadata] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  /** Unix seconds from the calendar, set only while the date chip is selected. */
  const [customExpiry, setCustomExpiry] = useState<number | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [maxDownloads, setMaxDownloads] = useState("");

  const expiry = useMemo(
    () => choicesForDefault(wsDefault.data, isFreePlan ? FREE_MAX_EXPIRY_DAYS : undefined),
    [wsDefault.data, isFreePlan],
  );

  // The workspace's default arrives asynchronously. It seeds the picker only
  // while the user has not chosen anything, so a slow settings response can
  // never overwrite a choice they already made.
  useEffect(() => {
    if (visible && !expiryKey) setExpiryKey(expiry.selectedKey);
  }, [visible, expiry.selectedKey, expiryKey]);

  // /api/me is normally warm, but if it lands after the sheet seeded a chip
  // the Free cap locks, move back to the clamped default rather than leave a
  // selected chip the user can no longer tap.
  useEffect(() => {
    if (!visible || !isFreePlan) return;
    const chosen = expiry.choices.find((c) => c.key === expiryKey);
    if (chosen && isExpiryLockedOnFree(chosen)) setExpiryKey(expiry.selectedKey);
  }, [visible, isFreePlan, expiry, expiryKey]);

  useEffect(() => {
    if (visible) return;
    setTab("link"); setAccessMode("public"); setExpiryKey("");
    setPasswordOn(false); setPassword(""); setViewOnly(false);
    setEmails([]); setEmailDraft(""); setMessage(""); setError(""); setCreatedUrl("");
    setCustomExpiry(null); setDatePickerOpen(false); setMaxDownloads("");
  }, [visible]);

  const addEmail = (raw: string) => {
    for (const part of raw.split(/[,;\s]+/)) {
      const e = part.trim().toLowerCase();
      if (!e) continue;
      if (!EMAIL_RE.test(e)) { setError(t("sharing.error.partIsNotAValidEmailAddress", { part: part.trim() })); return; }
      setEmails((prev) => (prev.includes(e) ? prev : [...prev, e]));
    }
    setEmailDraft("");
    setError("");
  };

  const opts = () => {
    const custom = expiryKey === CUSTOM.key;
    return {
      // A picked date is absolute; everything else is a duration. Never both -
      // the API resolves expires_at first, so sending both would make the date
      // silently authoritative.
      expiresAt: custom ? (customExpiry ?? undefined) : undefined,
      expiresInDays: custom ? undefined : daysForKey(expiry.choices, expiryKey),
      password: passwordOn ? password.trim() : undefined,
      lockMode: viewOnly ? ("view_only" as const) : undefined,
      maxDownloads: capValue(),
      stripMetadata: stripMetadata || undefined,
    };
  };

  /** The typed download ceiling, or null for unlimited. */
  const capValue = (): number | null => {
    const raw = maxDownloads.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : NaN as unknown as number;
  };

  const guard = (): boolean => {
    if (expiryKey === CUSTOM.key && customExpiry === null) {
      setError(t("sharing.error.pickADateForTheLinkToExpireOrChooseOneOfThePresets"));
      return false;
    }
    // The calendar already stops at the cap; this catches a choice made before
    // /api/me said Free, which the server would otherwise quietly cut to 7 days.
    if (isFreePlan) {
      const chosen = expiry.choices.find((c) => c.key === expiryKey);
      const tooLong = expiryKey === CUSTOM.key
        ? (customExpiry ?? 0) > freeMaxExpiryAt(Math.floor(Date.now() / 1000))
        : chosen != null && isExpiryLockedOnFree(chosen);
      if (tooLong) {
        setError(t("sharing.label.freePlanLinksLastUpTo7Days"));
        return false;
      }
    }
    if (Number.isNaN(capValue())) {
      setError(t("common.error.downloadLimitMustBeAWholeNumberOfAtLeast1"));
      return false;
    }
    if (passwordOn && !password.trim()) {
      setError(t("common.error.enterAPasswordOrTurnPasswordProtectionOff"));
      return false;
    }
    if (tab === "email" && emails.length === 0) {
      setError(t("sharing.error.addAtLeastOneEmailAddress"));
      return false;
    }
    return true;
  };

  const onCreateLink = async () => {
    setError("");
    if (!guard()) return;
    try {
      const o = opts();
      const link = isFolder
        ? await createFolderLink.mutateAsync({ folderId: target.id, opts: o })
        : await createLink.mutateAsync({ fileId: target.id, opts: o });
      setCreatedUrl(link.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sharing.error.couldNotCreateThatLink"));
    }
  };

  const onSendEmail = async () => {
    setError("");
    if (!guard()) return;
    try {
      const o = { ...opts(), emails, message: message.trim(), restrictToRecipients: accessMode === "restricted" };
      if (isFolder) await folderEmail.mutateAsync({ folderId: target.id, opts: o });
      else await email.mutateAsync({ fileId: target.id, opts: o });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sharing.error.couldNotSendThatLink"));
    }
  };

  const busy = createLink.isPending || createFolderLink.isPending || email.isPending || folderEmail.isPending;

  if (createdUrl) {
    return (
      <Sheet visible={visible} onClose={onClose}>
        <View className="items-center gap-2 pt-2">
          <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: `${tokens.primary}22` }}>
            <Icon name="checkmark" size={24} color={tokens.primary} />
          </View>
          <Text className="text-base text-foreground" style={{ fontFamily: fonts.bold }}>{t("sharing.label.linkIsLive")}</Text>
          <Text className="text-center text-[11px] text-muted-foreground">
            {describeLink(t, locale, { expiryKey, expiryLabel: expiry.choices.find((c) => c.key === expiryKey)?.label, passwordOn, viewOnly, stripMetadata })}
          </Text>
        </View>

        {/* The one thing a phone does better than a desktop here: hand the link
            over in person. Both apps already bundle a QR renderer for two-factor
            setup and neither had ever pointed one at a share URL. */}
        <View className="items-center rounded-xl bg-white p-3" testID="share-qr">
          <QRCode value={createdUrl} size={132} backgroundColor="#ffffff" color="#0b1317" />
        </View>

        <View className="flex-row items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
          <Icon name="globe-outline" size={13} color={tokens.mutedForeground} />
          <Text className="flex-1 text-[11px] text-foreground" style={{ fontFamily: fonts.mono }} numberOfLines={1} selectable>
            {createdUrl.replace(/^https?:\/\//, "")}
          </Text>
        </View>

        <View className="flex-row gap-2">
          <View className="flex-1">
            <Button
              title={t("common.copy")}
              variant="ghost"
              testID="copy-created"
              onPress={async () => { await Clipboard.setStringAsync(createdUrl); toast(t("common.label.linkCopied")); }}
            />
          </View>
          <View className="flex-1">
            <Button title={t("common.action.share")} testID="share-created" onPress={() => void Share.share({ message: createdUrl })} />
          </View>
        </View>
        <Button title={t("common.done")} variant="ghost" onPress={onClose} />
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: avatarColor(target.name) }}
        >
          {isFolder ? (
            <Icon name="folder" size={18} color="#fff" />
          ) : (
            <Text className="text-[9px]" style={{ fontFamily: fonts.bold, color: "#fff" }}>
              {avatarLabel(target.name, target.extension)}
            </Text>
          )}
        </View>
        <View className="flex-1">
          <Text className="text-sm text-foreground" style={{ fontFamily: fonts.bold }} numberOfLines={1}>{target.name}</Text>
          <Text className="text-[11px] text-muted-foreground">
            {isFolder
              ? target.itemCount != null ? t("common.label.countItems", { count: byteCount(target.itemCount) }) : t("common.label.folder")
              : target.sizeBytes != null ? formatBytes(target.sizeBytes) : t("common.label.fileTitleCase")}
          </Text>
        </View>
      </View>

      <Segmented
        testID="tab"
        value={tab}
        onChange={(k) => setTab(k as "link" | "email")}
        options={[{ key: "link", label: t("sharing.action.getALink") }, { key: "email", label: t("sharing.action.sendByEmail") }]}
      />

      {/* What a folder link will NOT carry, shown before the sharer commits
          rather than discovered later from a confused recipient. */}
      {isFolder && (exclusions.data ?? 0) > 0 ? (
        <Notice>
          {t("sharing.description.countPluralOneItemStaysOutOfThisLinkHiddenFromYouOrLocked", { count: exclusions.data ?? 0 })}
        </Notice>
      ) : null}

      {tab === "email" ? (
        <>
          <View style={{ gap: 8 }}>
            <FieldLabel>{t("map.label.to")}</FieldLabel>
            <EmailChips emails={emails} onRemove={(e) => setEmails((prev) => prev.filter((x) => x !== e))} />
            <View className="flex-row items-center gap-2 rounded-lg border border-border bg-background px-3">
              <Icon name="mail-outline" size={14} color={tokens.mutedForeground} />
              <TextInput
                testID="email-input"
                value={emailDraft}
                onChangeText={setEmailDraft}
                onSubmitEditing={() => addEmail(emailDraft)}
                onBlur={() => emailDraft.trim() && addEmail(emailDraft)}
                placeholder={emails.length ? t("sharing.placeholder.addAnotherAddress") : t("common.placeholder.nameExampleCom")}
                placeholderTextColor={tokens.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 py-2.5 text-foreground"
                style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
              />
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <FieldLabel>{t("common.label.message")}</FieldLabel>
            <TextInput
              testID="message-input"
              value={message}
              onChangeText={setMessage}
              placeholder={t("sharing.placeholder.optionalNoteToGoWithTheLink")}
              placeholderTextColor={tokens.mutedForeground}
              multiline
              className="min-h-[64px] rounded-lg border border-border bg-background px-3 py-2.5 text-foreground"
              style={{ fontFamily: fonts.regular, textAlignVertical: "top", ...inputStartAlign() }}
            />
          </View>
        </>
      ) : null}

      <View style={{ gap: 8 }}>
        <FieldLabel hint={wsDefault.data != null ? t("sharing.label.workspaceDefaultDaysDays", { days: localDigits(wsDefault.data) }) : undefined}>
          {t("common.label.expires")}
        </FieldLabel>
        <ExpiryPicker
          choices={expiry.choices}
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

      {tab === "email" ? (
        <ToggleRow
          icon="people-outline"
          label={t("sharing.label.onlyThesePeopleCanOpenIt")}
          hint={accessMode === "restricted"
            ? t("sharing.description.theyConfirmTheirAddressWithAOneTimeCodeForwardingTheLinkDoesNot")
            : t("sharing.description.anyoneWithTheLinkCanOpenItIncludingAnyoneItIsForwardedTo")}
          value={accessMode === "restricted"}
          onChange={(v) => setAccessMode(v ? "restricted" : "public")}
          testID="toggle-restricted"
        />
      ) : null}

      <ToggleRow
        icon="key-outline"
        label={t("sharing.label.passwordProtect")}
        value={passwordOn}
        onChange={setPasswordOn}
        testID="toggle-password"
      />
      {passwordOn ? (
        <TextField
          value={password}
          onChangeText={setPassword}
          placeholder={t("common.placeholder.atLeast8Characters")}
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

      <ToggleRow
        icon="location-outline"
        label={t("sharing.label.removePhotoMetadata")}
        hint={t("sharing.description.photosAreHandedOverWithoutLocationCameraAndCapture")}
        value={stripMetadata}
        onChange={setStripMetadata}
        testID="toggle-strip-metadata"
      />

      {/* Meaningless alongside view-only, which allows no downloads at all, so
          the field is hidden rather than offered and then ignored. */}
      {!viewOnly ? (
        <View style={{ gap: 8 }}>
          <FieldLabel hint={t("common.label.optional")}>{t("common.label.downloadLimit")}</FieldLabel>
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
          <Text className="text-[11px] text-muted-foreground">
            {t("sharing.description.theLinkStopsWorkingOnceItHasBeenDownloadedThisManyTimes")}
          </Text>
        </View>
      ) : null}

      {error ? <Text className="text-xs text-destructive" testID="create-error">{error}</Text> : null}

      <Button
        title={tab === "email"
          ? (emails.length ? t("sharing.action.sendToCountPluralOnePersonOtherPeople", { count: emails.length }) : t("sharing.action.sendToPeople"))
          : t("sharing.action.createLink")}
        onPress={() => void (tab === "email" ? onSendEmail() : onCreateLink())}
        loading={busy}
        testID={tab === "email" ? "send-email" : "create-link"}
      />

      <DatePickerSheet
        visible={datePickerOpen}
        initial={customExpiry}
        maxAt={isFreePlan ? freeMaxExpiryAt(Math.floor(Date.now() / 1000)) : undefined}
        onCancel={() => {
          setDatePickerOpen(false);
          // Backing out with no date leaves the chip selected but empty, which
          // would refuse on submit. Fall back to the default instead.
          if (customExpiry === null) setExpiryKey(expiry.selectedKey);
        }}
        onPick={(at) => { setCustomExpiry(at); setDatePickerOpen(false); }}
      />
    </Sheet>
  );
}

/** One line naming what the created link actually does. */
function describeLink(
  t: T,
  locale: string,
  o: { expiryKey: string; expiryLabel?: string; passwordOn: boolean; viewOnly: boolean; stripMetadata?: boolean },
): string {
  const expiry = o.expiryKey === NEVER.key ? "never" : o.expiryLabel ? "duration" : "other";
  return t("sharing.description.expiry", {
    expiry,
    // English reads "Expires in 7 days" with the label lower-cased; other
    // languages keep their label as written (German nouns, for one).
    duration: o.expiryLabel ? (locale === "en" ? o.expiryLabel.toLowerCase() : o.expiryLabel) : "",
    passwordOn: String(o.passwordOn),
    viewOnly: String(o.viewOnly),
    stripMetadata: String(!!o.stripMetadata),
  });
}

/** Also exported as a Pressable trigger, so screens do not re-implement one. */
export function ShareButton({ onPress, label: labelProp }: { onPress: () => void; label?: string }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const label = labelProp ?? t("common.action.share");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID="open-share-sheet"
      className="flex-row items-center gap-2 rounded-lg border border-border px-3 py-2"
    >
      <Icon name="share-outline" size={15} color={tokens.foreground} />
      <Text className="text-xs text-foreground" style={{ fontFamily: fonts.medium }}>{label}</Text>
    </Pressable>
  );
}
