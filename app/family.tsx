import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { Stack, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Screen } from "@/ui/Screen";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { Icon } from "@/ui/Icon";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import type { T } from "@/i18n/translator";
import { layoutIsRtl } from "@/lib/direction";
import { formatDateWith, localDigits } from "@/lib/format-locale";
import { useFamily, FAMILY_KEY } from "@/family/hooks";
import { showsFamilyEntry } from "@/family/visibility";
import { ApiError } from "@/api/errors";
import { inviteFamilyMember, leaveFamily, removeFamilyMember, revokeFamilyInvite } from "@/family/api";
import { FamilyUsage } from "@/family/FamilyUsage";
import { ReservationSheet } from "@/family/ReservationSheet";
import { buildPeople, poolSegments, type FamilyPerson } from "@/family/people";
import { greenTone, personColor, personInk, tint, warnTone } from "@/family/colors";
import { formatGigabytes, gigabyteFigure } from "@/family/format";
import type { FamilyMemberView, FamilyView } from "@/family/types";

type Pending = { kind: "remove" | "revoke" | "resend"; member: FamilyMemberView } | { kind: "leave" };

const errMessage = (t: T, e: unknown) => {
  if (e instanceof ApiError && e.code === "free_plan") return t("family.error.yourPlanHasEndedSoYouCannotInviteAnyonePeriodSentenceCaseWithEndedsoyoucannotinviteanyonenew");
  return e instanceof Error && e.message ? e.message : t("common.error.somethingWentWrongTryAgain");
};

function confirmCopy(t: T, p: Pending, data: FamilyView): { title: string; message: string; label: string; destructive: boolean } {
  if (p.kind === "remove") {
    return {
      title: t("profile.heading.removeWhoFromYourFamilyPlan", { who: p.member.name ?? p.member.email }),
      message: t("profile.description.theirAccountReturnsToTheFreePlanWith5GBNothingIsDeletedAnd", { overFree: String(!!p.member.over_free) }),
      label: t("common.remove"), destructive: true,
    };
  }
  if (p.kind === "revoke") return { title: t("profile.heading.revokeTheInvitationToEmail", { email: p.member.email }), message: t("family.label.theLinkInTheirEmailStopsWorkingYouCan"), label: t("common.action.revoke"), destructive: true };
  if (p.kind === "resend") return { title: t("profile.heading.sendTheInvitationToEmailAgain", { email: p.member.email }), message: t("family.description.theyGetAFreshEmailWithANewLink"), label: t("family.action.sendAgain"), destructive: false };
  return {
    title: t("profile.heading.leaveHasPayerSelectTruePayerNameOtherThisSFamilyPlan", { hasPayer: String(!!data.payer), payerName: data.payer?.name ?? "" }),
    message: t("profile.description.yourAccountGoesBackToTheFreePlanWith5GBNothingIsDeleted", { hasUsage: String(!!data.own_used_label), used: data.own_used_label ?? "" }),
    label: t("common.action.leave"), destructive: true,
  };
}

/**
 * Profile > Family plan, the same design as the web Family card and the
 * desktop Family section, with Members and Usage always behind the toggle.
 * Payer: people, pending invitations, storage reservations (a bottom sheet),
 * the places counter and an invite field. Member: who pays, their own
 * reservation if any, the pool, and Leave. Nothing here sells anything: no
 * prices, no places to buy, no plan changes.
 *
 * Colours come from useColorTheme() at render, so a theme change repaints the
 * avatars, bars and ring at once.
 */
