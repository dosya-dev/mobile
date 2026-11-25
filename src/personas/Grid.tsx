// The Personas grid: named personas first, then the groups nobody has named
// yet, each with "Add a name" (inline rename through the engine). Ported from
// the desktop's components/personas/Grid.tsx (from apps/web/src/pages/personas/grid.tsx,
// design-ref Main) - keep the behaviour and copy in step.
//
// The engine decides what is shown (at least 3 faces for an unnamed group, 1
// for a named one). A saved name reaches the list through the engine's
// change notice. "Personas settings" is the screen header's
// (app/personas/index.tsx), so it is there with the empty state too.
//
// Three tiles a row: the tile width is a share of the row, not a fixed size,
// so a large font scale wraps the name and the count rather than clipping.
//
// While photos are still being read (`reading`), a dashed "More coming" tile
// closes the not-named section (progress-card MobileReading artboard).
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import type { PersonasEngine } from "@dosya-dev/personas-engine";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatNumber } from "@/lib/format-locale";
import { isolateInRtl, useT } from "@/lib/i18n";
import { personaHref, type PersonaCard } from "./api";
import { FaceAvatar } from "./FaceAvatar";
import { PersonaNameField } from "./NameField";

export interface PersonasGridProps {
  engine: Pick<PersonasEngine, "rename">;
  personas: PersonaCard[];
  /** Photos are still being read: a "More coming" tile ends the not-named section. */
  reading?: boolean;
  /** A name was saved. */
  onChanged?: () => void;
}

/** Three a row. */
const TILE = { width: "33.333%" as const };

export function PersonasGrid({ engine, personas, reading = false, onChanged }: PersonasGridProps) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const named = personas.filter((p) => p.name);
  const unnamed = personas.filter((p) => !p.name);
  const photos = (n: number) => t("files.label.countPluralOnePhotoOtherPhotos", { count: n });

  return (
    <View className="gap-7 px-5 pb-10" testID="personas-grid">
      {named.length > 0 ? (
        <View testID="personas-named">
          <SectionHeading title={t("personas.heading.named")} count={named.length} />
          <View className="-mx-1.5 flex-row flex-wrap">
            {named.map((p) => (
              <View key={p.id} style={TILE} className="p-1.5">
                <Pressable
                  testID={`persona-tile-${p.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${photos(p.photo_count)}`}
                  onPress={() => router.push(personaHref(p.id))}
                  className="items-center gap-2 rounded-xl py-2"
                >
                  <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={p.name} size={84} />
                  <Text className="w-full text-center text-sm text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={2}>
                    {isolateInRtl(p.name ?? "")}
                  </Text>
                  <Text className="-mt-1 text-center text-xs text-muted-foreground">{photos(p.photo_count)}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {unnamed.length > 0 || reading ? (
        <View testID="personas-unnamed">
          <SectionHeading title={t("personas.heading.notNamedYet")} count={unnamed.length > 0 ? unnamed.length : null} />
          <Text className="-mt-2 mb-3 text-xs text-muted-foreground">{t("personas.description.addANameToFindThemInSearch")}</Text>
          <View className="-mx-1 flex-row flex-wrap">
            {unnamed.map((p) => <UnnamedCard key={p.id} engine={engine} persona={p} onChanged={onChanged} />)}
            {reading ? (
              <View style={TILE} className="p-1" testID="personas-more-coming">
                <View className="min-h-[136px] items-center justify-center gap-2 rounded-xl border border-dashed border-border p-3">
                  {/* Decorative: the "More coming" text says it; the spinner is hidden from screen readers. */}
                  <View
                    className="h-16 w-16 items-center justify-center rounded-full border border-dashed border-border"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <ActivityIndicator color={tokens.mutedForeground} />
                  </View>
                  <Text className="text-center text-xs text-muted-foreground">{t("personas.label.moreComing")}</Text>
                </View>
              </View>
            ) : null}
          </View>
          <Text className="mt-4 text-xs text-muted-foreground">{t("personas.description.aFaceNeedsToAppearInAtLeastThreePhotos")}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SectionHeading({ title, count }: { title: string; count: number | null }) {
  return (
    <View className="mb-3 flex-row items-center gap-2">
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }} accessibilityRole="header">{title}</Text>
      {count !== null ? <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.medium }}>{formatNumber(count)}</Text> : null}
    </View>
  );
}

function UnnamedCard({ engine, persona: p, onChanged }: { engine: Pick<PersonasEngine, "rename">; persona: PersonaCard; onChanged?: () => void }) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const [editing, setEditing] = useState(false);
  const photos = t("files.label.countPluralOnePhotoOtherPhotos", { count: p.photo_count });

  // The field needs the row: a third of the screen is too narrow for a name.
  return (
    <View style={editing ? undefined : TILE} className={editing ? "w-full p-1" : "p-1"}>
      <View className="items-center gap-2 rounded-xl border border-border bg-card p-3" testID={`persona-card-${p.id}`}>
        <Pressable
          testID={`persona-tile-${p.id}`}
          accessibilityRole="button"
          accessibilityLabel={`${t("common.label.unnamed")}, ${photos}`}
          onPress={() => router.push(personaHref(p.id))}
          className="items-center gap-2"
        >
          <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={null} size={64} />
          <Text className="text-xs text-muted-foreground">{photos}</Text>
        </Pressable>
        {editing ? (
          <PersonaNameField
            engine={engine}
            personaId={p.id}
            initial=""
            onSaved={() => { setEditing(false); onChanged?.(); }}
            onCancel={() => setEditing(false)}
            testID={`persona-name-${p.id}`}
          />
        ) : (
          <Pressable
            testID={`persona-add-name-${p.id}`}
            accessibilityRole="button"
            accessibilityLabel={t("personas.action.addAName")}
            onPress={() => setEditing(true)}
            className="min-h-[44px] flex-row items-center justify-center gap-1 rounded-lg px-2"
          >
            <Icon name="add" size={14} color={tokens.primary} />
            <Text className="text-xs text-primary" style={{ fontFamily: fonts.medium }}>{t("personas.action.addAName")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
