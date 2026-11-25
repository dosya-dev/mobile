import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useT } from "@/lib/i18n";
import type { ExpiryChoice } from "./expiry";

/**
 * The controls the create sheet and the edit sheet both draw.
 *
 * Shared rather than duplicated because they express the same link properties,
 * and two copies is how the five share-creating API endpoints drifted apart in
 * the first place (see lib/share/create.ts).
 */

export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const pad = useSheetBottomPad();
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" accessibilityLabel={t("common.close")} onPress={onClose} />
        <View className="max-h-[88%] rounded-t-2xl border-t border-border bg-card" style={{ paddingBottom: pad }}>
          <View className="items-center pt-2">
            <View className="h-1 w-9 rounded-full bg-border" />
          </View>
          {/* Side padding on the content, not the ScrollView: iOS shifts a vertical
              ScrollView's content sideways by its own padding in an RTL layout.
              17.5 is what `px-5` gave (NativeWind's native rem is 14). */}
          <ScrollView contentContainerStyle={{ paddingHorizontal: 17.5, paddingTop: 10, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function SheetTitle({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const { tokens } = useColorTheme();
  const t = useT();
  return (
    <View>
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-base text-foreground" style={{ fontFamily: fonts.bold }}>{title}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common.close")} hitSlop={10} onPress={onClose}>
          <Icon name="close" size={18} color={tokens.mutedForeground} />
        </Pressable>
      </View>
      {subtitle ? <Text className="mt-1 text-[11px] text-muted-foreground">{subtitle}</Text> : null}
    </View>
  );
}

export function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <View className="flex-row items-end justify-between">
      <Text className="text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
        {children}
      </Text>
      {hint ? <Text className="text-[10px] text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}

export function Segmented({ options, value, onChange, testID, disabled }: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  testID?: string;
  /** Freezes every option (e.g. while a purchase runs). */
  disabled?: boolean;
}) {
  return (
    <View className={"flex-row gap-0.5 rounded-xl bg-muted p-0.5" + (disabled ? " opacity-60" : "")} testID={testID}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`${testID ?? "seg"}-${o.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => {
              if (!disabled) onChange(o.key);
            }}
            className={"flex-1 items-center rounded-[10px] py-2 " + (on ? "bg-card" : "")}
          >
            <Text
              className={"text-xs " + (on ? "text-foreground" : "text-muted-foreground")}
              style={{ fontFamily: on ? fonts.bold : fonts.regular }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ExpiryPicker({ choices, value, onChange, isLocked, lockedHint }: {
  choices: ExpiryChoice[];
  value: string;
  onChange: (key: string) => void;
  /**
   * Choices the creator's plan cannot have (the Free 7-day cap). They stay in
   * the row, dimmed and untappable with a lock, so the ceiling is visible
   * rather than discovered after the server quietly shortens the link.
   */
  isLocked?: (choice: ExpiryChoice) => boolean;
  /** Read out for a locked chip's lock. */
  lockedHint?: string;
}) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row flex-wrap gap-1.5" testID="expiry-picker">
      {choices.map((c) => {
        const on = c.key === value;
        const locked = !!isLocked?.(c);
        return (
          <Pressable
            key={c.key}
            testID={`expiry-${c.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: locked }}
            accessibilityHint={locked ? lockedHint : undefined}
            disabled={locked}
            onPress={() => onChange(c.key)}
            className={"flex-row items-center gap-1 rounded-full border px-3 py-1.5 " + (on ? "border-primary bg-primary" : "border-border")}
            style={locked ? { opacity: 0.5 } : undefined}
          >
            <Text
              className={"text-xs " + (on ? "text-primary-foreground" : "text-muted-foreground")}
              style={{ fontFamily: on ? fonts.bold : fonts.regular }}
            >
              {c.label}
            </Text>
            {locked ? (
              <View accessible accessibilityLabel={lockedHint} testID={`expiry-${c.key}-lock`}>
                <Icon name="lock-closed" size={10} color={on ? tokens.primaryForeground : tokens.mutedForeground} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The line under a Free creator's expiry choices naming the cap. No upgrade
 * link, like every other plan gate in the app (AiSearchSection, live chat):
 * plans are bought on the web and the stores allow no in-app path to it.
 */
export function FreeExpiryHint({ text }: { text: string }) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row items-center gap-1" testID="free-expiry-hint">
      <Icon name="lock-closed" size={10} color={tokens.mutedForeground} />
      <Text className="flex-1 text-[11px] text-muted-foreground">{text}</Text>
    </View>
  );
}

export function ToggleRow({ icon, label, hint, value, onChange, testID }: {
  icon: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row items-start gap-3">
      <Icon name={icon as never} size={16} color={tokens.mutedForeground} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text className="text-sm text-foreground">{label}</Text>
        {hint ? <Text className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} testID={testID} />
    </View>
  );
}

/** An advisory line - never an error, never a blocker. */
export function Notice({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "info" }) {
  const { tokens } = useColorTheme();
  const color = tone === "warn" ? "#a86000" : tokens.mutedForeground;
  return (
    <View className="flex-row gap-2 rounded-lg px-3 py-2.5" style={{ backgroundColor: tone === "warn" ? "#a8600018" : tokens.muted }}>
      <Icon name={tone === "warn" ? "alert-circle-outline" : "information-circle-outline"} size={14} color={color} style={{ marginTop: 1 }} />
      <Text className="flex-1 text-[11px] leading-4" style={{ color }}>{children}</Text>
    </View>
  );
}

export function EmailChips({ emails, onRemove }: { emails: string[]; onRemove: (email: string) => void }) {
  const { tokens } = useColorTheme();
  const t = useT();
  if (emails.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {emails.map((e) => (
        <View key={e} className="flex-row items-center gap-1.5 rounded-full bg-muted py-1 ps-3 pe-1.5">
          <Text className="text-xs text-foreground">{e}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.accessibility.removeMName", { mName: e })}
            testID={`remove-${e}`}
            hitSlop={6}
            onPress={() => onRemove(e)}
          >
            <Icon name="close" size={12} color={tokens.mutedForeground} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}
