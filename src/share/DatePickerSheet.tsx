import { useMemo, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useT } from "@/lib/i18n";
import { formatDateGregorian } from "@/lib/format-locale";
import { addMonths, dayLabel, expiryForDay, lastDayEndingBy, monthGrid, monthLabel, startOfDay, weekdayInitials } from "./calendar";

/**
 * Pick an expiry date.
 *
 * Deliberately hand-built rather than @react-native-community/datetimepicker:
 * that is a native module, so it would need an EAS build before anyone could
 * use the feature at all. The API takes an absolute `expires_at`, and the
 * arithmetic lives in calendar.ts where it is tested without rendering, so this
 * component is only the grid.
 */
export function DatePickerSheet({ visible, initial, maxAt, onCancel, onPick }: {
  visible: boolean;
  /** Unix seconds to open on, if the caller already has a date. */
  initial?: number | null;
  /**
   * The latest expiry (unix seconds) the link may carry - the Free cap. Days
   * that would end after it are drawn but not tappable.
   */
  maxAt?: number;
  onCancel: () => void;
  /** Receives unix seconds at the END of the chosen day. */
  onPick: (expiresAt: number) => void;
}) {
  const { tokens } = useColorTheme();
  const pad = useSheetBottomPad();
  const t = useT();

  // Tomorrow is the earliest useful expiry: a link expiring today is one the
  // recipient may already have missed.
  const minMs = useMemo(() => startOfDay(Date.now()) + 86_400_000, []);
  const maxMs = useMemo(() => (maxAt == null ? undefined : lastDayEndingBy(maxAt)), [maxAt]);
  // An existing link's date past the cap (an edit of a link made on a paid
  // plan) is neither opened on as picked nor offered: only reachable days are.
  const initialOk = initial != null && initial > 0 && (maxMs == null || startOfDay(initial * 1000) <= maxMs);
  const [month, setMonth] = useState(() => (initialOk ? initial! * 1000 : minMs));
  const [picked, setPicked] = useState<number | null>(() => (initialOk ? startOfDay(initial! * 1000) : null));

  const cells = useMemo(() => monthGrid(month, minMs, maxMs), [month, minMs, maxMs]);
  // `t` is a dependency so the initials follow a language switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initials = useMemo(() => weekdayInitials(), [t]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" accessibilityLabel={t("common.action.closeDatePicker")} onPress={onCancel} />
        <View className="rounded-t-2xl border-t border-border bg-card px-5 pt-2" style={{ paddingBottom: pad }}>
          <View className="items-center pb-2">
            <View className="h-1 w-9 rounded-full bg-border" />
          </View>

          <View className="mb-2 flex-row items-center">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.action.previousMonth")}
              testID="cal-prev"
              hitSlop={10}
              onPress={() => setMonth((m) => addMonths(m, -1))}
            >
              <Icon name="chevron-back" size={18} color={tokens.foreground} />
            </Pressable>
            <Text className="flex-1 text-center text-sm text-foreground" style={{ fontFamily: fonts.bold }} testID="cal-month">
              {monthLabel(month)}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.action.nextMonth")}
              testID="cal-next"
              hitSlop={10}
              onPress={() => setMonth((m) => addMonths(m, 1))}
            >
              <Icon name="chevron-forward" size={18} color={tokens.foreground} />
            </Pressable>
          </View>

          <View className="flex-row">
            {initials.map((w, i) => (
              <View key={`${w}-${i}`} className="flex-1 items-center py-1">
                <Text className="text-[10px] text-muted-foreground">{w}</Text>
              </View>
            ))}
          </View>

          <View className="flex-row flex-wrap">
            {cells.map((c) => {
              const selected = picked === c.at;
              return (
                <View key={c.at} style={{ width: `${100 / 7}%` }} className="items-center py-0.5">
                  <Pressable
                    testID={c.inMonth ? `cal-day-${c.day}` : undefined}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: c.disabled }}
                    disabled={c.disabled}
                    onPress={() => setPicked(c.at)}
                    className={"h-9 w-9 items-center justify-center rounded-full " + (selected ? "bg-primary" : "")}
                  >
                    <Text
                      className={
                        "text-xs " +
                        (selected ? "text-primary-foreground"
                          : c.disabled ? "text-muted-foreground"
                          : c.inMonth ? "text-foreground" : "text-muted-foreground")
                      }
                      style={{ fontFamily: selected ? fonts.bold : fonts.regular, opacity: c.disabled ? 0.4 : c.inMonth ? 1 : 0.5 }}
                    >
                      {dayLabel(c.day)}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text className="mb-2 mt-1 text-center text-[11px] text-muted-foreground">
            {picked
              ? t("common.description.theLinkWorksThroughDate", { date: formatDateGregorian(picked, { day: "numeric", month: "long" }) })
              : t("common.description.pickTheLastDayTheLinkShouldWork")}
          </Text>

          <View className="flex-row gap-2 pb-2">
            <View className="flex-1"><Button title={t("common.cancel")} variant="ghost" testID="cal-cancel" onPress={onCancel} /></View>
            <View className="flex-1">
              <Button
                title={t("common.action.useThisDate")}
                testID="cal-confirm"
                disabled={picked === null}
                onPress={() => picked !== null && onPick(expiryForDay(picked))}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
