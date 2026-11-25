import { View } from "react-native";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { baseName } from "@/files/format";
import { coverPalette } from "./bookCover";
import type { StagePalette } from "../stageTheme";
import { localDigits } from "@/lib/format-locale";

/**
 * A book, as a cover rather than an outline glyph.
 *
 * The title is the filename with its extension dropped, and the wash is
 * derived from the file id so a given book always looks the same. The progress
 * bar along the bottom edge is the reader's own saved position - it already
 * exists per file and nothing surfaced it outside the reader.
 */
export function BookStage(props: {
  fileId: string;
  name: string;
  /** 0-1, from the saved reading state. */
  percent?: number | null;
  palette: StagePalette;
}) {
  const t = useT();
  const cover = coverPalette(props.fileId);
  const pct = Math.max(0, Math.min(1, props.percent ?? 0));

  return (
    <View className="flex-1 items-center justify-center">
      <View
        testID="book-cover"
        // rtl-ok: book art (the spine is on the left of a cover in every language)
        className="h-[318px] w-[212px] justify-end overflow-hidden rounded-l-[4px] rounded-r-[10px] p-6"
        style={{ backgroundColor: cover.from }}
      >
        {/* The wash: a second colour laid over the base as a soft bottom half.
            RN has no CSS gradient, and pulling in a gradient dependency for one
            decorative surface is not worth a native rebuild. */}
        <View
          className="absolute inset-x-0 bottom-0 h-2/3"
          style={{ backgroundColor: cover.to, opacity: 0.55 }}
          pointerEvents="none"
        />
        {/* The spine. */}
        <View
          // rtl-ok: book art (the spine strip follows the cover's left edge)
          className="absolute bottom-0 left-0 top-0 w-[9px]"
          style={{ backgroundColor: "rgba(0,0,0,0.26)" }}
          pointerEvents="none"
        />
        <Text
          className="text-[21px] font-bold leading-6 text-white"
          numberOfLines={4}
        >
          {baseName(props.name)}
        </Text>
        <Text
          className="mt-2 text-[10.5px] uppercase"
          numberOfLines={1}
          style={{ fontFamily: fonts.mono, letterSpacing: 1.3, color: "rgba(255,255,255,0.72)" }}
        >
          {pct > 0 ? t("files.label.percentRead", { percent: localDigits(Math.round(pct * 100)) }) : t("files.status.notStarted")}
        </Text>
        {pct > 0 ? (
          <View
            testID="book-progress"
            className="absolute inset-x-0 bottom-0 h-1"
            style={{ backgroundColor: "rgba(255,255,255,0.22)" }}
          >
            <View className="h-full bg-primary" style={{ width: `${pct * 100}%` }} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
