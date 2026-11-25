// apps/mobile/src/archive/ArchiveList.tsx
//
// One directory level at a time. Mobile drills in rather than showing an
// inline tree: tapping a folder pushes a screen, which is what a FlatList
// does well and what the platform's back gesture already understands.
//
// Deviation from the plan's sketch: a file row's icon comes from the same
// fileKind → glyph vocabulary FileThumb and GlyphStage already draw from,
// not a colored letter-tile keyed by extension. This app has no such colour
// map to reuse - inventing one here would be exactly the second map the plan
// warned against - so the icon rides the vocabulary that already exists.
//
// An entry is addressed by its central-directory INDEX, never by its path -
// callers pass the TreeNode straight through to onOpenFile/onOpenDir, so
// nothing here ever reconstructs a path to look an entry up by name.
import { FlatList, Pressable, View } from "react-native";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { fileKind, formatBytes } from "@/files/format";
import type { TreeNode } from "./archiveTree";

/** Compression methods the server will actually stream (store and deflate). */
const OPENABLE_METHODS = new Set([0, 8]);

const ICON: Record<ReturnType<typeof fileKind>, IconName> = {
  image: "image-outline",
  video: "videocam-outline",
  audio: "musical-notes-outline",
  pdf: "document-text-outline",
  office: "document-attach-outline",
  text: "document-outline",
  book: "book-outline",
  other: "document-outline",
};

function extOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : null;
}

// fileKind's extension fallback only covers image/book/text/office (see
// format.ts) - video, audio and pdf are detected by MIME there, and an
// archive entry has none. Rather than widen fileKind itself (it drives real
// routing decisions elsewhere in the app, and a wider fallback there could
// change behaviour on screens outside this feature), this is a small,
// local, icon-only extension check that fills the gap for the three kinds
// fileKind can't guess from a bare extension. Same extensions kindLabel
// already recognises for these kinds (format.ts's own `named` map).
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "mka"]);

/** Exported for direct testing - Ionicons' own async font-load lifecycle
 * makes asserting a rendered icon's `name` prop flaky under Jest. */
export function iconKind(name: string): ReturnType<typeof fileKind> {
  const ext = (extOf(name) ?? "").toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return fileKind("", ext);
}

export function ArchiveList(props: {
  nodes: TreeNode[];
  onOpenDir: (node: TreeNode) => void;
  onOpenFile: (node: TreeNode) => void;
  /** Save this folder or file into dosya. Absent when the screen cannot offer it. */
  onSave?: (node: TreeNode) => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();

  return (
    <FlatList
      data={props.nodes}
      keyExtractor={(n) => `${n.kind}:${n.name}:${n.index ?? "d"}`}
      style={{ backgroundColor: tokens.card }}
      renderItem={({ item }) => {
        const isDir = item.kind === "dir";
        const unsupportedMethod = !isDir && !item.encrypted && !OPENABLE_METHODS.has(item.method);
        const openable = isDir || (!item.encrypted && !unsupportedMethod);
        // mutedForeground, never opacity: opacity drops text under the AA
        // floor this project publishes.
        const nameColor = openable ? tokens.foreground : tokens.mutedForeground;
        const subtitle = isDir
          ? t("common.label.item", { count: item.fileCount })
          : item.encrypted
            ? t("archive.status.passwordProtected")
            : unsupportedMethod
              ? t("archive.error.unsupportedCompression")
              : formatBytes(item.size);
        // Encrypted and unsupported-method both need an accessible reason, not
        // just muted text - a screen reader user gets nothing from colour.
        const reason = item.encrypted
          ? t("archive.error.thisEntryIsPasswordProtectedAndCannotBeOpened")
          : t("archive.description.thisEntryUsesACompressionMethodThisAppCannotOpen");
        const kind = iconKind(item.name);

        return (
          <Pressable
            testID={isDir ? `archive-dir-${item.name}` : `archive-entry-${item.name}`}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            // disabled keeps press handling off, but the row stays in the
            // accessibility tree (RN does not drop a disabled Pressable the
            // way disabled HTML controls do) - accessibilityState makes that
            // explicit and testable, and the hint says WHY it's refused.
            accessibilityState={{ disabled: !openable }}
            accessibilityHint={openable ? undefined : reason}
            disabled={!openable}
            onPress={() => (isDir ? props.onOpenDir(item) : props.onOpenFile(item))}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              height: 56,
              paddingHorizontal: 16,
              borderBottomWidth: 1,
              borderBottomColor: tokens.border,
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: tokens.muted,
              }}
            >
              <Icon
                testID={`archive-icon-${item.name}`}
                name={isDir ? "folder-outline" : ICON[kind]}
                size={16}
                color={tokens.mutedForeground}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "500", color: nameColor }}>
                {item.name}
              </Text>
              <Text style={{ fontSize: 11, color: tokens.mutedForeground }}>{subtitle}</Text>
            </View>

            {props.onSave && openable && (
              <Pressable
                testID={`archive-save-${item.name}`}
                accessibilityRole="button"
                accessibilityLabel={t("archive.action.saveNameToDosya", { name: item.name })}
                hitSlop={8}
                onPress={() => props.onSave?.(item)}
                style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="download-outline" size={18} color={tokens.mutedForeground} />
              </Pressable>
            )}
            {isDir && <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />}
            {!isDir && item.encrypted && (
              <Icon name="lock-closed-outline" size={16} color={tokens.mutedForeground} />
            )}
            {!isDir && unsupportedMethod && (
              <Icon name="ban-outline" size={16} color={tokens.mutedForeground} />
            )}
          </Pressable>
        );
      }}
    />
  );
}
