import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Pdf from "react-native-pdf";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import type { StagePalette } from "../stageTheme";
import { localDigits } from "@/lib/format-locale";

/**
 * A PDF, rendered on the stage on BOTH platforms.
 *
 * The screen this replaces reached for a WebView and guarded it with
 * `Platform.OS === "ios"`, so every PDF in the account fell through to
 * "Preview not available" on Android. react-native-pdf renders natively on
 * both and is already a dependency - the reader route uses it - so this fixes
 * the gap without adding anything.
 *
 * Scrolling here is vertical only, which leaves the horizontal axis to the
 * file pager; the two gestures do not compete.
 */
export function PdfStage(props: {
  uri: string;
  /** False for a restricted file: react-native-pdf writes the document to disk. */
  cache?: boolean;
  headers?: Record<string, string>;
  palette: StagePalette;
  onPageCount?: (count: number) => void;
  onTap?: () => void;
  onFailed?: () => void;
}) {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);

  return (
    // PdfProps has no testID, so the stage is identified by its wrapper.
    <View className="flex-1" testID="pdf-stage">
      <Pdf
        source={{ uri: props.uri, cache: props.cache ?? true, ...(props.headers ? { headers: props.headers } : {}) }}
        style={{ flex: 1, backgroundColor: props.palette.bg }}
        trustAllCerts={false}
        onLoadComplete={(count: number) => {
          setReady(true);
          setPageCount(count);
          props.onPageCount?.(count);
        }}
        onPageChanged={(p: number, count: number) => {
          setPage(p);
          setPageCount(count);
        }}
        onPageSingleTap={() => props.onTap?.()}
        onError={() => props.onFailed?.()}
      />
      {!ready ? (
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          <ActivityIndicator color={props.palette.fgMuted} />
        </View>
      ) : null}
      {pageCount > 0 ? (
        <View
          testID="pdf-page-tag"
          className="absolute bottom-5 self-center rounded-full px-3 py-1.5"
          style={{ backgroundColor: "rgba(10,16,22,0.62)" }}
          pointerEvents="none"
        >
          <Text className="text-xs" style={{ color: props.palette.fg }}>
            {t("common.label.pagePageOfPageCount", { page: localDigits(page), pageCount: localDigits(pageCount) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
