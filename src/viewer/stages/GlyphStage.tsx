import { View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { fileKind, isArchiveName, kindLabel } from "@/files/format";
import type { StagePalette } from "../stageTheme";

const GLYPH: Record<ReturnType<typeof fileKind>, IconName> = {
  image: "image-outline",
  video: "videocam-outline",
  audio: "musical-notes-outline",
  pdf: "document-text-outline", office: "document-attach-outline",
  text: "document-outline",
  book: "book-outline",
  other: "document-outline",
};

const ARCHIVE_EXTS = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i;

/**
 * The stage for the cases with nothing to render: an unsupported type, a text
 * body over the inline cap, a preview that failed, and an image this phone's
 * decoder refused.
 *
 * They used to be a centred grey sentence. They still say the same things,
 * but they say what the file IS first, and each one ends with the single
 * action that helps - which is the part that was missing.
 *
 * "undecodable" is distinct from "error" on purpose: "your connection may
 * have dropped" invites a retry that cannot help when the real problem is an
 * Android phone that has no TIFF decoder. Naming the format tells the user
 * which app to open instead.
 */
export function GlyphStage(props: {
  variant: "none" | "too-large" | "error" | "undecodable";
  name: string;
  mimeType: string;
  extension: string | null;
  /** Pre-formatted, e.g. "412 MB" - only used by the too-large copy. */
  sizeLabel?: string;
  palette: StagePalette;
}) {
  const t = useT();
  const kind = fileKind(props.mimeType, props.extension);
  // Broad on purpose - a .rar or .7z really is an archive and gets the
  // archive glyph, even though this app can't browse into one.
  const isArchive = ARCHIVE_EXTS.test(props.name);
  // Narrower: the SAME zip-only predicate that gates the "Browse contents"
  // primary action in viewerModel.ts's primaryAction(). Gating the message
  // on the broader ARCHIVE_EXTS regex above said "Browse this archive
  // without saving it" for a .rar/.7z/.tar too, promising a button that
  // isn't there - archiveTree.ts addresses entries by central-directory
  // index, a concept those formats don't have, and the server's index
  // endpoint refuses anything that isn't a zip.
  const browsable = isArchiveName(props.name);

  const glyph: IconName =
    props.variant === "error" ? "alert-circle-outline" : isArchive ? "archive-outline" : GLYPH[kind];

  const label =
    props.variant === "error" ? t("files.error.couldNotLoad") : kindLabel(props.mimeType, props.extension);

  const message =
    props.variant === "error"
      ? t("files.description.thePreviewDidNotComeThroughYourConnectionMayHaveDropped")
      : props.variant === "undecodable"
        ? t("files.error.thisPhoneCouldnTDisplayItItMayHaveNoKindLabelDecoderSaveIt", { kindLabel: kindLabel(props.mimeType, props.extension) })
        : props.variant === "too-large"
          ? t("files.description.hassizeSelectTrueSizeOtherThisFileIsTooLargeToPreviewHereSave", { hasSize: props.sizeLabel ? "true" : "false", size: props.sizeLabel ?? "" })
          : browsable
            // The "Browse contents" primary action sits right beneath this
            // stage - "save it to open elsewhere" would contradict a button
            // that opens it right here.
            ? t("files.description.browseThisArchiveWithoutSavingIt")
            : t("files.description.noPreviewForThisTypeSaveItToYourPhoneToOpenItIn");

  const accent = props.variant === "error" ? "#f2565f" : props.palette.fgMuted;

  return (
    <View className="flex-1 items-center justify-center gap-4 px-10">
      <View
        testID="glyph-stage-disc"
        className="h-28 w-28 items-center justify-center rounded-[28px] border"
        style={{ backgroundColor: props.palette.chrome, borderColor: props.palette.hairline }}
      >
        <Icon name={glyph} size={48} color={accent} />
      </View>
      <Text
        className="text-xs uppercase"
        style={{ fontFamily: fonts.mono, letterSpacing: 2, color: accent }}
      >
        {label}
      </Text>
      <Text className="max-w-[260px] text-center text-sm leading-5" style={{ color: props.palette.fgMuted }}>
        {message}
      </Text>
    </View>
  );
}
