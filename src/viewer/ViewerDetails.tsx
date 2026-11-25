import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { FileThumb } from "@/files/FileThumb";
import type { FileItem } from "@/files/types";
import type { DetailRow } from "./viewerModel";

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      className="mb-2 text-[9.5px] uppercase text-muted-foreground"
      style={{ fontFamily: fonts.mono, letterSpacing: 1.5 }}
    >
      {children}
    </Text>
  );
}

/**
 * The pull-up record: the file's properties, then its neighbours.
 *
 * Everything here was already on the wire. `GET /api/files/:id` has always
 * selected region, uploader_name, folder_id and the share count; mobile's
 * FileItem type just never declared them, so they arrived and were discarded.
 * No endpoint changed to build this panel.
 */
export function ViewerDetails(props: {
  rows: DetailRow[];
  neighbours: FileItem[];
  currentId: string;
  onSelect: (file: FileItem) => void;
  /**
   * "In this photo": the people chips (src/personas/PeopleChips) for a photo
   * from this phone's Personas. Mounted only with the record, so the engine is
   * not touched until the sheet is pulled up; the chips stay silent while
   * Personas is not ready and on any failure.
   */
  people?: ReactNode;
}) {
  const t = useT();
  const showStrip = props.neighbours.length > 1;

  return (
    <View testID="viewer-details" className="mt-4 border-t border-border pt-3.5">
      {props.people}
      <SectionLabel>{t("files.heading.details")}</SectionLabel>
      <View>
        {props.rows.map((row) => (
          <View key={row.label} className="flex-row justify-between gap-3.5 py-1.5">
            <Text className="text-[12.5px] text-muted-foreground">{row.label}</Text>
            <Text className="flex-1 text-right text-[12.5px] font-medium text-foreground" numberOfLines={1}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>

      {showStrip ? (
        <View className="mt-3.5">
          <SectionLabel>{t("files.heading.inThisFolder")}</SectionLabel>
          <ScrollView
            testID="viewer-filmstrip"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2 pe-4"
          >
            {props.neighbours.map((f) => {
              const current = f.id === props.currentId;
              return (
                <Pressable
                  key={f.id}
                  testID={`filmstrip-${f.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={f.name}
                  accessibilityState={{ selected: current }}
                  onPress={() => props.onSelect(f)}
                  className={
                    "h-[50px] w-[50px] overflow-hidden rounded-lg border-2 " +
                    (current ? "border-primary" : "border-transparent")
                  }
                >
                  <FileThumb file={f} variant="grid" />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
