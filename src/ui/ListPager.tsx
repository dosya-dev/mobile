import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";

/**
 * Rows per page for a list that is paged in the client.
 *
 * Small on purpose. These lists are sections of screens that are already a long
 * scroll, and the device keeps hundreds of rows - rendering them all buries
 * everything below under a wall of near-identical lines with no way past it. A
 * fixed page also keeps the section the same height whichever page is showing,
 * so paging never moves the content under the user's thumb.
 */
export const DEFAULT_PAGE_SIZE = 6;

export interface Pager {
  page: number;
  pageCount: number;
  /** Slice bounds for the current page. */
  from: number;
  to: number;
  /** Whether there is more than one page - i.e. whether to draw the control. */
  paged: boolean;
  /** "1-6 of 42": the 1-based, inclusive range the current page covers. */
  label: string;
  prev: () => void;
  next: () => void;
}

/**
 * Page state for a client-side paged list.
 *
 * `total` is the number of rows IN HAND. Pass the loaded length, not a server
 * total - a pager that can walk onto a page nothing filled is worse than one
 * that stops early.
 */
export function usePager(total: number, pageSize: number = DEFAULT_PAGE_SIZE): Pager {
  const t = useT();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // A new row at the top shifts everything below it down one, so the page the
  // user was reading no longer holds what it held a moment ago: go back to the
  // newest page, where that row is. This is also the guard for a shrinking list
  // (an account purge empties it) - a page index past the end would otherwise
  // render nothing at all.
  useEffect(() => {
    setPage(0);
  }, [total]);
  const from = page * pageSize;
  return {
    page,
    pageCount,
    from,
    to: from + pageSize,
    paged: total > pageSize,
    label: t("backup.label.firstLastOfTotal", { first: from + 1, last: Math.min(total, from + pageSize), total }),
    prev: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => Math.min(pageCount - 1, p + 1)),
  };
}

function PagerButton({
  testID,
  label,
  icon,
  disabled,
  onPress,
  color,
  mutedColor,
}: {
  testID: string;
  label: string;
  icon: "chevron-back" | "chevron-forward";
  disabled: boolean;
  onPress: () => void;
  color: string;
  mutedColor: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      className="h-8 w-10 items-center justify-center rounded-lg"
    >
      <Icon name={icon} size={16} color={disabled ? mutedColor : color} />
    </Pressable>
  );
}

const LIST_KINDS = new Map<string, "failed" | "skipped" | "backups" | "other">([
  ["failed items", "failed"],
  ["skipped items", "skipped"],
  ["backups", "backups"],
  ["items", "other"],
]);

/**
 * Previous / "7-12 of 42" / next. Renders nothing while the whole list fits on
 * one page, so a caller can drop it in unconditionally.
 *
 * `testID` prefixes the three controls (`<id>`, `<id>-prev`, `<id>-next`,
 * `<id>-range`), and `what` names the list for screen readers.
 */
export function ListPager({ pager, testID, what }: { pager: Pager; testID: string; what: string }) {
  const { tokens } = useColorTheme();
  const t = useT();
  if (!pager.paged) return null;
  // The catalog names four lists (failed items, skipped items, backups, plain
  // items); any other `what` reads as plain items.
  const kind = LIST_KINDS.get(what) ?? "other";
  const prevLabel = t("backup.label.previousKindSelectFailedFailedItemsSkippedSkippedItemsOtherItemsPage", { kind });
  const nextLabel = t("backup.label.nextKindSelectFailedFailedItemsSkippedSkippedItemsOtherItemsPage", { kind });
  return (
    <View testID={testID} className="mt-2 flex-row items-center justify-between px-1">
      <PagerButton
        testID={`${testID}-prev`}
        label={prevLabel}
        icon="chevron-back"
        disabled={pager.page === 0}
        onPress={pager.prev}
        color={tokens.foreground}
        mutedColor={tokens.mutedForeground}
      />
      <Text testID={`${testID}-range`} className="text-xs text-muted-foreground">
        {pager.label}
      </Text>
      <PagerButton
        testID={`${testID}-next`}
        label={nextLabel}
        icon="chevron-forward"
        disabled={pager.page >= pager.pageCount - 1}
        onPress={pager.next}
        color={tokens.foreground}
        mutedColor={tokens.mutedForeground}
      />
    </View>
  );
}