export default function FamilyScreen() {
  const t = useT();
  const { scheme } = useColorTheme();
  const dark = scheme === "dark";
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading, isError, refetch, isRefetching } = useFamily();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"members" | "usage">("members");
  // The sheet keeps the member as it was when opened, so a refetch cannot
  // change it under the user; seq gives each opening fresh state.
  const [reserve, setReserve] = useState<{ member: FamilyMemberView; seq: number } | null>(null);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: FAMILY_KEY });
    await qc.invalidateQueries({ queryKey: ["workspace-dashboard"] });
  };

  const invite = async () => {
    const addr = email.trim();
    if (!addr) return;
    setInviting(true);
    try { await inviteFamilyMember(addr); setEmail(""); toast(t("common.label.invitationSent")); await refresh(); }
    catch (e) { toast(errMessage(t, e), "error"); }
    setInviting(false);
  };

  const confirm = async () => {
    const p = pending;
    if (!p || busy) return;
    setPending(null);
    setBusy(true);
    try {
      if (p.kind === "remove") await removeFamilyMember(p.member.id);
      else if (p.kind === "revoke") await revokeFamilyInvite(p.member.id);
      else if (p.kind === "resend") await inviteFamilyMember(p.member.email);
      else await leaveFamily();
      toast(t(p.kind === "remove" ? "profile.status.removedFromYourFamilyPlan" : p.kind === "revoke" ? "profile.status.invitationRevoked" : p.kind === "resend" ? "profile.status.invitationSentAgain" : "profile.status.youLeftTheFamilyPlan"));
      await refresh();
      if (p.kind === "leave") router.back();
    } catch (e) { toast(errMessage(t, e), "error"); }
    setBusy(false);
  };

  const onReserved = () => {
    setReserve(null);
    void refresh();
    // A reservation moves the caps the storage figures read.
    void qc.invalidateQueries({ queryKey: ["workspace-storage"] });
  };

  const inFamily = !!data && (data.role !== "none" || (data.members ?? []).length > 0);
  const built = data ? buildPeople(data) : null;
  const showTabs = inFamily && Array.isArray(data?.usage);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("family.heading.familyPlan") }} />
      <Screen underNativeHeader>
        {isLoading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
        ) : isError || !data || !built ? (
          <View className="flex-1 items-center justify-center">
            <Text className="mb-3 text-destructive" style={{ fontFamily: fonts.regular }}>{t("profile.error.couldnTLoadYourFamilyPlan")}</Text>
            <Text accessibilityRole="button" className="text-primary" onPress={() => refetch()} style={{ fontFamily: fonts.medium }}>{t("common.retry")}</Text>
          </View>
        ) : (
          <ScrollView refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />} contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}>
            <View className="rounded-3xl border border-border bg-card p-[18px]">
              <Header data={data} people={built.people} dark={dark} inFamily={inFamily} />
              {showTabs && (
                <PillToggle value={tab} onChange={setTab} dark={dark} label={t("family.heading.familyPlan")}
                  options={[["members", t("common.label.members")], ["usage", t("profile.label.usage")]]} />
              )}
              {showTabs && tab === "usage" ? <FamilyUsage view={data} people={built.people} /> : data.role === "member" ? (
                <MemberBody data={data} people={built.people} dark={dark} busy={busy} onLeave={() => setPending({ kind: "leave" })} />
              ) : !showsFamilyEntry(data) ? (
                <Text className="mt-3 text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("family.description.youAreNotInAFamilyPlan")}</Text>
              ) : (
                <PayerBody data={data} people={built.people} colorOf={built.colorOf} dark={dark} email={email} setEmail={setEmail} inviting={inviting} onInvite={invite}
                  onAsk={(kind, member) => setPending({ kind, member })} busy={busy}
                  onReserve={(m) => setReserve((r) => ({ member: m, seq: (r?.seq ?? 0) + 1 }))} />
              )}
            </View>
          </ScrollView>
        )}
        {pending && data && (() => {
          const c = confirmCopy(t, pending, data);
          return <ConfirmDialog visible title={c.title} message={c.message} confirmLabel={c.label} destructive={c.destructive}
            onConfirm={() => void confirm()} onCancel={() => setPending(null)} />;
        })()}
        {reserve && data && built && (
          <ReservationSheet
            key={`${reserve.member.id}:${reserve.seq}`}
            member={reserve.member}
            personKey={built.personKeyOf.get(reserve.member.id) ?? ""}
            people={built.people}
            poolLimit={data.pool.limit_bytes}
            onClose={() => setReserve(null)}
            onSaved={onReserved}
          />
        )}
      </Screen>
    </>
  );
}

