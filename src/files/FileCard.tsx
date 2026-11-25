import { memo } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { FileThumb } from "./FileThumb";
import type { FileItem } from "./types";
import { isKnownLocked } from "./lock";
import { SelectCheck } from "./SelectCheck";
import { LONG_PRESS_MS } from "./dragTiming";
import type { DragHandle } from "./dragHandle";
import { useSelectedScale } from "./selection/useSelectedScale";
import { OfflineFileBadge } from "@/offline/ui/OfflineBadge";

const noop = () => {};

/**
 * iPhone-Albums-style square grid tile for a file: preview/icon + name below.
 * Long-press = more, or, with a drag handle, hold-and-move = drag and a plain
 * hold = more (the handle opens the sheet on release; see useDragMove).
 *
 * Memoised: a list of 1,000 re-renders only the tile whose props changed, so
 * callers pass stable callbacks (see FileBrowser's useKeyedCallbacks).
 */
export const FileCard = memo(function FileCard({ file, onPress, onMore, live, selectable, checks, selected, onToggleSelect, drag, row, col }: {
  file: FileItem; onPress: () => void; onMore?: () => void; live?: boolean;
  /** Selection mode: a tap toggles instead of opening. */
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
  /** Check circle mounted (defaults to `selectable`); stays true through the selection exit fade. */
  checks?: boolean;
  drag?: DragHandle;
  /** Grid position, for the check circles' entrance wave. */
  row?: number; col?: number;
}) {
  const scaleStyle = useSelectedScale(!!selected);
  const body = (
    <View testID={drag ? `drag-file-${file.id}` : undefined} collapsable={false} className="flex-1">
      <Pressable
        onPress={selectable ? onToggleSelect : onPress}
        onLongPress={drag ? noop : (selectable ? undefined : onMore)}
        delayLongPress={drag ? LONG_PRESS_MS : undefined}
        accessibilityState={selectable ? { selected: !!selected } : undefined}
        className="flex-1 p-1.5"
        testID={`card-${file.id}`}
      >
        <Animated.View className="relative overflow-hidden" style={scaleStyle}>
          <FileThumb file={file} variant="grid" live={live} />
          {isKnownLocked(file) ? (
            <View className="absolute end-1 top-1 rounded-full bg-black/50 p-1">
              <Icon name="lock-closed" size={12} color="#ffffff" />
            </View>
          ) : null}
          {file.share_count > 0 && !selectable ? (
            <View className="absolute start-1 top-1 rounded-full bg-black/50 p-1">
              <Icon name="link" size={12} color="#ffffff" />
            </View>
          ) : null}
          {!selectable ? <OfflineFileBadge fileId={file.id} overlay /> : null}
          {(checks ?? selectable) ? <SelectCheck selected={!!selected} testID={`select-${file.id}`} overlay row={row} col={col} /> : null}
        </Animated.View>
        <Text className="mt-1 text-xs text-foreground" numberOfLines={1}>{file.name}</Text>
      </Pressable>
    </View>
  );
  return drag ? <GestureDetector gesture={drag.gesture}>{body}</GestureDetector> : body;
});
