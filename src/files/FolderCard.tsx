import { memo } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { FolderIcon } from "./FolderIcon";
import type { FolderItem } from "./types";
import { SelectCheck } from "./SelectCheck";
import { LONG_PRESS_MS } from "./dragTiming";
import type { DragHandle, DropTargetRef } from "./dragHandle";
import { useSelectedScale } from "./selection/useSelectedScale";
import { OfflineFolderBadge } from "@/offline/ui/OfflineBadge";

const noop = () => {};

/**
 * Square grid tile for a folder: folder glyph + name below. Long-press = more,
 * or, with a drag handle, hold-and-move = drag and a plain hold = more.
 * Memoised like FileCard; callers pass stable callbacks.
 */
export const FolderCard = memo(function FolderCard({ folder, onPress, onMore, selectable, checks, selected, onToggleSelect, drag, dropActive, targetRef, row, col }: {
  folder: FolderItem; onPress: () => void; onMore?: () => void;
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
  /** Check circle mounted (defaults to `selectable`); stays true through the selection exit fade. */
  checks?: boolean;
  drag?: DragHandle;
  /** A drag is hovering this folder: it is where a release would drop. */
  dropActive?: boolean;
  /** Lets the drag hit-test this tile. */
  targetRef?: DropTargetRef;
  /** Grid position, for the check circles' entrance wave. */
  row?: number; col?: number;
}) {
  const scaleStyle = useSelectedScale(!!selected);
  const body = (
    // collapsable={false}: see FolderRow.
    <View ref={targetRef} collapsable={false} testID={`drop-target-${folder.id}`} className="flex-1">
      <Pressable
        onPress={selectable ? onToggleSelect : onPress}
        onLongPress={drag ? noop : (selectable ? undefined : onMore)}
        delayLongPress={drag ? LONG_PRESS_MS : undefined}
        accessibilityState={selectable ? { selected: !!selected } : undefined}
        className="flex-1 p-1.5"
        testID={`folder-card-${folder.id}`}
      >
        <Animated.View className="aspect-square w-full items-center justify-center overflow-hidden bg-secondary" style={scaleStyle}>
          <FolderIcon folder={folder} size={44} testID={`folder-icon-${folder.id}`} />
          {folder.lock_mode !== "none" ? (
            <View className="absolute end-1 top-1 rounded-full bg-black/40 p-1">
              <Icon name="lock-closed" size={12} color="#ffffff" />
            </View>
          ) : null}
          {!selectable ? <OfflineFolderBadge folderId={folder.id} overlay /> : null}
          {(checks ?? selectable) ? <SelectCheck selected={!!selected} testID={`select-folder-${folder.id}`} overlay row={row} col={col} /> : null}
          {dropActive ? (
            <View pointerEvents="none" testID={`drop-ring-${folder.id}`} className="absolute inset-0 rounded-lg border-2 border-primary" />
          ) : null}
        </Animated.View>
        <Text className="mt-1 text-xs text-foreground" numberOfLines={1}>{folder.name}</Text>
      </Pressable>
    </View>
  );
  return drag ? <GestureDetector gesture={drag.gesture}>{body}</GestureDetector> : body;
});
