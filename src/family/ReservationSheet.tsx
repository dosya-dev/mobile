// Reserve storage for a family member, or change or remove their reservation,
// as a bottom sheet. Ported from the desktop's
// components/family/ReservationDialog.tsx (itself from
// apps/web/src/components/billing/family-reservation-dialog.tsx): keep the
// behaviour and copy in step.
//
// A reservation is held for that person (nobody else can use it) and is also
// their limit. Whole GB only. The most that fits comes from the view's
// `max_reservable_bytes`; the server re-checks atomically and, when it refuses
// with a 409, its own `max_gb` replaces ours. Lowering is always allowed, even
// when the pool is overbooked, so the limit is never below the current amount.
//
// The backdrop, the Android back button, Cancel and a swipe down on the handle
// or the title close it (not while a save is running). Remove asks first with
// the shared ConfirmDialog, rendered inside this sheet's Modal so iOS presents
// it on top of the sheet instead of racing the sheet's slide-out.
import { useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { ApiError } from "@/api/errors";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Icon } from "@/ui/Icon";
import { SheetHandle } from "@/ui/SheetHandle";
import { Text } from "@/ui/Text";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useKeyboardLift } from "@/ui/useKeyboardLift";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { inputStartAlign } from "@/lib/direction";
import { GB } from "@/lib/format";
import { localDigits } from "@/lib/format-locale";
import { useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";
import { setFamilyReservation } from "./api";
import { personColor, tint, warnTone } from "./colors";
import { formatGigabytes, gbUnit, sizeGb } from "./format";
import type { FamilyPerson } from "./people";
import type { FamilyMemberView } from "./types";

const STEP_GB = 10;

export function ReservationSheet({ member, personKey, people, poolLimit, onClose, onSaved }: {
  member: FamilyMemberView;
  /** Which entry of `people` is this member. */
  personKey: string;
  people: FamilyPerson[];
  poolLimit: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const { scheme, tokens } = useColorTheme();
  const dark = scheme === "dark";
  const sheetPad = useSheetBottomPad();
  const lift = useKeyboardLift();
  const name = member.name ?? member.email;
  const me = people.find((p) => p.key === personKey);
  const used = member.used_bytes ?? me?.used ?? 0;
  const currentGb = member.reserved_bytes ? Math.round(member.reserved_bytes / GB) : null;
  const [serverMaxGb, setServerMaxGb] = useState<number | null>(null);
  const maxGb = serverMaxGb ?? Math.floor((member.max_reservable_bytes ?? 0) / GB);
  const limitGb = Math.max(maxGb, currentGb ?? 0);
  const [raw, setRaw] = useState(() => String(currentGb ?? (limitGb >= 100 ? 100 : Math.max(1, limitGb))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const v = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isSafeInteger(v) && v >= 1;
  const over = valid && v > limitGb;
  const below = valid && !over && v * GB < used;
  const unchanged = valid && v === currentGb;

  const picks = [...new Set((currentGb ? [currentGb, currentGb + 50, currentGb + 100] : [50, 100, 200]).filter((p) => p <= limitGb))];

  const save = async (gb: number | null) => {
    setBusy(true); setError(null);
    try {
      await setFamilyReservation(member.id, gb);
      onSaved();
    } catch (e) {
      const maxFromServer = e instanceof ApiError && e.code === "reservation_too_large" ? e.data?.max_gb : undefined;
      if (typeof maxFromServer === "number") {
        setServerMaxGb(maxFromServer);
      } else {
        setError(e instanceof Error && e.message ? e.message : t("common.error.somethingWentWrongTryAgain"));
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) onClose(); };
  const setGb = (gb: number) => { setRaw(String(Math.max(1, gb))); setError(null); };
  const shown = valid ? v : currentGb ?? 0;

  let note: { tone: "info" | "warn" | "error"; text: string } | null = null;
  if (over) note = { tone: "error", text: t("family.error.onlyMaxIsFreeToReserveForName", { max: sizeGb(limitGb), name }) };
  else if (below) note = { tone: "warn", text: t("family.description.nameAlreadyUsesUsedWithSizeTheirUploadsStop", { name, used: formatGigabytes(used), size: sizeGb(v) }) };
  else if (currentGb === null) note = { tone: "info", text: t("family.description.nameUsesUsedNowYouCanReserveUpToMax", { name, used: formatGigabytes(used), max: sizeGb(limitGb) }) };

  const noteStyle = note?.tone === "warn" ? warnTone(dark)
    : note?.tone === "error" ? { backgroundColor: tint(tokens.destructive, 10), color: tokens.destructive }
    : { backgroundColor: tokens.secondary, color: tokens.mutedForeground };
  const lessOff = busy || !valid || v <= 1;
  const moreOff = busy || limitGb < 1 || (valid && v >= limitGb);
  const strong = (s: string) => <Text className="text-foreground" style={{ fontFamily: fonts.bold }}>{s}</Text>;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/40">
        {/* The backdrop is a sibling behind the panel, not its parent: a
            Pressable is one accessible element, so wrapping the panel in it
            would hide the field, steppers and Save from screen readers. */}
        <Pressable className="absolute inset-0" onPress={close} accessibilityRole="button" accessibilityLabel={t("common.cancel")} testID="reservation-backdrop" />
        <View
          className="max-h-[92%] rounded-t-3xl bg-card"
          testID="reservation-sheet"
          accessibilityElementsHidden={confirmRemove}
          importantForAccessibility={confirmRemove ? "no-hide-descendants" : "auto"}
          style={{ marginBottom: lift }}
          // number-pad has no return key on iOS: a tap on the panel outside a
          // control puts the keyboard away (controls claim their own taps first).
          onStartShouldSetResponder={() => true}
          onResponderRelease={() => Keyboard.dismiss()}
        >
          <SheetHandle onDismiss={close} testID="reservation-handle">
            <Text className="mt-3 text-xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">
              {currentGb ? t("family.heading.changeNameSReservation", { name }) : t("family.heading.reserveStorageForName", { name })}
            </Text>
            <Text className="mt-1.5 text-sm leading-5 text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {currentGb
                ? richText(t("family.description.nameHasReservedReservedAndUsesUsed", { name }), { reserved: strong(sizeGb(currentGb)), used: strong(formatGigabytes(used)) })
                : t("family.description.thisSpaceIsHeldForNameAndIsAlsoTheirLimit", { name })}
            </Text>
          </SheetHandle>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: sheetPad }} showsVerticalScrollIndicator={false}>
            <View className="mt-4 flex-row items-center gap-2.5">
              <Pressable testID="reservation-less" accessibilityRole="button" accessibilityLabel={t("family.accessibility.less")} disabled={lessOff}
                onPress={() => setGb((valid ? v : 1) - STEP_GB)}
                className={`h-[52px] w-[46px] items-center justify-center rounded-2xl bg-secondary ${lessOff ? "opacity-40" : ""}`}>
                <Icon name="remove" size={20} color={tokens.foreground} />
              </Pressable>
              <View className={`h-[52px] min-w-0 flex-1 flex-row items-center rounded-2xl border-2 bg-secondary px-4 ${over ? "border-destructive" : "border-foreground"}`}>
                <TextInput
                  testID="reservation-gb"
                  value={raw}
                  onChangeText={(s) => { setRaw(s); setError(null); }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  autoComplete="off"
                  autoCorrect={false}
                  maxLength={7}
                  editable={!busy}
                  accessibilityLabel={t("family.accessibility.reservationInGb")}
                  returnKeyType="done"
                  className="min-w-0 flex-1 text-foreground"
                  style={{ fontFamily: fonts.bold, fontSize: 24, paddingVertical: 0, ...inputStartAlign() }}
                />
                <Text className="text-base text-muted-foreground" style={{ fontFamily: fonts.medium }} importantForAccessibility="no">{gbUnit()}</Text>
              </View>
              <Pressable testID="reservation-more" accessibilityRole="button" accessibilityLabel={t("family.accessibility.more")} disabled={moreOff}
                onPress={() => setGb(Math.min((valid ? v : 0) + STEP_GB, limitGb))}
                className={`h-[52px] w-[46px] items-center justify-center rounded-2xl bg-secondary ${moreOff ? "opacity-40" : ""}`}>
                <Icon name="add" size={20} color={tokens.foreground} />
              </Pressable>
            </View>

            {(picks.length > 0 || limitGb >= 1) && (
              <View className="mt-2.5 flex-row flex-wrap gap-2">
                {picks.map((p) => <Pick key={p} on={v === p} onPress={() => setGb(p)} label={localDigits(p)} />)}
                {limitGb >= 1 && !picks.includes(limitGb) && (
                  <Pick on={v === limitGb} onPress={() => setGb(limitGb)} label={t("family.action.maxGb", { gb: localDigits(limitGb) })} />
                )}
              </View>
            )}

            <PoolPreview people={people} personKey={personKey} name={name} gb={shown} limitGb={limitGb} over={over} poolLimit={poolLimit} dark={dark} />

            {note && (
              <View testID={`reservation-note-${note.tone}`} accessibilityRole={note.tone === "error" ? "alert" : undefined} accessibilityLiveRegion="polite"
                className="mt-3.5 rounded-xl px-3 py-2.5" style={{ backgroundColor: noteStyle.backgroundColor }}>
                <Text className="text-sm leading-5" style={{ color: noteStyle.color, fontFamily: fonts.regular }}>{note.text}</Text>
              </View>
            )}
            {error && <Text accessibilityRole="alert" className="mt-3 text-sm text-destructive" style={{ fontFamily: fonts.regular }}>{error}</Text>}

            <View className="mt-5 gap-2">
              <Button testID="reservation-save" loading={busy} disabled={!valid || over || unchanged} onPress={() => void save(v)}
                title={currentGb ? t("family.action.saveSize", { size: valid ? sizeGb(v) : "" }) : t("family.action.reserveSize", { size: valid ? sizeGb(v) : "" })} />
              <Button title={t("common.cancel")} variant="ghost" disabled={busy} onPress={close} />
              {currentGb !== null && (
                <Pressable testID="reservation-remove" accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} hitSlop={4}
                  onPress={() => { setError(null); setConfirmRemove(true); }} className={`items-center py-3 ${busy ? "opacity-60" : ""}`}>
                  <Text className="text-base text-destructive" style={{ fontFamily: fonts.medium }}>{t("family.action.removeReservation")}</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
      {confirmRemove && currentGb !== null && (
        <ConfirmDialog
          visible
          title={t("common.heading.areYouSure")}
          message={t("family.description.youAreEndingNameSSizeReservation", { name, size: sizeGb(currentGb) })}
          confirmLabel={t("family.action.removeReservation")}
          destructive
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => { setConfirmRemove(false); void save(null); }}
        />
      )}
    </Modal>
  );
}

function Pick({ on, onPress, label }: { on: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      className={`h-8 items-center justify-center rounded-full px-3 ${on ? "bg-primary" : "bg-secondary"}`}>
      <Text className={`text-sm ${on ? "text-primary-foreground" : "text-foreground"}`} style={{ fontFamily: fonts.bold }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The pool after this change: everyone else's share (a reservation counts in
 * full, or what they use when that is more), then this person's amount, then
 * what is left. The amount turns red when it does not fit.
 */
function PoolPreview({ people, personKey, name, gb, limitGb, over, poolLimit, dark }: {
  people: FamilyPerson[]; personKey: string; name: string; gb: number; limitGb: number; over: boolean; poolLimit: number; dark: boolean;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const limit = Math.max(poolLimit, 1);
  const me = people.find((p) => p.key === personKey);
  const others = people.filter((p) => p.key !== personKey);
  const pct = (bytes: number) => `${Math.min(100, (Math.max(0, bytes) / limit) * 100)}%` as const;
  const colorOf = (p: FamilyPerson) => personColor(p.colorIndex, dark);
  const reservedOther = others.find((p) => p.reserved);
  const sharingOther = others.find((p) => !p.reserved && p.used > 0);
  const mine = me ? colorOf(me) : tokens.foreground;
  const legend: { key: string; color: string; label: string }[] = [
    { key: "me", color: over ? tokens.destructive : mine, label: t("family.label.nameSize", { name, size: sizeGb(gb) }) },
    ...(reservedOther ? [{ key: "res", color: tint(colorOf(reservedOther), 45), label: t("family.label.otherReservations") }] : []),
    ...(sharingOther ? [{ key: "share", color: colorOf(sharingOther), label: t("family.label.usedByPeopleWhoShare") }] : []),
    { key: "free", color: tokens.muted, label: t("family.label.stillFreeSize", { size: sizeGb(Math.max(0, limitGb - gb)) }) },
  ];
  return (
    <View className="mt-4">
      <View className="h-3.5 flex-row gap-0.5 overflow-hidden rounded-full bg-muted" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {others.map((p) => {
          const bytes = p.reserved ? Math.max(p.reserved, p.used) : p.used;
          return bytes > 0 ? <View key={p.key} style={{ width: pct(bytes), backgroundColor: p.reserved ? tint(colorOf(p), 45) : colorOf(p) }} /> : null;
        })}
        {gb > 0 && <View testID="reservation-preview-me" style={{ width: pct(Math.min(gb, limitGb) * GB), backgroundColor: over ? tokens.destructive : mine }} />}
      </View>
      <View className="mt-2 flex-row flex-wrap" style={{ columnGap: 14, rowGap: 6 }}>
        {legend.map((l) => (
          <View key={l.key} className="flex-row items-center gap-1.5">
            <View className={`h-2 w-2 rounded-full ${l.key === "free" ? "border border-border" : ""}`} style={{ backgroundColor: l.color }} />
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
