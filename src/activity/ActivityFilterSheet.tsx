import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useT } from "@/lib/i18n";
import { ACTIVITY_CATEGORIES, actionsForCategories, type ActivityOption } from "./catalog.generated";
import { activityActionLabel } from "./activityLabels";
import { hasAnyFilter, type ActivityFilters, type ActivityMember } from "./api";

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      className={
        "rounded-full border px-3 py-1.5 " +
        (selected ? "border-primary bg-primary" : "border-border bg-card")
      }
    >
      <Text
        className={"text-xs " + (selected ? "text-primary-foreground" : "text-foreground")}
        style={{ fontFamily: fonts.medium }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One collapsible group of chips. Collapsed by default except the first:
 * Action alone is fifty-odd options, and a sheet that opens at full height
 * with every one of them showing is not a filter, it is a wall.
 */
function Section({
  title,
  count,
  open,
  onToggle,
  children,
  testID,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testID: string;
}) {
  const { tokens } = useColorTheme();
  return (
    <View className="border-b border-border">
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="flex-row items-center gap-2 px-5 py-3"
      >
        <Text className="flex-1 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
          {title}
        </Text>
        {count > 0 ? (
          <View className="rounded-full bg-primary px-2 py-0.5">
            <Text testID={`${testID}-count`} className="text-[10px] text-primary-foreground" style={{ fontFamily: fonts.medium }}>
              {count}
            </Text>
          </View>
        ) : null}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color={tokens.mutedForeground} />
      </Pressable>
      {open ? <View className="flex-row flex-wrap gap-2 px-5 pb-4">{children}</View> : null}
    </View>
  );
}

/**
 * Narrow the activity feed by category, member and action.
 *
 * One sheet rather than web's three dropdown menus: a phone has no room for
 * three menus side by side, and the three choices are usually made together
 * ("what did Ada do to files last week") rather than one at a time.
 *
 * Edits are held locally and only handed back on Apply. Filtering refetches
 * from page one, so applying on every chip tap would fire a request per tap and
 * repeatedly yank the list out from under the thumb that is still choosing.
 */
export function ActivityFilterSheet({
  visible,
  filters,
  members,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: ActivityFilters;
  members: ActivityMember[];
  onApply: (next: ActivityFilters) => void;
  onClose: () => void;
}) {
  const t = useT();
  const sheetPad = useSheetBottomPad();
  const [draft, setDraft] = useState<ActivityFilters>(filters);
  const [open, setOpen] = useState<string | null>("categories");

  // Re-seed each time the sheet opens: a draft abandoned by tapping the
  // backdrop must not come back the next time it is opened.
  useEffect(() => {
    if (visible) {
      setDraft(filters);
      setOpen("categories");
    }
  }, [visible, filters]);

  // Actions are offered per category, so narrowing the categories can strip an
  // action the draft still holds - and an invisible filter is one the user
  // cannot turn off. Drop those rather than silently keep filtering by them.
  const actionOptions = actionsForCategories(draft.categories);
  const offered = new Set(actionOptions.map((o) => o.value));
  const actions = draft.actions.filter((a) => offered.has(a));

  const memberOptions: ActivityOption[] = members.map((m) => ({
    value: m.id,
    label: m.name || m.email || m.id,
  }));

  const next: ActivityFilters = { ...draft, actions };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable testID="activity-filter-backdrop" className="flex-1 bg-black/40" onPress={onClose} />
      <View testID="activity-filter-sheet" className="max-h-[80%] rounded-t-2xl bg-card" style={{ paddingBottom: sheetPad }}>
        <View className="items-center pt-2">
          <View className="h-1 w-10 rounded-full bg-border" />
        </View>
        <View className="flex-row items-center px-5 py-3">
          <Text className="flex-1 text-base text-foreground" style={{ fontFamily: fonts.bold }}>
            {t("activity.action.filterActivity")}
          </Text>
          {hasAnyFilter(next) ? (
            <Pressable
              testID="activity-filter-clear"
              accessibilityRole="button"
              onPress={() => setDraft({ categories: [], actions: [], userIds: [] })}
            >
              <Text className="text-xs text-primary" style={{ fontFamily: fonts.medium }}>{t("activity.action.clearAll")}</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView>
          <Section
            title={t("activity.heading.category")}
            count={draft.categories.length}
            open={open === "categories"}
            onToggle={() => setOpen(open === "categories" ? null : "categories")}
            testID="activity-filter-categories"
          >
            {ACTIVITY_CATEGORIES.map((c) => (
              <Chip
                key={c.value}
                testID={`activity-filter-category-${c.value}`}
                label={activityActionLabel(c.value, c.label, t)}
                selected={draft.categories.includes(c.value)}
                onPress={() => setDraft((d) => ({ ...d, categories: toggle(d.categories, c.value) }))}
              />
            ))}
          </Section>

          <Section
            title={t("activity.heading.member")}
            count={draft.userIds.length}
            open={open === "members"}
            onToggle={() => setOpen(open === "members" ? null : "members")}
            testID="activity-filter-members"
          >
            {memberOptions.length === 0 ? (
              <Text className="py-1 text-xs text-muted-foreground">{t("activity.description.noMembersToFilterBy")}</Text>
            ) : (
              memberOptions.map((m) => (
                <Chip
                  key={m.value}
                  testID={`activity-filter-member-${m.value}`}
                  label={m.label}
                  selected={draft.userIds.includes(m.value)}
                  onPress={() => setDraft((d) => ({ ...d, userIds: toggle(d.userIds, m.value) }))}
                />
              ))
            )}
          </Section>

          <Section
            title={t("activity.heading.action")}
            count={actions.length}
            open={open === "actions"}
            onToggle={() => setOpen(open === "actions" ? null : "actions")}
            testID="activity-filter-actions"
          >
            {actionOptions.map((a) => (
              <Chip
                key={a.value}
                testID={`activity-filter-action-${a.value}`}
                label={activityActionLabel(a.value, a.label, t)}
                selected={actions.includes(a.value)}
                onPress={() => setDraft((d) => ({ ...d, actions: toggle(actions, a.value) }))}
              />
            ))}
          </Section>
        </ScrollView>

        <View className="px-5 pt-3">
          <Pressable
            testID="activity-filter-apply"
            accessibilityRole="button"
            onPress={() => onApply(next)}
            className="items-center rounded-xl bg-primary py-3"
          >
            <Text className="text-sm text-primary-foreground" style={{ fontFamily: fonts.medium }}>
              {t("activity.action.showActivity")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
