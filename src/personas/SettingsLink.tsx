// The header's way into Personas settings, on /personas and on a persona's
// screen. Personas settings are each member's own, so it shows for everyone.
import { Pressable } from "react-native";
import { Icon } from "@/ui/Icon";
import { useT } from "@/lib/i18n";

/** The header's way into Personas settings (here and on a persona's screen). */
export function SettingsLink({ onPress, color }: { onPress: () => void; color: string }) {
  const t = useT();
  return (
    <Pressable
      testID="personas-settings-link"
      accessibilityRole="button"
      accessibilityLabel={t("personas.action.personasSettings")}
      hitSlop={10}
      onPress={onPress}
      className="min-h-[44px] min-w-[44px] items-center justify-center"
    >
      <Icon name="settings-outline" size={22} color={color} />
    </Pressable>
  );
}

