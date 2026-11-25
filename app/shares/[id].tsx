import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import * as Clipboard from "expo-clipboard";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useShareAnalytics, useShareMutations } from "@/share/hooks";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { formatBytes, formatDate, formatDateTime } from "@/files/format";
import {
  avatarColor, avatarLabel, countryLabel, expiryLabel, summarySentence, timelinePeak,
} from "@/share/format";
import { EditShareSheet } from "@/share/EditShareSheet";
import { ANALYTICS_RANGES, type AnalyticsRange, type ShareAnalytics } from "@/share/types";
import { rtlLine, useT } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";

/**
 * One share link, in full.
 *
 * There was no such screen on mobile: a row in the list went nowhere. Every
 * number here already comes back from a single call to
 * GET /api/shares/:id/analytics - the app simply never made it.
 */
export default function ShareDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tokens } = useColorTheme();
  const t = useT();
  const router = useRouter();
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [editing, setEditing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const q = useShareAnalytics(id ?? null, range);
  const { revoke } = useShareMutations();

  const a = q.data;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("shared-links.heading.link") }} />

      {q.isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      ) : q.isError || !a ? (
        <View className="flex-1 items-center justify-center px-10">
          <Icon name="alert-circle-outline" size={30} color={tokens.mutedForeground} />
          <Text className="mt-3 text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>
            {t("shared-links.label.thisLinkIsNotAvailable")}
          </Text>
          <Text className="mt-1 text-center text-xs text-muted-foreground">
            {t("shared-links.description.itMayHaveBeenDeletedOrYouMayNotHavePermissionToSeeIt")}
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={tokens.mutedForeground} />}
        >
          <Header link={a.link} />

          <Pressable
            testID="copy-url"
            accessibilityRole="button"
            accessibilityLabel={t("common.action.copyLink")}
            onPress={async () => { await Clipboard.setStringAsync(a.link.url); toast(t("common.label.linkCopied")); }}
            className="flex-row items-center gap-2 rounded-xl bg-muted px-3 py-2.5"
          >
            <Icon name="globe-outline" size={13} color={tokens.mutedForeground} />
            <Text className="flex-1 text-[11px] text-foreground" style={{ fontFamily: fonts.mono }} numberOfLines={1}>
              {a.link.url.replace(/^https?:\/\//, "")}
            </Text>
            <Icon name="copy-outline" size={14} color={tokens.mutedForeground} />
          </Pressable>

          {/* The reading of the numbers, before the numbers. On a phone this
              sentence carries further than any chart small enough to fit. */}
          <Text className="text-sm leading-5 text-foreground" testID="summary">
            {summarySentence(a)}
          </Text>

          <View className="flex-row overflow-hidden rounded-xl border border-border">
            {[
              { id: "opens", value: a.link.view_count, label: t("shared-links.label.opens") },
              { id: "downloads", value: a.link.download_count, label: t("sync.label.downloads") },
              { id: "people", value: a.reach.visitors, label: t("shared-links.label.people") },
            ].map((s, i) => (
              <View
                key={s.id}
                className={"flex-1 bg-card px-3 py-2.5" + (i > 0 ? " border-border" : "")}
                style={i > 0 ? { borderStartWidth: 1 } : undefined}
              >
                <Text className="text-xl text-foreground" style={{ fontFamily: fonts.bold }} testID={`stat-${s.id}`}>
                  {s.value}
                </Text>
                <Text className="text-[10px] text-muted-foreground">{s.label}</Text>
              </View>
            ))}
          </View>

          <Timeline analytics={a} range={range} onRange={setRange} />

          {a.link.downloads_left === 0 && !a.link.is_revoked ? (
            <View className="flex-row gap-2 rounded-lg px-3 py-2.5" style={{ backgroundColor: "#a8600018" }}>
              <Icon name="alert-circle-outline" size={14} color="#a86000" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-[11px] leading-4" style={{ color: "#a86000" }} testID="cap-spent">
                {t("shared-links.description.thisLinkHasUsedAllMaxDownloadsOfItsDownloadsAndWillNotServeThe", { maxDownloads: localDigits(a.link.max_downloads ?? 0) })}
              </Text>
            </View>
          ) : null}

          <View className="flex-row gap-2">
            <Action icon="share-outline" label={t("common.action.share")} onPress={() => void Share.share({ message: a.link.url })} />
            {!a.link.is_revoked ? (
              <Action icon="create-outline" label={t("common.edit")} testID="edit-link" onPress={() => setEditing(true)} />
            ) : null}
            {!a.link.is_revoked ? (
              <Action icon="close" label={t("common.action.revoke")} destructive testID="revoke-link" onPress={() => setConfirmRevoke(true)} />
            ) : null}
          </View>

          {a.recipients ? <Recipients rows={a.recipients} /> : null}

          <AccessLog analytics={a} />

          <Settings link={a.link} recipientCount={a.recipients?.length ?? 0} />

          {/* What the counters deliberately do not know, in the API's own
              words, so a small chart never implies more than it measured. */}
          <View className="flex-row gap-2 border-t border-border pt-3">
            <Icon name="information-circle-outline" size={13} color={tokens.mutedForeground} style={{ marginTop: 1 }} />
            <Text className="flex-1 text-[11px] leading-4 text-muted-foreground">
              {t("shared-links.description.opensCountFirstVisitsFirstVisitsHasPerPersonSelectTruePerPersonPerPersonOther", {
                firstVisits: a.gaps.repeat_visits,
                hasPerPerson: String(!!a.gaps.per_recipient),
                perPerson: a.gaps.per_recipient ?? "",
              })}
            </Text>
          </View>
        </ScrollView>
      )}

      {a ? (
        <EditShareSheet
          visible={editing}
          link={a.link}
          recipientEmails={(a.recipients ?? []).map((r) => r.email)}
          onClose={() => setEditing(false)}
        />
      ) : null}

      <ConfirmDialog
        visible={confirmRevoke}
        title={t("shared-links.heading.revokeThisLink")}
        message={a ? t("shared-links.description.anyoneHoldingTheLinkToDisplayNameLosesAccessImmediatelyThisCannotBeUndone", { displayName: a.link.display_name }) : undefined}
        confirmLabel={t("common.action.revoke")}
        destructive
        onCancel={() => setConfirmRevoke(false)}
        onConfirm={() => {
          setConfirmRevoke(false);
          if (id) revoke.mutate(id, { onSuccess: () => router.back() });
        }}
      />
    </SafeAreaView>
  );
}

