import { memo } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatBytes, formatDate } from "./format";
import { FileThumb } from "./FileThumb";
import { DownloadRing } from "./DownloadRing";
import { useDownloadStore } from "./downloadStore";
import { ringLabel, ringState } from "./downloadModel";
import type { FileItem } from "./types";
import { isKnownLocked } from "./lock";
import { isLiveStill, isLiveTwin } from "./livePhotos";
import { rtlLine, useT } from "@/lib/i18n";
import { SelectCheck } from "./SelectCheck";
import { LONG_PRESS_MS } from "./dragTiming";
import type { DragHandle } from "./dragHandle";
import { OfflineFileBadge } from "@/offline/ui/OfflineBadge";

const noop = () => {};

/** Memoised: a tap in selection mode re-renders this row only, given stable callbacks from the caller. */
export const FileRow = memo(function FileRow({ file, onPress, onMore, selectable, checks, selected, onToggleSelect, drag, row }: {
  file: FileItem; onPress: () => void; onMore?: () => void;
  /** Selection mode: a tap toggles instead of opening, a check replaces the more button. */
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
  /** Check circle mounted (defaults to `selectable`); stays true through the selection exit fade. */
  checks?: boolean;
  /** Hold to drag; see useDragMove. */
  drag?: DragHandle;
  /** Position in the list, for the check circles' entrance wave. */
  row?: number;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  // List view is where a Live Photo stops being one tile and becomes two rows
  // (the grid collapses it; see FileBrowser). Without these the pair reads as
  // an unrelated photo and video that happen to sort next to each other: the
  // still says it has motion, and the video is indented under it and named for
  // what it is rather than looking like a three-second clip somebody filmed.
  const still = isLiveStill(file);
  const twin = isLiveTwin(file);
  // A transfer belongs to the FILE, not to the screen that started it, so the
  // row reports one whether or not the viewer that began it is still open.
  const download = useDownloadStore((s) => s.entries[file.id]);
  const dl = ringState(download);

  const body = (
    <View testID={drag ? `drag-file-${file.id}` : undefined} collapsable={false}>
      <Pressable
        onPress={selectable ? onToggleSelect : onPress}
        // With a drag handle the hold belongs to the gesture; the no-op keeps
        // Pressable from firing onPress when the finger lifts after a hold.
        onLongPress={drag ? noop : undefined}
        delayLongPress={drag ? LONG_PRESS_MS : undefined}
        accessibilityState={selectable ? { selected: !!selected } : undefined}
        className={`flex-row items-center gap-3 py-3 border-b border-border ${twin ? "ps-11 pe-5" : "px-5"} ${selected ? "bg-primary/10" : ""}`}
        testID={twin ? `live-twin-row-${file.id}` : undefined}
      >
        {(checks ?? selectable) ? <SelectCheck selected={!!selected} testID={`select-${file.id}`} row={row} /> : null}
        {/* The ring takes the thumbnail's slot, so the row neither grows nor reorders. */}
        {dl === "idle" ? (
          <FileThumb file={file} variant="list" />
        ) : (
          <View className="h-10 w-10 items-center justify-center">
            <DownloadRing entry={download} size={40} />
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <Text className="text-base text-foreground shrink" numberOfLines={1}>{file.name}</Text>
            {still ? (
              <Text
                testID={`live-pill-${file.id}`}
                className="font-mono text-[10px] uppercase tracking-wider"
                style={{ color: tokens.brandText }}
              >
                {t("common.label.live")}
              </Text>
            ) : null}
          </View>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {twin
              ? t("common.label.livePhotoVideo")
              : dl === "idle"
                ? rtlLine(`${formatBytes(file.size_bytes)} · ${formatDate(file.created_at)}`)
                : rtlLine(`${ringLabel(dl)} · ${formatBytes(file.size_bytes)}`)}
          </Text>
        </View>
        <OfflineFileBadge fileId={file.id} />
        {isKnownLocked(file) ? <Icon name="lock-closed" size={16} color={tokens.mutedForeground} /> : null}
        {file.is_hidden ? <Icon name="eye-off" size={16} color={tokens.mutedForeground} testID={`hidden-${file.id}`} /> : null}
        {file.share_count > 0 ? <Icon name="link" size={16} color={tokens.mutedForeground} /> : null}
        {onMore && !selectable ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onMore} testID={`more-${file.id}`}>
            <Icon name="ellipsis-horizontal" size={20} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
  return drag ? <GestureDetector gesture={drag.gesture}>{body}</GestureDetector> : body;
});