function Chip({ children, green = false, dark }: { children: string; green?: boolean; dark: boolean }) {
  const tone = green ? greenTone(dark) : null;
  return (
    <View testID="family-chip" className={`h-[30px] justify-center rounded-full px-3 ${tone ? "" : "bg-secondary"}`} style={tone ? { backgroundColor: tone.backgroundColor } : undefined}>
      <Text numberOfLines={1} className={`text-sm ${tone ? "" : "text-foreground"}`} style={{ fontFamily: fonts.bold, ...(tone ? { color: tone.color } : null) }}>{children}</Text>
    </View>
  );
}

/** Title, plan and places chips, the pool line and its stacked bar, and the overbooked warning. */
function Header({ data, people, dark, inFamily }: { data: FamilyView; people: FamilyPerson[]; dark: boolean; inFamily: boolean }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const isMember = data.role === "member";
  const showChips = inFamily || data.eligible;
  const reservedTotal = data.pool.reserved_bytes ?? 0;
  const reservedCount = people.filter((p) => p.reserved).length;
  const limit = Math.max(data.pool.limit_bytes, 1);
  const segments = poolSegments(people, dark, 30).filter((s) => s.bytes > 0);
  const warn = warnTone(dark);
  return (
    <View>
      <View className="flex-row flex-wrap items-center gap-2.5">
        <View className="me-auto flex-row items-center gap-2">
          <Icon name="people-outline" size={20} color={tokens.foreground} />
          <Text className="text-xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header">{t("family.heading.familyPlan")}</Text>
        </View>
        {showChips && <Chip dark={dark}>{t("family.label.planChip", { planName: data.plan.name, limitLabel: data.pool.limit_label })}</Chip>}
        {isMember
          ? <Chip green dark={dark}>{t("family.status.sharedWithYou")}</Chip>
          : showChips && typeof data.included === "number" ? <Chip green dark={dark}>{t("family.label.placesIncludedChip", { count: data.included })}</Chip> : null}
      </View>
      {inFamily && (
        <Text className="mt-2.5 text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {reservedTotal > 0
            ? t("family.description.usedOfLimitReservedForPeople", { usedLabel: data.pool.used_label, limitLabel: data.pool.limit_label, reservedLabel: formatGigabytes(reservedTotal), count: reservedCount })
            : t("family.description.usedlabelOfLimitLabelUsedAcrossTheFamily", { usedLabel: data.pool.used_label, limitLabel: data.pool.limit_label })}
        </Text>
      )}
      {inFamily && segments.length > 0 && (
        <View className="mt-2.5 h-2 flex-row gap-0.5 overflow-hidden rounded-full bg-muted" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {segments.map((s) => <View key={s.key} style={{ width: `${Math.min(100, (s.bytes / limit) * 100)}%`, backgroundColor: s.color }} />)}
        </View>
      )}
      {!isMember && data.reservations_exceed_pool && (
        <View accessibilityRole="alert" className="mt-3 flex-row items-start gap-2 rounded-xl px-3 py-2.5" style={{ backgroundColor: warn.backgroundColor }}>
          <Icon name="warning" size={16} color={warn.color} />
          <Text className="flex-1 text-sm" style={{ fontFamily: fonts.regular, color: warn.color }}>{t("family.error.reservationsAddUpToMoreThanYourPlan")}</Text>
        </View>
      )}
    </View>
  );
}

const PILL_EASE = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Members | Usage as a pill toggle. The highlight slides under the picked
 * option, easing out with no overshoot (and jumps with reduced motion).
 */