function Header({ link }: { link: ShareAnalytics["link"] }) {
  const { tokens } = useColorTheme();
  const t = useT();
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: link.is_revoked ? tokens.muted : avatarColor(link.display_name) }}
      >
        {link.is_folder ? (
          <Icon name="folder" size={18} color={link.is_revoked ? tokens.mutedForeground : "#fff"} />
        ) : (
          <Text className="text-[9px]" style={{ fontFamily: fonts.bold, color: link.is_revoked ? tokens.mutedForeground : "#fff" }}>
            {avatarLabel(link.display_name, link.extension)}
          </Text>
        )}
      </View>
      <View className="flex-1">
        <Text className="text-base text-foreground" style={{ fontFamily: fonts.bold }} numberOfLines={2}>
          {link.display_name}
        </Text>
        <Text className="text-[11px] text-muted-foreground">
          {t("shared-links.description.hassizeSelectTrueSizeOtherSharedDateIsMineSelectTrueOtherByHasNameSelect", {
            hasSize: String(link.size_bytes != null),
            size: link.size_bytes != null ? formatBytes(link.size_bytes) : "",
            date: formatDate(link.created_at),
            isMine: String(!!link.is_mine),
            hasName: String(!!link.created_by_name),
            name: link.created_by_name ?? "",
          })}
        </Text>
      </View>
    </View>
  );
}

