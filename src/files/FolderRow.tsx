import { memo } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { useColorTheme } from "@/theme/useColorTheme";
import { FolderIcon } from "./FolderIcon";
import type { FolderItem } from "./types";
import { useT } from "@/lib/i18n";
import { SelectCheck } from "./SelectCheck";
import { LONG_PRESS_MS } from "./dragTiming";
import type { DragHandle, DropTargetRef } from "./dragHandle";
import { OfflineFolderBadge } from "@/offline/ui/OfflineBadge";

const noop = () => {};

/** Memoised like FileRow; callers pass stable callbacks. */
export const FolderRow = memo(function FolderRow({ folder, onPress, onMore, selectable, checks, selected, onToggleSelect, drag, dropActive, targetRef, row }: {
  folder: FolderItem; onPress: () => void; onMore?: () => void;
  /** Selection mode: a tap toggles instead of opening, a check replaces the more button. */
  selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
  /** Check circle mounted (defaults to `selectable`); stays true through the selection exit fade. */
  checks?: boolean;
  /** Hold to drag; see useDragMove. */
  drag?: DragHandle;
  /** A drag is hovering this folder: it is where a release would drop. */
  dropActive?: boolean;
  /** Lets the drag hit-test this row. */
  targetRef?: DropTargetRef;
  /** Position in the list, for the check circles' entrance wave. */
  row?: number;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const body = (
    // collapsable={false}: Android drops a View with no visual role from the
    // native tree, and then there is nothing for the drop hit-test to measure.
    <View ref={targetRef} collapsable={false} testID={`drop-target-${folder.id}`}>
      <Pressable
        onPress={selectable ? onToggleSelect : onPress}
        onLongPress={drag ? noop : undefined}
        delayLongPress={drag ? LONG_PRESS_MS : undefined}
        accessibilityState={selectable ? { selected: !!selected } : undefined}
        className={`flex-row items-center gap-3 px-5 py-3 border-b border-border ${selected ? "bg-primary/10" : ""}`}
      >
        {(checks ?? selectable) ? <SelectCheck selected={!!selected} testID={`select-folder-${folder.id}`} row={row} /> : null}
        <FolderIcon folder={folder} size={26} testID={`folder-icon-${folder.id}`} />
        <View className="flex-1">
          <Text className="text-base text-foreground" numberOfLines={1}>{folder.name}</Text>
          <Text className="text-xs text-muted-foreground">{t("common.label.item", { count: folder.file_count })}</Text>
        </View>
        <OfflineFolderBadge folderId={folder.id} />
        {folder.lock_mode !== "none" ? <Icon name="lock-closed" size={16} color={tokens.mutedForeground} /> : null}
        {folder.is_hidden ? <Icon name="eye-off" size={16} color={tokens.mutedForeground} testID={`hidden-folder-${folder.id}`} /> : null}
        {onMore && !selectable ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={onMore} testID={`more-folder-${folder.id}`}>
            <Icon name="ellipsis-horizontal" size={20} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
        <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />
      </Pressable>
      {dropActive ? (
        <View pointerEvents="none" testID={`drop-ring-${folder.id}`} className="absolute start-2 end-2 top-0.5 bottom-0.5 rounded-lg border-2 border-primary" />
      ) : null}
    </View>
  );
  return drag ? <GestureDetector gesture={drag.gesture}>{body}</GestureDetector> : body;
});
