import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { toast } from "@/ui/toast";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { formatBytes } from "@/lib/format";
import { t, useT } from "@/lib/i18n";
import { setFileLock, setFolderLock, type LockMode } from "./mutations";
import {
  LOCK_MODE_OPTIONS, canApplyLock, describeLockMode, describeLockStatus, describeLockTarget,
  lockActionLabel, passwordFieldLabel, passwordHint, requiresPassword,
} from "./protection";

export interface LockTarget {
  kind: "file" | "folder";
  id: string;
  name: string;
  lock_mode: string;
  /** Files: shown in the chip as "JPG · 3.1 MB". */
  size_bytes?: number;
  extension?: string | null;
  /** Folders: shown as "Folder · 14 files". */
  file_count?: number;
}

const MODE_ICONS: Record<LockMode, IconName> = {
  none: "lock-open-outline",
  view_only: "eye-outline",
  full_lock: "key-outline",
};

function asLockMode(value: string | undefined): LockMode {
  return value === "view_only" || value === "full_lock" ? value : "none";
}

function successMessage(selected: LockMode, current: LockMode): string {
  if (selected === "none") return t("file-security.label.lockRemoved");
  if (selected === "view_only") return t("files.label.viewOnlySet");
  return current === "full_lock" ? t("common.label.passwordUpdated") : t("file-security.label.lockedWithAPassword");
}

/**
 * Set a file's or folder's lock mode.
 *
 * A bottom sheet rather than a centred card: the Password option opens a text
 * field, and on a small phone the keyboard covered the centred card's field
 * and buttons. Anchored to the bottom, KeyboardAvoidingView lifts the whole
 * sheet instead, and the primary action stays under the thumb. The body
 * scrolls inside a capped sheet, because three described options plus the
 * field and the keyboard do not fit an SE-sized screen.
 *
 * There is no return-key submit on mobile (TextField exposes none), so the
 * inline "too short" message web shows on Enter has no trigger here; the
 * disabled button and its hint carry that rule instead.
 *
 * One sheet for both kinds: the two endpoints take an identical body, and the
 * only thing that differs is the path. What the sheet SAYS differs by kind
 * (protection.ts's describeLockMode), because the consequences do: a
 * password-locked folder refuses new uploads, a password-locked file breaks
 * its share links.
 *
 * The list row is all mobile knows about the current lock (no GET /lock here),
 * so the status line degrades to "Currently password-locked" - who and when
 * arrive once the list endpoint carries them.
 */
export function LockDialog({
  target,
  visible,
  onClose,
  onSaved,
}: {
  target: LockTarget | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  useT();
  const { tokens } = useColorTheme();
  const sheetPad = useSheetBottomPad();
  const current = asLockMode(target?.lock_mode);
  const [selected, setSelected] = useState<LockMode>(current);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  if (!target) return null;

  const isFolder = target.kind === "folder";
  const meta = describeLockTarget({
    kind: target.kind,
    extension: target.extension,
    file_count: target.file_count,
    size: typeof target.size_bytes === "number" ? formatBytes(target.size_bytes) : null,
  });
  const statusLine = describeLockStatus({ lock_mode: current });
  const label = lockActionLabel({ selected, current });
  const enabled = canApplyLock({ selected, current, password }) && !saving;

  const save = async () => {
    if (!enabled) return;
    setSaving(true);
    try {
      const pw = requiresPassword(selected) ? password : undefined;
      if (target.kind === "file") await setFileLock(target.id, selected, pw);
      else await setFolderLock(target.id, selected, pw);
      toast(successMessage(selected, current));
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : t("files.error.couldnTUpdateTheLock"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView className="flex-1 justify-end" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityLabel={t("common.action.dismiss")} accessibilityRole="button" />
        <View className="rounded-t-2xl bg-card" style={{ flexShrink: 1, maxHeight: "92%" }}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: sheetPad }}
          >
            <View className="mb-3 h-[5px] w-9 self-center rounded-full bg-border" />

            <View className="flex-row items-center justify-between">
              <Text className="text-xl text-foreground" style={{ fontFamily: fonts.bold }}>
                {isFolder ? t("file-security.heading.lockFolder") : t("file-security.heading.lockFile")}
              </Text>
              <Pressable
                testID="lock-close"
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full bg-muted"
            >
                <Icon name="close" size={18} color={tokens.mutedForeground} />
              </Pressable>
            </View>

            <View className="mt-3 flex-row items-center gap-3">
              <View className={"h-10 w-10 items-center justify-center rounded-[10px] " + (isFolder ? "bg-primary/15" : "bg-muted")}>
                <Icon
                  name={isFolder ? "folder-outline" : "document-outline"}
                  size={20}
                  color={isFolder ? tokens.primary : tokens.mutedForeground}
                />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={1}>
                  {target.name}
                </Text>
                <Text className="text-[13px] text-muted-foreground" style={{ fontFamily: fonts.regular }}>{meta}</Text>
              </View>
            </View>

            {statusLine ? (
              <View className="mt-3 flex-row items-center gap-2 rounded-[10px] bg-muted px-3 py-2">
                <Icon name={current === "full_lock" ? "lock-closed-outline" : "eye-outline"} size={14} color={tokens.mutedForeground} />
                <Text className="text-[13px] text-muted-foreground" style={{ fontFamily: fonts.regular }}>{statusLine}</Text>
              </View>
            ) : null}

            <View className="mt-4 overflow-hidden rounded-xl border border-border" accessibilityRole="radiogroup" accessibilityLabel={t("file-security.accessibility.accessLevel")}>
              {LOCK_MODE_OPTIONS.map((m, i) => {
                const on = selected === m.value;
                return (
                  <View key={m.value} className={(i > 0 ? "border-t border-border " : "") + (on ? "bg-primary/10" : "")}>
                    <Pressable
                      testID={`lock-mode-${m.value}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setSelected(m.value)}
                      className="flex-row items-start gap-3 px-3.5 py-3"
                  >
                      <Icon name={MODE_ICONS[m.value]} size={22} color={on ? tokens.primary : tokens.mutedForeground} style={{ marginTop: 1 }} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>{m.label}</Text>
                        <Text className="mt-0.5 text-[13px] text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                          {describeLockMode(target.kind, m.value)}
                        </Text>
                      </View>
                      <View
                        className={
                          "mt-0.5 h-[22px] w-[22px] items-center justify-center rounded-full border " +
                          (on ? "border-primary bg-primary" : "border-border")
                        }
                    >
                        {on ? <Icon name="checkmark" size={14} color={tokens.primaryForeground} /> : null}
                      </View>
                    </Pressable>
                    {on && requiresPassword(m.value) ? (
                      <View className="pb-1 ps-[50px] pe-3.5">
                        <TextField
                          testID="lock-password"
                          label={passwordFieldLabel(current)}
                          value={password}
                          onChangeText={setPassword}
                          placeholder={current === "full_lock" ? t("file-security.placeholder.typeANewPassword") : t("file-security.placeholder.chooseAPassword")}
                          secureTextEntry
                          autoCapitalize="none"
                        />
                        <Text className="-mt-2 mb-3 text-[13px] text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                          {passwordHint(current)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View className="mt-4">
              <Button title={label} testID="lock-save" onPress={save} loading={saving} disabled={!enabled} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
