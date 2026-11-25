import { useMemo } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { documentDir } from "@/lib/text-direction";
import { kindLabel } from "@/files/format";
import { parseCsvTable } from "../csvTable";
import { TextStage } from "./TextStage";
import { localDigits } from "@/lib/format-locale";

/** Wide enough for a date or an amount, narrow enough for four columns. */
const MIN_COL_WIDTH = 72;
const MAX_COL_WIDTH = 208;
/** Mono at 11px runs ~6.6px per character; 7 leaves breathing room. */
const PX_PER_CHAR = 7;

/**
 * A CSV as the table it is, instead of a wall of commas.
 *
 * Same card language as TextStage - the strip on top says what and how much,
 * the body follows the app theme because it is content the user reads. The
 * table scrolls both ways; column widths come from the longest value in the
 * first rows, clamped so one essay-length cell cannot push every other
 * column off screen.
 *
 * Anything the parser deems not-really-a-table falls back to the plain text
 * card, which renders degenerate shapes (single column, no delimiter) fine.
 */
export function CsvStage(props: {
  text: string | null;
  mimeType: string;
  extension: string | null;
  mutedColor: string;
}) {
  const t = useT();
  const table = useMemo(() => (props.text == null ? null : parseCsvTable(props.text)), [props.text]);

  const widths = useMemo(() => {
    if (!table) return [];
    // The header plus the first slice of rows is enough signal; measuring
    // all 300 renderable rows would cost layout time for identical answers.
    const sample = [table.header, ...table.rows.slice(0, 20)];
    return Array.from({ length: table.columns }, (_, c) => {
      const longest = Math.max(...sample.map((r) => (r[c] ?? "").length));
      return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, longest * PX_PER_CHAR));
    });
  }, [table]);

  if (props.text == null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={props.mutedColor} />
      </View>
    );
  }

  if (!table) {
    return (
      <TextStage
        text={props.text}
        mimeType={props.mimeType}
        extension={props.extension}
        mutedColor={props.mutedColor}
      />
    );
  }

  const totalRows = table.rows.length + table.truncatedRows;

  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="max-h-full w-full overflow-hidden rounded-xl border border-border bg-card">
        <View className="flex-row items-center gap-2 border-b border-border px-3 py-2.5">
          <Icon name="grid-outline" size={13} color={props.mutedColor} />
          <Text className="text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1 }}>
            {kindLabel(props.mimeType, props.extension)}
          </Text>
          <Text className="ms-auto text-[10px] text-muted-foreground" style={{ fontFamily: fonts.mono }}>
            {t("files.label.totalrowsPluralOneRowOtherRowsXColumnsCols", { totalRows, columns: localDigits(table.columns) })}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ direction: documentDir(props.text) }}>
          <ScrollView testID="csv-stage-body" className="max-h-[440px]" nestedScrollEnabled>
            <View className="flex-row border-b border-border bg-muted px-3 py-2">
              {table.header.map((cell, c) => (
                <Text
                  key={c}
                  numberOfLines={1}
                  className="pe-3 text-[11px] font-bold text-foreground"
                  style={{ width: widths[c], fontFamily: fonts.mono }}
                >
                  {cell}
                </Text>
              ))}
            </View>
            {table.rows.map((row, r) => (
              <View key={r} className="flex-row border-b border-border px-3 py-1.5">
                {row.map((cell, c) => (
                  <Text
                    key={c}
                    numberOfLines={1}
                    className="pe-3 text-[11px] text-foreground"
                    style={{ width: widths[c], fontFamily: fonts.mono }}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ))}
            {table.truncatedRows > 0 ? (
              <Text className="px-3 py-2.5 text-[10px] text-muted-foreground" style={{ fontFamily: fonts.mono }}>
                {t("files.description.truncatedrowsMoreTruncatedRowsPluralOneRowOtherRowsSaveTheFileForAllOf", { truncatedRows: table.truncatedRows })}
              </Text>
            ) : null}
          </ScrollView>
        </ScrollView>
      </View>
    </View>
  );
}