function Action({ icon, label, onPress, destructive, testID }: {
  icon: string; label: string; onPress: () => void; destructive?: boolean; testID?: string;
}) {
  const { tokens } = useColorTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={"flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border py-2.5 " + (destructive ? "border-destructive/40" : "border-border")}
    >
      <Icon name={icon as never} size={14} color={destructive ? tokens.destructive : tokens.foreground} />
      <Text className={"text-xs " + (destructive ? "text-destructive" : "text-foreground")} style={{ fontFamily: fonts.medium }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Timeline({ analytics, range, onRange }: {
  analytics: ShareAnalytics; range: AnalyticsRange; onRange: (r: AnalyticsRange) => void;
}) {
  const { tokens } = useColorTheme();
  const t = useT();
  const peak = timelinePeak(analytics.timeline);
  // Only the last 30 columns are drawn: a 90-day range at one bar per day is
  // sub-pixel on a phone, and a bar too thin to see is worse than an honest
  // "showing the most recent 30 days" note.
  const points = analytics.timeline.slice(-30);

  return (
    <View className="rounded-xl border border-border bg-card p-3">
      <View className="mb-2.5 flex-row items-center justify-between">
        <Text className="text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
          {t("shared-links.label.accessOverTime")}
        </Text>
        <View className="flex-row gap-1">
          {ANALYTICS_RANGES.map((r) => (
            <Pressable
              key={r}
              testID={`range-${r}`}
              accessibilityRole="button"
              accessibilityState={{ selected: r === range }}
              onPress={() => onRange(r)}
              className={"rounded-full px-2 py-0.5 " + (r === range ? "bg-primary" : "bg-transparent border border-border")}
            >
              <Text className={"text-[10px] " + (r === range ? "text-primary-foreground" : "text-muted-foreground")}>
                {t("common.label.daysD", { days: localDigits(r) })}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {peak === 0 ? (
        <View className="items-center py-6">
          <Text className="text-xs text-muted-foreground">{t("shared-links.label.noOpensInThisRange")}</Text>
        </View>
      ) : (
        <>
          <View className="h-14 flex-row items-end gap-0.5" testID="timeline-chart">
            {points.map((p) => (
              <View key={p.day} className="flex-1 justify-end">
                <View style={{ height: `${(p.opens / peak) * 100}%`, backgroundColor: tokens.primary, opacity: 0.55, borderRadius: 1 }} />
                <View style={{ height: `${(p.downloads / peak) * 100}%`, backgroundColor: tokens.primary, borderRadius: 1 }} />
              </View>
            ))}
          </View>
          <View className="mt-1.5 flex-row justify-between">
            <Text className="text-[9px] text-muted-foreground">{points[0]?.day ?? ""}</Text>
            <Text className="text-[9px] text-muted-foreground">{points[points.length - 1]?.day ?? ""}</Text>
          </View>
          <View className="mt-2 flex-row gap-3">
            <Legend color={tokens.primary} opacity={0.55} label={t("shared-links.label.opens")} />
            <Legend color={tokens.primary} opacity={1} label={t("sync.label.downloads")} />
          </View>
          {analytics.timeline.length > points.length ? (
            <Text className="mt-2 text-[10px] text-muted-foreground">
              {t("shared-links.description.showingTheMostRecentPointsCountDaysOfRange", { pointsCount: localDigits(points.length), range: localDigits(range) })}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function Legend({ color, opacity, label }: { color: string; opacity: number; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, opacity }} />
      <Text className="text-[10px] text-muted-foreground">{label}</Text>
    </View>
  );
}

function Recipients({ rows }: { rows: NonNullable<ShareAnalytics["recipients"]> }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const opened = rows.filter((r) => r.verified_at).length;
  return (
    <View className="rounded-xl border border-border bg-card p-3">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
          {t("common.status.invited")}
        </Text>
        <Text className="text-[10px] text-muted-foreground">{t("shared-links.label.openedOfRowsCountOpened", { opened: localDigits(opened), rowsCount: localDigits(rows.length) })}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.email} className="flex-row items-center gap-2 py-1.5" style={{ opacity: r.verified_at ? 1 : 0.6 }}>
          <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>{r.email}</Text>
          {r.verified_at ? (
            <View className="flex-row items-center gap-1">
              <Icon name="checkmark" size={11} color={tokens.primary} />
              {/* "Verified", never "opened at": the timestamp records the code
                  being accepted, not a per-open event. */}
              <Text className="text-[10px] text-primary">{t("common.status.verified")}</Text>
            </View>
          ) : (
            <Text className="text-[10px] text-muted-foreground">{t("shared-links.status.notOpened")}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function AccessLog({ analytics }: { analytics: ShareAnalytics }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const { rows, total } = analytics.log;

  return (
    <View>
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
          {t("shared-links.label.accessLog")}
        </Text>
        <Text className="text-[10px] text-muted-foreground">{t("shared-links.label.totalPluralOneEventOtherEvents", { total })}</Text>
      </View>
      {rows.length === 0 ? (
        <Text className="py-4 text-center text-xs text-muted-foreground">{t("shared-links.label.noOneHasOpenedThisLink")}</Text>
      ) : (
        rows.map((r) => (
          <View key={r.id} className="flex-row items-center gap-2 border-b border-border py-2">
            <Icon
              name={r.event === "download" ? "download-outline" : "eye-outline"}
              size={14}
              color={r.event === "download" ? tokens.primary : tokens.mutedForeground}
            />
            <View className="flex-1">
              <Text className="text-xs text-foreground">{r.event === "download" ? t("common.status.downloaded") : t("shared-links.status.opened")}</Text>
              <Text className="text-[10px] text-muted-foreground" style={{ fontFamily: fonts.mono }}>
                {rtlLine(`${r.visitor} · ${r.device_label} · ${countryLabel(r.country)}`)}
              </Text>
            </View>
            <Text className="text-[10px] text-muted-foreground">{formatDateTime(r.viewed_at)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function Settings({ link, recipientCount }: { link: ShareAnalytics["link"]; recipientCount: number }) {
  const t = useT();
  const rows: { id: string; label: string; value: string }[] = [
    { id: "expires", label: t("common.label.expires"), value: expiryLabel({ is_revoked: link.is_revoked ? 1 : 0, expires_at: link.expires_at, revoked_at: link.revoked_at }) },
    { id: "password", label: t("common.label.password"), value: link.is_password_protected ? t("shared-links.status.set") : t("common.status.notSet") },
    { id: "who", label: t("shared-links.label.whoCanOpen"), value: link.access_mode === "restricted" ? t("shared-links.label.onlyInvitedRecipientCount", { recipientCount: localDigits(recipientCount) }) : t("shared-links.label.anyoneWithTheLink") },
    { id: "downloads", label: t("sync.label.downloads"), value: link.lock_mode === "view_only"
      ? t("shared-links.label.offViewOnly")
      : link.max_downloads != null
        ? t("shared-links.label.downloadcountOfMaxDownloadsUsed", { downloadCount: localDigits(link.download_count), maxDownloads: localDigits(link.max_downloads) })
        : t("shared-links.status.allowed") },
    { id: "created", label: t("common.label.created"), value: t("shared-links.label.dateIsMineSelectTrueByYouOther", { date: formatDate(link.created_at), isMine: String(!!link.is_mine) }) },
  ];
  return (
    <View className="rounded-xl border border-border bg-card p-3">
      <Text className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
        {t("shared-links.label.linkSettings")}
      </Text>
      {rows.map((r) => (
        <View key={r.id} className="flex-row items-center justify-between py-1">
          <Text className="text-xs text-muted-foreground">{r.label}</Text>
          <Text className="text-xs text-foreground">{r.value}</Text>
        </View>
      ))}
    </View>
  );
}
