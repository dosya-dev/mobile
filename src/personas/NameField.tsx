// Inline name editor for a persona. Ported from the desktop's
// components/personas/NameField.tsx (from apps/web/src/components/personas/name-field.tsx)
// - keep in step.
//
// Done on the keyboard (or the tick) saves through the engine's rename
// (journaled, so the user's other devices get the name); the cross cancels.
// A taken or invalid name keeps the field open with the reason under it. An
// empty name is refused here before the engine is asked.
import { useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import type { PersonasEngine } from "@dosya-dev/personas-engine";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { inputStartAlign } from "@/lib/direction";
import { useT } from "@/lib/i18n";
import { personasErrorCode } from "./api";

/** Longest name the engine accepts. */
export const NAME_MAX = 60;

export interface PersonaNameFieldProps {
  engine: Pick<PersonasEngine, "rename">;
  personaId: string;
  initial: string;
  onSaved: () => void;
  onCancel: () => void;
  testID?: string;
}

export function PersonaNameField({ engine, personaId, initial, onSaved, onCancel, testID = "persona-name" }: PersonaNameFieldProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    const name = value.trim();
    if (!name) { setError(t("personas.error.typeAName")); return; }
    if (name === initial.trim()) { onCancel(); return; }
    setSaving(true);
    setError(null);
    try {
      await engine.rename(personaId, name);
      onSaved();
    } catch (err) {
      const code = personasErrorCode(err);
      setError(
        code === "name_taken" ? t("personas.error.nameTaken")
          : code === "name_invalid" ? t("personas.error.nameInvalid")
          : t("personas.error.couldNotSaveName"),
      );
      setSaving(false);
    }
  };

  return (
    <View className="w-full" testID={testID}>
      <View className="flex-row items-center gap-1">
        <TextInput
          testID={`${testID}-input`}
          autoFocus
          value={value}
          maxLength={NAME_MAX}
          editable={!saving}
          placeholder={t("personas.label.name")}
          placeholderTextColor={tokens.mutedForeground}
          accessibilityLabel={t("personas.label.name")}
          autoCapitalize="words"
          returnKeyType="done"
          onChangeText={(v) => { setValue(v); setError(null); }}
          onSubmitEditing={() => void save()}
          className={"min-h-[44px] flex-1 rounded-lg border bg-card px-3 text-foreground " + (error ? "border-destructive" : "border-border")}
          style={{ fontFamily: fonts.regular, fontSize: 15, ...inputStartAlign() }}
        />
        <Pressable
          testID={`${testID}-save`}
          accessibilityRole="button"
          accessibilityLabel={t("common.save")}
          disabled={saving}
          onPress={() => void save()}
          className="h-11 w-11 items-center justify-center rounded-lg"
        >
          {saving ? <ActivityIndicator size="small" /> : <Icon name="checkmark" size={22} color={tokens.primary} />}
        </Pressable>
        <Pressable
          testID={`${testID}-cancel`}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
          disabled={saving}
          onPress={onCancel}
          className="h-11 w-11 items-center justify-center rounded-lg"
        >
          <Icon name="close" size={22} color={tokens.mutedForeground} />
        </Pressable>
      </View>
      {error ? (
        <Text testID={`${testID}-error`} className="mt-1 text-xs text-destructive" accessibilityLiveRegion="polite">{error}</Text>
      ) : null}
    </View>
  );
}