function PillToggle<V extends string>({ value, onChange, options, label, dark }: {
  value: V; onChange: (v: V) => void; options: [V, string][]; label: string; dark: boolean;
}) {
  const { tokens } = useColorTheme();
  const reduced = useReducedMotion();
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(index);
  const half = Math.max(0, (width - 8) / 2);
  const sign = layoutIsRtl() ? -1 : 1;
  useEffect(() => {
    progress.value = reduced ? index : withTiming(index, { duration: 300, easing: PILL_EASE });
  }, [index, reduced, progress]);
  // rtl-ok: mirrored (sign flips the slide in RTL; the highlight starts at the start edge)
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * half * sign }] }));
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className="mt-[18px] h-[46px] flex-row rounded-full bg-secondary p-1">
      {half > 0 && (
        <Animated.View pointerEvents="none" className="absolute bottom-1 start-1 top-1 rounded-full"
          style={[{ width: half, backgroundColor: dark ? tint(tokens.foreground, 18) : tokens.card }, dark ? null : SHADOW, slide]} />
      )}
      {options.map(([v, text]) => (
        <Pressable key={v} testID={`family-tab-${v}`} accessibilityRole="tab" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)}
          className="flex-1 items-center justify-center rounded-full">
          <Text className={v === value ? "text-base text-foreground" : "text-base text-muted-foreground"} style={{ fontFamily: fonts.bold }}>{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const SHADOW = { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 };

function Avatar({ name, colorIndex, dark, testID }: { name: string; colorIndex: number | null; dark: boolean; testID: string }) {
  const { tokens } = useColorTheme();
  const style = colorIndex === null
    ? { borderWidth: 2, borderStyle: "dashed" as const, borderColor: tokens.mutedForeground }
    : { backgroundColor: personColor(colorIndex, dark) };
  return (
    <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="h-10 w-10 items-center justify-center rounded-full" style={style}>
      <Text className="text-base" style={{ fontFamily: fonts.bold, color: colorIndex === null ? tokens.mutedForeground : personInk(colorIndex, dark) }}>
        {([...name.trim()][0] ?? "?").toLocaleUpperCase()}
      </Text>
    </View>
  );
}

function StatusBadge({ label, colorIndex, dark }: { label: string; colorIndex: number | null; dark: boolean }) {
  const color = colorIndex === null ? null : personColor(colorIndex, dark);
  return (
    <View className={`h-[26px] justify-center rounded-full px-2.5 ${color ? "" : "bg-secondary"}`} style={color ? { backgroundColor: tint(color, 16) } : undefined}>
      <Text numberOfLines={1} className={`text-xs ${color ? "" : "text-muted-foreground"}`} style={{ fontFamily: fonts.bold, ...(color ? { color } : null) }}>{label}</Text>
    </View>
  );
}

function PersonRow({ id, name, colorIndex, dark, sub, end, last }: { id: string; name: string; colorIndex: number | null; dark: boolean; sub: ReactNode; end: ReactNode; last: boolean }) {
  return (
    <View testID={`family-row-${id}`} className={`flex-row items-center gap-3 py-2.5 ${last ? "" : "border-b border-border"}`}>
      <Avatar name={name} colorIndex={colorIndex} dark={dark} testID={`family-avatar-${id}`} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>{name}</Text>
        {sub}
      </View>
      {end}
    </View>
  );
}

/** "184 of 200 GB reserved" or "72 GB · shares the pool". */
function UsageLine({ used, reserved }: { used: number; reserved: number | null }) {
  const t = useT();
  return reserved
    ? <Text numberOfLines={2} className="text-xs text-foreground" style={{ fontFamily: fonts.medium }}>{t("family.label.usedOfReservedReserved", { used: gigabyteFigure(used), reserved: formatGigabytes(reserved) })}</Text>
    : <Text numberOfLines={2} className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("family.label.usedSharesThePool", { used: formatGigabytes(used) })}</Text>;
}

function MemberBody({ data, people, dark, busy, onLeave }: { data: FamilyView; people: FamilyPerson[]; dark: boolean; busy: boolean; onLeave: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const me = people.find((p) => p.isYou);
  const ownReserved = data.own_reserved_bytes ?? null;
  const ownUsed = data.own_used_bytes ?? me?.used ?? 0;
  return (
    <View className="mt-4 gap-4">
      {ownReserved !== null && ownReserved > 0 && (
        <View testID="family-own-reservation" className="rounded-2xl bg-secondary p-4">
          <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("family.label.reservedForYouByPayerName", { payerName: data.payer?.name ?? "" })}</Text>
          <Text className="mt-0.5 text-2xl text-foreground" style={{ fontFamily: fonts.bold }}>{t("family.label.usedOfReserved", { used: gigabyteFigure(ownUsed), reserved: formatGigabytes(ownReserved) })}</Text>
          <View className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted">
            <View className="h-full rounded-full" style={{ width: `${Math.min(100, (ownUsed / ownReserved) * 100)}%`, backgroundColor: personColor(me?.colorIndex ?? 0, dark) }} />
          </View>
          <Text className="mt-2 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("family.description.thisSpaceIsYoursAloneUploadsStopAtSize", { size: formatGigabytes(ownReserved) })}</Text>
        </View>
      )}
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.regular }}>
        {t("family.description.youAreOnPayerNameSPlanNamePlanYourFiles", { payerName: data.payer?.name ?? "", planName: data.plan.name })}
      </Text>
      {people.length > 0 && (
        <View>
          {people.map((p, i) => (
            <PersonRow key={p.key} id={p.key} name={p.isYou ? t("family.label.nameYou", { name: p.name }) : p.name} colorIndex={p.colorIndex} dark={dark}
              last={i === people.length - 1} sub={<UsageLine used={p.used} reserved={p.reserved} />}
              end={p.isPayer ? <StatusBadge label={t("family.status.paysThePlan")} colorIndex={null} dark={dark} /> : <StatusBadge label={t("family.status.joined")} colorIndex={p.colorIndex} dark={dark} />} />
          ))}
        </View>
      )}
      <View className="gap-2">
        <Pressable testID="family-leave" accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onLeave}
          className={`h-11 items-center justify-center rounded-2xl border border-border ${busy ? "opacity-60" : ""}`}>
          <Text className="text-base" style={{ fontFamily: fonts.bold, color: tokens.destructive }}>{t("family.action.leaveFamilyPlan")}</Text>
        </Pressable>
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("family.description.ifYouLeaveYourAccountReturnsToTheFree")}</Text>
      </View>
    </View>
  );
}

