import { View } from "react-native";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { ImageStage } from "@/viewer/stages/ImageStage";
import { VideoStage } from "@/viewer/stages/VideoStage";
import { PdfStage } from "@/viewer/stages/PdfStage";
import { stagePalette } from "@/viewer/stageTheme";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { fileKind, formatBytes } from "@/files/format";
import type { ShareFile } from "./api";

/**
 * Show the shared file, rather than describing it.
 *
 * The app has carried a full set of viewer stages the whole time - image,
 * video, pdf, audio, text, office, book - and the share screen rendered none of
 * them, so a recipient got a filename and a Download button. These three cover
 * what a link is usually pointing at; the rest fall through to a card that says
 * plainly that the file has to be downloaded to open, which is at least the
 * truth rather than a blank stage.
 *
 * The stages take a URI and optional headers and nothing else, so they work
 * against the PUBLIC share download route with no auth token - the reason they
 * can be reused here at all.
 */
export function SharePreview({ file, uri, scheme, viewOnly }: {
  file: ShareFile;
  uri: string;
  scheme: "light" | "dark";
  viewOnly: boolean;
}) {
  const palette = stagePalette(scheme);
  const kind = fileKind(file.mime_type ?? "", file.extension ?? null);

  if (kind === "image") {
    return <ImageStage uri={uri} palette={palette} cachePolicy={viewOnly ? "memory" : "memory-disk"} />;
  }
  if (kind === "video") {
    return (
      <VideoStage
        uri={uri}
        mimeType={file.mime_type ?? ""}
        extension={file.extension ?? null}
      />
    );
  }
  if (kind === "pdf") {
    // A view-only link must not leave the document on disk, which is exactly
    // what react-native-pdf's cache does.
    return <PdfStage uri={uri} palette={palette} cache={!viewOnly} />;
  }

  return <UnpreviewableCard file={file} kind={kind} />;
}

const KIND_ICON: Record<string, string> = {
  audio: "musical-notes-outline",
  text: "document-text-outline",
  book: "book-outline",
  office: "document-outline",
  other: "document-outline",
};

function UnpreviewableCard({ file, kind }: { file: ShareFile; kind: string }) {
  const t = useT();
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <Icon name={(KIND_ICON[kind] ?? "document-outline") as never} size={34} color="#8a949c" />
      <Text className="text-center text-sm" style={{ fontFamily: fonts.medium, color: "#e9f0f5" }} numberOfLines={2}>
        {file.name}
      </Text>
      <Text className="text-center text-[11px]" style={{ color: "#8a949c" }}>
        {file.size_bytes != null
          ? t("shared-link.label.sizeDownloadItToOpenThisOne", { size: formatBytes(file.size_bytes) })
          : t("shared-link.label.downloadItToOpenThisOne")}
      </Text>
    </View>
  );
}
