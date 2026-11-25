// "Merge with <name>": pick another persona that is the same person. Ported
// from the desktop's components/personas/MergeDialog.tsx (from
// apps/web/src/components/personas/merge-dialog.tsx, design-ref Merge) -
// keep the behaviour and copy in step.
//
// The engine keeps the named side's name and cover when exactly one side is
// named, so the copy says the target keeps them only when the target has a
// name. Neutral wording, no pronouns. The list and the merge are this
// phone's engine (journaled for the user's other devices).
//
// A bottom sheet: the backdrop, the Android back button and a swipe down on
// the handle or the title all close it (not while a merge is running). The
// swipe is the shared SheetHandle (src/ui/SheetHandle), which claims the touch
// at touch start so it wins inside the sheet's Pressable; the list below scrolls.
import { useMemo, useState } from "react";
import type { PersonasEngine } from "@dosya-dev/personas-engine";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Button } from "@/ui/Button";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { SheetHandle } from "@/ui/SheetHandle";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { isolateInRtl, useT } from "@/lib/i18n";
import type { PersonaCard } from "./api";
import { FaceAvatar } from "./FaceAvatar";

export interface MergeSheetProps {
  visible: boolean;
  engine: Pick<PersonasEngine, "listPersonas" | "merge">;
  target: PersonaCard;
  onClose: () => void;
  /** Called with the surviving persona id. */
  onMerged: (survivorId: string) => void;
}

export function MergeSheet({ visible, engine, target, onClose, onMerged }: MergeSheetProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const sheetPad = useSheetBottomPad();
  const [picked, setPicked] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [failed, setFailed] = useState(false);
  // Each opening starts with nothing picked and no error.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) { setPicked(null); setFailed(false); }
  }
  const options = useMemo(
    () => (visible ? engine.listPersonas().filter((p) => p.id !== target.id) : []),
    [visible, engine, target.id],
  );

  const close = () => { if (!merging) onClose(); };

  const merge = async () => {
    if (!picked || merging) return;
    setMerging(true);
    setFailed(false);
    try {
      const survivor = await engine.merge(target.id, picked);
      onMerged(survivor || target.id);
    } catch {
      setFailed(true);
    } finally {
      setMerging(false);
    }
  };

  const name = target.name;
  const named = (n: string) => isolateInRtl(n);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable className="flex-1 justify-end bg-black/40" onPress={close} accessibilityRole="button" accessibilityLabel={t("common.cancel")} testID="merge-sheet-backdrop">
        <Pressable className="max-h-[90%] rounded-t-2xl bg-background" onPress={() => {}} testID="merge-sheet" accessibilityRole="none">
          <SheetHandle onDismiss={close} testID="merge-sheet-handle">
            <Text className="mt-3 text-xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">
              {name ? t("personas.heading.mergeWithName", { name: named(name) }) : t("personas.heading.mergeWithThisPersona")}
            </Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              {name ? t("personas.description.pickThePersonaThatIsAlsoName", { name: named(name) }) : t("personas.description.pickThePersonaThatIsAlsoThisPerson")}
            </Text>
          </SheetHandle>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: sheetPad }} showsVerticalScrollIndicator={false}>

            {options.length === 0 ? (
              <Text className="mt-4 text-sm text-muted-foreground" testID="merge-empty">{t("personas.description.noOtherPersonasToMerge")}</Text>
            ) : (
              <View className="mt-4 gap-2" accessibilityRole="radiogroup" accessibilityLabel={t("personas.label.personaToMerge")}>
                {options.map((p) => {
                  const on = picked === p.id;
                  const label = p.name ?? t("common.label.unnamed");
                  return (
                    <Pressable
                      key={p.id}
                      testID={`merge-option-${p.id}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on, disabled: merging }}
                      accessibilityLabel={`${label}, ${t("files.label.countPluralOnePhotoOtherPhotos", { count: p.photo_count })}`}
                      disabled={merging}
                      onPress={() => setPicked(p.id)}
                      className={"min-h-[56px] flex-row items-center gap-3 rounded-xl border px-3 py-2 " + (on ? "border-primary bg-secondary" : "border-border bg-card")}
                    >
                      <Icon name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? tokens.primary : tokens.mutedForeground} />
                      <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={p.name} size={40} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={1}>
                          {p.name ? isolateInRtl(p.name) : label}
                        </Text>
                        <Text className="text-xs text-muted-foreground">{t("files.label.countPluralOnePhotoOtherPhotos", { count: p.photo_count })}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {failed ? (
              <Text className="mt-3 text-sm text-destructive" testID="merge-failed" accessibilityLiveRegion="polite">{t("personas.error.couldNotMerge")}</Text>
            ) : null}

            <View className="mt-5 flex-row gap-3">
              <View className="flex-1"><Button title={t("common.cancel")} variant="ghost" onPress={close} disabled={merging} testID="merge-cancel" /></View>
              <View className="flex-1">
                <Button
                  title={name ? t("personas.action.mergeIntoName", { name: named(name) }) : t("personas.action.merge")}
                  onPress={() => void merge()}
                  disabled={!picked}
                  loading={merging}
                  testID="merge-confirm"
                />
              </View>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