function PayerBody({ data, people, colorOf, dark, email, setEmail, inviting, onInvite, onAsk, onReserve, busy }: {
  data: FamilyView; people: FamilyPerson[]; colorOf: Map<string, number>; dark: boolean;
  email: string; setEmail: (v: string) => void; inviting: boolean; onInvite: () => void;
  onAsk: (kind: "remove" | "revoke" | "resend", m: FamilyMemberView) => void; onReserve: (m: FamilyMemberView) => void; busy: boolean;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const members = data.members ?? [];
  const over = data.over_capacity === true;
  const full = members.length >= data.limit;
  const payer = people.find((p) => p.isPayer);
  const places = typeof data.included === "number" ? ` ${t("family.label.includedIncludedExtraPlacesExtra", { included: localDigits(data.included), extraPlaces: localDigits(data.extra_places ?? 0) })}` : "";
  const rows = (payer ? 1 : 0) + members.length;

  const memberRow = (m: FamilyMemberView, i: number) => {
    const invited = m.status === "invited";
    const colorIndex = invited ? null : colorOf.get(m.id) ?? null;
    const name = m.name ?? m.email;
    const sub = invited ? (
      <Text numberOfLines={1} className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
        {t("profile.label.expiresHasDateSelectTrueDateOtherSoon", { hasDate: String(!!m.expires_at), date: m.expires_at ? formatDateWith(m.expires_at, {}) : "" })}
      </Text>
    ) : m.used_bytes !== undefined ? <UsageLine used={m.used_bytes} reserved={m.reserved_bytes ?? null} />
      : <Text numberOfLines={1} className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{m.email}</Text>;
    const canReserve = data.eligible && !invited && m.max_reservable_bytes !== undefined;
    const reserved = m.reserved_bytes ?? null;
    const end = (
      <View className="flex-row items-center gap-1">
        {canReserve ? (
          <Pressable testID={`family-reserve-${m.id}`} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} hitSlop={6} onPress={() => onReserve(m)}
            accessibilityLabel={reserved ? t("family.heading.changeNameSReservation", { name }) : t("family.heading.reserveStorageForName", { name })}
            className="h-[30px] flex-row items-center gap-1 rounded-full px-2.5"
            style={{ borderWidth: 1.5, borderColor: tokens.border, borderStyle: reserved ? "solid" : "dashed" }}>
            <Icon name={reserved ? "hard-drive-outline" : "add"} size={14} color={reserved ? tokens.foreground : tokens.mutedForeground} />
            <Text numberOfLines={1} className={`text-xs ${reserved ? "text-foreground" : "text-muted-foreground"}`} style={{ fontFamily: fonts.bold }}>
              {reserved ? formatGigabytes(reserved) : t("family.action.reserve")}
            </Text>
          </Pressable>
        ) : invited
          ? <StatusBadge label={t("common.status.invited")} colorIndex={null} dark={dark} />
          : <StatusBadge label={t("family.status.joined")} colorIndex={colorIndex} dark={dark} />}
        {invited && data.eligible && (
          <Pressable testID={`family-resend-${m.id}`} accessibilityRole="button" disabled={busy} accessibilityLabel={t("family.accessibility.sendInvitationToEmailAgain", { email: m.email })} hitSlop={8} onPress={() => onAsk("resend", m)} className="p-2">
            <Icon name="mail-outline" size={18} color={tokens.mutedForeground} />
          </Pressable>
        )}
        <Pressable testID={`family-remove-${m.id}`} accessibilityRole="button" disabled={busy} accessibilityLabel={!invited ? t("common.accessibility.removeMName", { mName: name }) : t("family.accessibility.revokeInvitationToEmail", { email: m.email })}
          hitSlop={8} onPress={() => onAsk(!invited ? "remove" : "revoke", m)} className="p-2">
          <Icon name="person-remove" size={18} color={tokens.mutedForeground} />
        </Pressable>
      </View>
    );
    return <PersonRow key={m.id} id={m.id} name={name} colorIndex={colorIndex} dark={dark} sub={sub} end={end} last={(payer ? 1 : 0) + i === rows - 1} />;
  };

  return (
    <View className="mt-4 gap-3">
      <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>{t("profile.label.memberscountOfLimitPlacesUsedPlaces", { membersCount: localDigits(members.length), limit: localDigits(data.limit), places })}</Text>
      {over && (
        <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("family.description.youHaveMorePeopleThanPlacesNobodyHasBeen")}
        </Text>
      )}
      {rows > 0 && (
        <View>
          {payer && (
            <PersonRow id={payer.key} name={payer.isYou ? t("family.label.nameYou", { name: payer.name }) : payer.name} colorIndex={payer.colorIndex} dark={dark}
              sub={<UsageLine used={payer.used} reserved={null} />} end={<StatusBadge label={t("family.status.paysThePlan")} colorIndex={null} dark={dark} />} last={rows === 1} />
          )}
          {members.map(memberRow)}
        </View>
      )}
      {data.eligible ? (
        <View className="gap-2">
          <TextField testID="family-invite-email" value={email} onChangeText={setEmail} placeholder={t("family.placeholder.familyExampleCom")} keyboardType="email-address" autoCapitalize="none" />
          <Button testID="family-invite" title={t("common.action.invite")} loading={inviting} disabled={full || over || !email.trim()} onPress={onInvite} />
          {full && !over && (
            <Text className="text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
              {t("family.description.allLimitPlacesAreTakenRemoveSomeoneOrRevoke", { limit: localDigits(data.limit) })}
            </Text>
          )}
        </View>
      ) : (
        <Text className="text-sm text-muted-foreground" style={{ fontFamily: fonts.regular }}>
          {t("family.error.yourPlanHasEndedSoYouCannotInviteAnyonePeriodSentenceCaseWithStillremovepeopleorrevokeinvitationshere")}
        </Text>
      )}
    </View>
  );
}
