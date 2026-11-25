import { useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Linking, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { SheetHandle } from "@/ui/SheetHandle";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { formatDateWith } from "@/lib/format-locale";
import { inputStartAlign } from "@/lib/direction";
import { isSafeExternalUrl } from "@/lib/safeUrl";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { shareFile } from "@/files/download";
import {
  calendarSpan, dayKey, googleCalendarLink, occurrenceDays, singleEventIcs,
  type IcalEvent, type IcalOccurrence, type IcalPartStat, type IcalPerson,
} from "@/lib/ical.generated";
import {
  DAY_MS, describeRule, eventCount, firstOnOrAfter, isCancelled, isSingleEvent, keyParts, todayKey, viewerZone,
  type ParsedCalendar,
} from "./calendarRead";

/**
 * A .ics shown as a calendar instead of BEGIN:VEVENT text, on its own route.
 *
 * The phone port of the web viewer (apps/web/src/components/calendar-viewer.tsx),
 * minus its side rail: a compact header, then the agenda (opening at today),
 * one month as a grid, or the source. Tapping an event opens its details in a
 * bottom sheet. Read-only. A file with a single event (an invite, a booking)
 * is one card.
 */

// ── Formatting ─────────────────────────────────────────────────────────────

const tzOf = (allDay: boolean) => (allDay ? "UTC" : undefined);
const fmtTime = (ms: number) => formatDateWith(new Date(ms), { hour: "numeric", minute: "2-digit" });
const fmtDay = (ms: number, allDay: boolean) => formatDateWith(new Date(ms), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tzOf(allDay) });
const fmtMonth = (y: number, m: number) => formatDateWith(new Date(Date.UTC(y, m - 1, 1)), { month: "long", year: "numeric", timeZone: "UTC" });
const fmtUtc = (ms: number, opts: Intl.DateTimeFormatOptions) => formatDateWith(new Date(ms), { ...opts, timeZone: "UTC" });
type Tr = ReturnType<typeof useT>;

function whenLine(o: IcalOccurrence, tr: Tr): string {
  if (o.allDay) {
    const last = Math.max(o.start, o.end - DAY_MS);
    return last > o.start ? `${fmtDay(o.start, true)} - ${fmtDay(last, true)}` : `${fmtDay(o.start, true)}, ${tr("common.label.allDay")}`;
  }
  if (o.end <= o.start) return `${fmtDay(o.start, false)}, ${fmtTime(o.start)}`;
  const same = dayKey(o.start, false, viewerZone) === dayKey(o.end - 1, false, viewerZone);
  return same
    ? `${fmtDay(o.start, false)}, ${fmtTime(o.start)} - ${fmtTime(o.end)}`
    : `${fmtDay(o.start, false)}, ${fmtTime(o.start)} - ${fmtDay(o.end, false)}, ${fmtTime(o.end)}`;
}

/** The time where the event was made, when that clock differs from the viewer's. */
function originalZone(o: IcalOccurrence, tr: Tr): string | null {
  const tz = o.event.start.tz;
  if (o.allDay || !tz || tz === viewerZone) return null;
  const f = (ms: number) => formatDateWith(new Date(ms), { hour: "numeric", minute: "2-digit", timeZone: tz });
  if (f(o.start) === fmtTime(o.start) && dayKey(o.start, false, tz) === dayKey(o.start, false, viewerZone)) return null;
  const time = o.end > o.start ? `${f(o.start)} - ${f(o.end)}` : f(o.start);
  return tr("common.description.timeInZone", { time, zone: tz.replace(/_/g, " ") });
}

function reminderText(min: number, tr: Tr): string {
  if (min > 0 && min % 1440 === 0) return tr("common.description.reminderDaysBefore", { count: min / 1440 });
  if (min > 0 && min % 60 === 0) return tr("common.description.reminderHoursBefore", { count: min / 60 });
  return tr("common.description.reminderMinutesBefore", { count: Math.max(0, min) });
}

function rsvpLabel(s: IcalPartStat | null, tr: Tr): string | null {
  switch (s) {
    case "accepted": return tr("common.status.rsvpGoing");
    case "tentative": return tr("common.status.rsvpMaybe");
    case "declined": return tr("common.status.rsvpDeclined");
    case "needs-action": return tr("common.status.rsvpNoReply");
    default: return null;
  }
}
const RSVP_DOT: Record<string, string> = { accepted: "bg-green-500", tentative: "bg-amber-500", declined: "bg-red-500", "needs-action": "bg-muted-foreground" };

/** The organizer is usually on the guest list too; list them once. */
const sameAs = (p: IcalPerson, o: IcalPerson | null) =>
  !!o && ((!!p.email && p.email.toLowerCase() === o.email?.toLowerCase()) || (!p.email && !!p.name && p.name === o.name));

/** Links come from the file, so only https reaches the opener (see lib/safeUrl). */
const safeLink = (u: string | null) => (u && isSafeExternalUrl(u) ? u.trim() : null);
const openLink = (u: string) => { void Linking.openURL(u).catch(() => {}); };

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

const fileStem = (name: string) => name.replace(/\.(ics|ical|icalendar)$/i, "");

/**
 * The one event as its own .ics, handed to the share sheet so the phone's
 * calendar (or Files, or mail) can take it.
 */
async function shareEvent(text: string, ev: IcalEvent, tr: Tr): Promise<void> {
  const stem = (ev.summary || "event").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "event";
  const path = `${FileSystem.cacheDirectory}${stem}.ics`;
  try {
    await FileSystem.writeAsStringAsync(path, singleEventIcs(text, ev));
    await shareFile(path, { mimeType: "text/calendar", UTI: "com.apple.ical.ics", dialogTitle: ev.summary || undefined });
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : tr("common.error.couldnTShareThisFile"), "error");
  }
}

// ── Entry ──────────────────────────────────────────────────────────────────

export interface CalendarViewProps {
  parsed: ParsedCalendar;
  /** The file's text, for exporting one event out of it. */
  text: string;
  fileName: string;
  /** The text stage, for the source tab. */
  source: ReactNode;
  /** False for a view-only file: its owner turned downloads off, so no event leaves it either. */
  canExport: boolean;
}

export function CalendarView(props: CalendarViewProps) {
  const { cal, occ } = props.parsed;
  if (isSingleEvent(cal)) return <SingleEvent {...props} o={occ[0]} />;
  return <CalendarBrowser {...props} />;
}

type Tab = "agenda" | "month" | "details" | "source";

function ViewTabs({ view, setView, views }: { view: Tab; setView: (v: Tab) => void; views: Tab[] }) {
  const t = useT();
  const label = (v: Tab) => (v === "agenda" ? t("common.label.agenda") : v === "month" ? t("common.label.month") : v === "details" ? t("common.action.details") : t("common.label.sourceLowercase"));
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t("common.accessibility.calendarView")} className="flex-row gap-0.5 rounded-lg bg-muted p-0.5">
      {views.map((v) => (
        <Pressable
          key={v}
          testID={`calendar-tab-${v}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: view === v }}
          onPress={() => setView(v)}
          className={`flex-1 items-center rounded-md px-2.5 py-1.5 ${view === v ? "bg-background" : ""}`}
        >
          <Text className={`text-xs font-medium capitalize ${view === v ? "text-foreground" : "text-muted-foreground"}`}>{label(v)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Header({ name, sub, children }: { name: string; sub: string | null; children: ReactNode }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View className="gap-3 border-b border-border px-4 pb-3 pt-3">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary">
          <Icon name="calendar-outline" size={18} color={tokens.primaryForeground} />
        </View>
        <View className="flex-1">
          <Text className="text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1 }}>{t("common.label.calendar")}</Text>
          <Text testID="calendar-name" className="text-[15px] font-bold text-foreground" numberOfLines={1}>{name}</Text>
          {sub ? <Text testID="calendar-sub" className="text-xs text-muted-foreground" numberOfLines={1}>{sub}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

// ── Many events ────────────────────────────────────────────────────────────

const MONTH_H = 36;
const ROW_H = 60;

type Item =
  | { kind: "month"; key: string; y: number; m: number }
  | { kind: "event"; key: string; i: number; day: string; first: boolean };

function matches(o: IcalOccurrence, q: string): boolean {
  const ev = o.event;
  return ev.summary.toLowerCase().includes(q) || (ev.location?.toLowerCase().includes(q) ?? false) || (ev.description?.toLowerCase().includes(q) ?? false);
}

/** Month headers and event rows, flat, so the list can virtualize with fixed heights. */
function buildItems(occ: IcalOccurrence[], indices: Iterable<number>): Item[] {
  const items: Item[] = [];
  let month = "";
  let day = "";
  for (const i of indices) {
    const o = occ[i];
    const key = dayKey(o.start, o.allDay, viewerZone);
    const mk = key.slice(0, 7);
    if (mk !== month) {
      month = mk;
      const [y, m] = keyParts(`${mk}-01`);
      items.push({ kind: "month", key: `m-${mk}`, y, m });
    }
    items.push({ kind: "event", key: `e-${i}`, i, day: key, first: key !== day });
    day = key;
  }
  return items;
}

function CalendarBrowser({ parsed, text, fileName, source, canExport }: CalendarViewProps) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { cal, occ } = parsed;
  const name = cal.name || fileStem(fileName);
  const startIdx = useMemo(() => firstOnOrAfter(occ, todayKey()), [occ]);
  const pastOnly = startIdx >= occ.length;

  const [view, setView] = useState<Tab>("agenda");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [ym, setYm] = useState<[number, number]>(() => {
    const last = occ[occ.length - 1];
    const [y, m] = keyParts(pastOnly ? dayKey(last.start, last.allDay, viewerZone) : todayKey());
    return [y, m];
  });

  const sub = useMemo(() => {
    const { first, last } = calendarSpan(cal);
    const f = (ms: number) => fmtUtc(ms, { month: "short", year: "numeric" });
    const span = f(first) === f(last) ? f(first) : `${f(first)} - ${f(last)}`;
    return `${t("common.description.eventCount", { count: eventCount(cal) })} · ${span}`;
  }, [cal, t]);

  const q = query.trim().toLowerCase();
  const all = useMemo(() => buildItems(occ, occ.keys()), [occ]);
  const items = useMemo(() => {
    if (!q) return all;
    const hits: number[] = [];
    for (let i = 0; i < occ.length; i++) if (matches(occ[i], q)) hits.push(i);
    return buildItems(occ, hits);
  }, [all, occ, q]);

  // Fixed row heights make every offset known, so the list can open at today.
  const offsets = useMemo(() => {
    const out = new Array<number>(items.length);
    let y = 0;
    for (let k = 0; k < items.length; k++) { out[k] = y; y += items[k].kind === "month" ? MONTH_H : ROW_H; }
    return out;
  }, [items]);
  const initialIndex = useMemo(() => (q ? 0 : itemIndexOf(items, pastOnly ? occ.length - 1 : startIdx)), [q, items, pastOnly, occ.length, startIdx]);

  const listRef = useRef<FlatList<Item>>(null);
  const goToday = () => {
    const [y, m] = keyParts(todayKey());
    setYm([y, m]);
    if (view !== "agenda") return;
    // Clearing a search remounts the full list, which opens at today by itself.
    if (q) { setQuery(""); return; }
    const idx = firstOnOrAfter(occ, todayKey());
    listRef.current?.scrollToIndex({ index: itemIndexOf(all, Math.min(idx, occ.length - 1)), animated: true });
  };

  return (
    <View className="flex-1 bg-background">
      <Header name={name} sub={sub}>
        <ViewTabs view={view} setView={setView} views={["agenda", "month", "source"]} />
      </Header>

      {view === "source" ? (
        <View className="flex-1 pt-3">{source}</View>
      ) : (
        <>
          <View className="flex-row items-center gap-2 px-4 py-2">
            <Pressable testID="calendar-today" onPress={goToday} accessibilityRole="button" className="rounded-md border border-border px-2.5 py-1.5">
              <Text className="text-xs font-medium text-foreground">{t("common.label.today")}</Text>
            </Pressable>
            {view === "month" ? (
              <View className="flex-1 flex-row items-center gap-1">
                <Pressable testID="calendar-prev-month" hitSlop={6} accessibilityRole="button" accessibilityLabel={t("common.accessibility.previousMonth")} onPress={() => setYm(([y, m]) => (m === 1 ? [y - 1, 12] : [y, m - 1]))} className="h-8 w-8 items-center justify-center rounded-md border border-border">
                  <Icon name="chevron-back" size={14} color={tokens.foreground} />
                </Pressable>
                <Pressable testID="calendar-next-month" hitSlop={6} accessibilityRole="button" accessibilityLabel={t("common.accessibility.nextMonth")} onPress={() => setYm(([y, m]) => (m === 12 ? [y + 1, 1] : [y, m + 1]))} className="h-8 w-8 items-center justify-center rounded-md border border-border">
                  <Icon name="chevron-forward" size={14} color={tokens.foreground} />
                </Pressable>
                <Text testID="calendar-month-label" className="ms-1 flex-1 text-sm font-bold text-foreground" numberOfLines={1}>{fmtMonth(ym[0], ym[1])}</Text>
              </View>
            ) : (
              <View className="flex-1 flex-row items-center gap-2 rounded-lg border border-border bg-card px-3">
                <Icon name="search" size={14} color={tokens.mutedForeground} />
                <TextInput
                  testID="calendar-search"
                  className="flex-1 py-1.5 text-foreground"
                  style={{ fontFamily: fonts.regular, fontSize: 14, ...inputStartAlign() }}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t("common.placeholder.searchEvents")}
                  placeholderTextColor={tokens.mutedForeground}
                  accessibilityLabel={t("common.placeholder.searchEvents")}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {query ? (
                  <Pressable hitSlop={8} onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel={t("common.action.clearSearch")}>
                    <Icon name="close-circle" size={14} color={tokens.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          {view === "month" ? (
            <MonthGrid occ={occ} y={ym[0]} m={ym[1]} onPick={setSelected} />
          ) : (
            <FlatList
              // A new search is a new list: remount so it opens at its top.
              key={q ? `q-${q}` : "all"}
              ref={listRef}
              testID="calendar-agenda"
              data={items}
              keyExtractor={(it) => it.key}
              initialScrollIndex={items.length ? Math.min(initialIndex, items.length - 1) : undefined}
              getItemLayout={(_d, k) => ({ length: items[k].kind === "month" ? MONTH_H : ROW_H, offset: offsets[k], index: k })}
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="pb-6"
              ListEmptyComponent={
                <Text testID="calendar-empty" className="mt-10 px-6 text-center text-sm text-muted-foreground">
                  {t("common.empty.noEventsMatchQuery", { query: query.trim() })}
                </Text>
              }
              renderItem={({ item }) =>
                item.kind === "month"
                  ? <MonthHeading y={item.y} m={item.m} />
                  : <AgendaRow o={occ[item.i]} index={item.i} day={item.day} first={item.first} onPress={setSelected} />
              }
            />
          )}
        </>
      )}

      <EventSheet
        o={selected !== null ? occ[selected] : null}
        text={text}
        calName={name}
        canExport={canExport}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

/** Where an occurrence sits in the list: on its month header when it opens the month. */
function itemIndexOf(items: Item[], occIndex: number): number {
  const k = items.findIndex((it) => it.kind === "event" && it.i === occIndex);
  if (k < 0) return 0;
  return k > 0 && items[k - 1].kind === "month" ? k - 1 : k;
}

function MonthHeading({ y, m }: { y: number; m: number }) {
  return (
    <View style={{ height: MONTH_H }} className="justify-end bg-background px-4 pb-1.5">
      <Text className="text-[10px] font-bold uppercase text-muted-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1.5 }}>{fmtMonth(y, m)}</Text>
    </View>
  );
}

function EventTime({ o }: { o: IcalOccurrence }) {
  const t = useT();
  return o.allDay
    ? <Text className="text-[11px] font-medium text-foreground">{t("common.label.allDay")}</Text>
    : <Text className="text-[11px] text-muted-foreground">{fmtTime(o.start)}</Text>;
}

function AgendaRow({ o, index, day, first, onPress }: { o: IcalOccurrence; index: number; day: string; first: boolean; onPress: (i: number) => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const ev = o.event;
  const [y, m, d] = keyParts(day);
  const ms = Date.UTC(y, m - 1, d);
  const isToday = day === todayKey();
  const dead = isCancelled(ev);
  return (
    <View style={{ height: ROW_H }} className="flex-row px-3">
      <View className="w-12 items-center pt-2">
        {first ? (
          <>
            <View className={`rounded-md px-1.5 ${isToday ? "bg-foreground" : ""}`}>
              <Text className={`text-lg font-bold ${isToday ? "text-background" : "text-foreground"}`}>{fmtUtc(ms, { day: "numeric" })}</Text>
            </View>
            <Text className="text-[10px] uppercase text-muted-foreground">{fmtUtc(ms, { weekday: "short" })}</Text>
          </>
        ) : null}
      </View>
      <Pressable
        testID={`calendar-event-${index}`}
        onPress={() => onPress(index)}
        accessibilityRole="button"
        className="my-1 flex-1 flex-row items-center gap-2.5 rounded-xl border border-border bg-card px-3"
      >
        <View className="h-7 w-1 rounded-full bg-primary" />
        <View className="flex-1">
          <Text
            className={`text-[13.5px] font-medium ${dead ? "text-muted-foreground line-through" : "text-foreground"}`}
            numberOfLines={1}
          >
            {ev.summary || t("common.label.untitledEvent")}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <EventTime o={o} />
            {ev.location ? <Text className="flex-1 text-[11px] text-muted-foreground" numberOfLines={1}>{ev.location}</Text> : null}
          </View>
        </View>
        {o.recurring ? <Icon name="repeat" size={13} color={tokens.mutedForeground} /> : null}
        {ev.attendees.length > 0 ? <Icon name="people-outline" size={13} color={tokens.mutedForeground} /> : null}
      </Pressable>
    </View>
  );
}

// ── Month ──────────────────────────────────────────────────────────────────

/** Monday-first weeks, like the web grid. */
function monthShape(y: number, m: number) {
  const first = Date.UTC(y, m - 1, 1);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const cells = Math.ceil((lead + days) / 7) * 7;
  return { first, days, lead, cells };
}

function monthBuckets(occ: IcalOccurrence[], first: number, cells: number, lead: number): Map<string, number[]> {
  const startKey = new Date(first - lead * DAY_MS).toISOString().slice(0, 10);
  const endKey = new Date(first + (cells - lead) * DAY_MS).toISOString().slice(0, 10);
  const buckets = new Map<string, number[]>();
  const from = first - (lead + 63) * DAY_MS;
  let lo = 0, hi = occ.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (occ[mid].start < from) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < occ.length; i++) {
    const o = occ[i];
    if (o.start > first + (cells + 1) * DAY_MS) break;
    for (const k of occurrenceDays(o, viewerZone)) {
      if (k < startKey || k >= endKey) continue;
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(i);
    }
  }
  for (const b of buckets.values()) b.sort((a, c) => Number(occ[c].allDay) - Number(occ[a].allDay) || occ[a].start - occ[c].start);
  return buckets;
}

/**
 * One month as a 7-column grid of days with a dot per event, and the picked
 * day's events listed under it. Titles do not fit a phone-width cell.
 */
function MonthGrid({ occ, y, m, onPick }: { occ: IcalOccurrence[]; y: number; m: number; onPick: (i: number) => void }) {
  const { first, days, lead, cells } = monthShape(y, m);
  const buckets = useMemo(() => monthBuckets(occ, first, cells, lead), [occ, first, cells, lead]);
  const today = todayKey();
  const [picked, setPicked] = useState<string | null>(null);
  // A day in the shown month: the picked one, else today when it is in view, else the first with events.
  const inMonth = (k: string) => k.startsWith(`${y}-${String(m).padStart(2, "0")}`);
  const day = picked && inMonth(picked) ? picked : inMonth(today) ? today : [...buckets.keys()].filter(inMonth).sort()[0] ?? null;
  const list = day ? buckets.get(day) ?? [] : [];

  return (
    <ScrollView testID="calendar-month" contentContainerClassName="pb-6">
      <View className="flex-row px-2">
        {Array.from({ length: 7 }, (_, k) => (
          <Text key={k} className="flex-1 py-1 text-center text-[10px] font-bold uppercase text-muted-foreground" numberOfLines={1}>
            {fmtUtc(Date.UTC(2024, 0, 1 + k), { weekday: "narrow" })}
          </Text>
        ))}
      </View>
      <View className="flex-row flex-wrap px-2">
        {Array.from({ length: cells }, (_, c) => {
          const ms = first + (c - lead) * DAY_MS;
          const key = new Date(ms).toISOString().slice(0, 10);
          const within = c >= lead && c < lead + days;
          const n = buckets.get(key)?.length ?? 0;
          const isPicked = key === day;
          const isToday = key === today;
          return (
            <Pressable
              key={key}
              testID={`calendar-day-${key}`}
              onPress={() => setPicked(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: isPicked }}
              style={{ width: `${100 / 7}%` }}
              className="items-center py-1.5"
            >
              <View className={`h-8 w-8 items-center justify-center rounded-full ${isToday ? "bg-foreground" : isPicked ? "bg-muted" : ""}`}>
                <Text className={`text-[13px] ${isToday ? "font-bold text-background" : within ? "text-foreground" : "text-muted-foreground"}`}>
                  {fmtUtc(ms, { day: "numeric" })}
                </Text>
              </View>
              <View className="mt-0.5 h-1.5 flex-row gap-0.5">
                {Array.from({ length: Math.min(3, n) }, (_, k) => <View key={k} className="h-1.5 w-1.5 rounded-full bg-primary" />)}
              </View>
            </Pressable>
          );
        })}
      </View>
      {day ? (
        <View className="mt-2 border-t border-border pt-2">
          {list.map((i) => (
            <AgendaRow key={i} o={occ[i]} index={i} day={day} first={i === list[0]} onPress={onPick} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

// ── Details ────────────────────────────────────────────────────────────────

function Row({ icon, children }: { icon: IconName; children: ReactNode }) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row gap-3 px-1 py-2.5">
      <View className="pt-0.5"><Icon name={icon} size={16} color={tokens.mutedForeground} /></View>
      <View className="flex-1">{children}</View>
    </View>
  );
}

function Person({ name, sub, status }: { name: string; sub: string | null; status: IcalPartStat | null }) {
  return (
    <View className="flex-row items-center gap-2 py-1">
      <View className="h-7 w-7 items-center justify-center rounded-full bg-muted">
        <Text className="text-[10px] font-bold text-foreground">{initialsOf(name)}</Text>
        {status && RSVP_DOT[status] ? <View className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${RSVP_DOT[status]}`} /> : null}
      </View>
      <Text className="flex-1 text-[13px] text-foreground" numberOfLines={1}>{name}</Text>
      {sub ? <Text className="text-[11px] text-muted-foreground">{sub}</Text> : null}
    </View>
  );
}

function DetailRows({ o }: { o: IcalOccurrence }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const ev = o.event;
  const orig = originalZone(o, t);
  const call = safeLink(ev.conference);
  const link = safeLink(ev.url);
  const people = ev.attendees;
  const going = people.filter((p) => p.status === "accepted").length;
  return (
    <View>
      <Row icon="time-outline">
        <Text className="text-[13.5px] text-foreground">{whenLine(o, t)}</Text>
        {orig ? <Text className="text-xs text-muted-foreground">{orig}</Text> : null}
      </Row>
      {call ? (
        <Row icon="videocam-outline">
          <Pressable testID="calendar-join-call" onPress={() => openLink(call)} accessibilityRole="link" className="self-start rounded-lg bg-primary px-3 py-1.5">
            <Text className="text-xs font-bold text-primary-foreground">{t("common.action.joinCall")}</Text>
          </Pressable>
          <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={2}>{call.replace(/^https:\/\//, "")}</Text>
        </Row>
      ) : null}
      {ev.rule ? <Row icon="repeat"><Text className="text-[13.5px] text-foreground">{describeRule(ev.rule, ev.start, t)}</Text></Row> : null}
      {!ev.rule && o.recurring && ev.recurrenceId ? (
        <Row icon="repeat"><Text className="text-[13.5px] text-foreground">{t("common.description.repeatChangedOccurrence")}</Text></Row>
      ) : null}
      {ev.location ? (
        <Row icon="location-outline">
          <Pressable testID="calendar-location" onPress={() => openLink(`https://maps.google.com/?q=${encodeURIComponent(ev.location!)}`)} accessibilityRole="link">
            <Text className="text-[13.5px] text-foreground underline">{ev.location}</Text>
          </Pressable>
        </Row>
      ) : null}
      {people.length > 0 || ev.organizer ? (
        <Row icon="people-outline">
          {people.length > 0 ? (
            <Text className="text-[13.5px] text-foreground">
              {t("common.description.guestCount", { count: people.length })}
              {going > 0 ? <Text className="text-muted-foreground">{` · ${t("common.description.guestsGoing", { count: going })}`}</Text> : null}
            </Text>
          ) : null}
          <View className="mt-1.5">
            {ev.organizer && (ev.organizer.name || ev.organizer.email) ? (
              <Person name={ev.organizer.name ?? ev.organizer.email!} sub={t("common.label.organizer")} status={null} />
            ) : null}
            {people.filter((p) => !sameAs(p, ev.organizer)).slice(0, 60).map((p, i) => (
              <Person key={i} name={p.name ?? p.email ?? "?"} sub={rsvpLabel(p.status, t)} status={p.status} />
            ))}
            {people.length > 60 ? (
              <Text className="text-xs text-muted-foreground">{t("common.label.activelengthMore", { activeLength: people.length - 60 })}</Text>
            ) : null}
          </View>
        </Row>
      ) : null}
      {ev.alarms.length > 0 ? (
        <Row icon="notifications-outline"><Text className="text-[13.5px] text-foreground">{ev.alarms.map((a) => reminderText(a, t)).join(", ")}</Text></Row>
      ) : null}
      {ev.description ? (
        <Row icon="document-text-outline">
          <View className="rounded-lg bg-muted p-2.5">
            <Text selectable className="text-xs leading-[18px] text-foreground">{ev.description}</Text>
          </View>
        </Row>
      ) : null}
      {link && link !== call ? (
        <Row icon="link-outline">
          <Pressable onPress={() => openLink(link)} accessibilityRole="link">
            <Text className="text-[13px] underline" style={{ color: tokens.primary }} numberOfLines={2}>{link}</Text>
          </Pressable>
        </Row>
      ) : null}
    </View>
  );
}

function EventActions({ o, text, canExport, solidGoogle }: { o: IcalOccurrence; text: string; canExport: boolean; solidGoogle?: boolean }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row flex-wrap gap-2">
      <Pressable
        testID="calendar-add-google"
        onPress={() => openLink(googleCalendarLink(o))}
        accessibilityRole="link"
        className={`flex-row items-center gap-1.5 rounded-lg px-3 py-2 ${solidGoogle ? "bg-primary" : "border border-border"}`}
      >
        <Icon name="open-outline" size={14} color={solidGoogle ? tokens.primaryForeground : tokens.foreground} />
        <Text className={`text-xs font-medium ${solidGoogle ? "text-primary-foreground" : "text-foreground"}`}>{t("common.action.addToGoogleCalendar")}</Text>
      </Pressable>
      {canExport ? (
        <Pressable
          testID="calendar-share-event"
          onPress={() => void shareEvent(text, o.event, t)}
          accessibilityRole="button"
          className="flex-row items-center gap-1.5 rounded-lg border border-border px-3 py-2"
        >
          <Icon name="share-outline" size={14} color={tokens.foreground} />
          <Text className="text-xs font-medium text-foreground">{t("common.action.share")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EventSheet({ o, text, calName, canExport, onClose }: { o: IcalOccurrence | null; text: string; calName: string; canExport: boolean; onClose: () => void }) {
  const t = useT();
  const pad = useSheetBottomPad();
  const ev = o?.event;
  return (
    <Modal visible={!!o} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable testID="calendar-sheet-backdrop" className="flex-1 justify-end bg-black/40" onPress={onClose}>
        {o && ev ? (
          // A Pressable that does nothing, so a tap inside the sheet does not reach the backdrop.
          <Pressable testID="calendar-event-sheet" onPress={() => {}} className="max-h-[85%] rounded-t-2xl bg-card" style={{ paddingBottom: pad }}>
            <SheetHandle onDismiss={onClose} className="px-5 pb-2 pt-2">
              <View className="flex-row items-center gap-2">
                <View className="h-2 w-2 rounded-sm bg-primary" />
                <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>{calName}</Text>
                {isCancelled(ev) ? <Text className="text-xs font-bold text-destructive">{t("common.status.eventCancelled")}</Text> : null}
              </View>
              <Text className={`mt-1 text-lg font-bold text-foreground ${isCancelled(ev) ? "line-through" : ""}`}>{ev.summary || t("common.label.untitledEvent")}</Text>
            </SheetHandle>
            <ScrollView className="px-4" contentContainerClassName="pb-3">
              <DetailRows o={o} />
            </ScrollView>
            <View className="border-t border-border px-4 pt-3">
              <EventActions o={o} text={text} canExport={canExport} />
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

// ── One event ──────────────────────────────────────────────────────────────

function SingleEvent({ o, parsed, text, fileName, source, canExport }: CalendarViewProps & { o: IcalOccurrence }) {
  const t = useT();
  const [view, setView] = useState<Tab>("details");
  const ev = o.event;
  const dead = isCancelled(ev) || parsed.cal.method === "CANCEL";
  const [now] = useState(() => Date.now());
  const state = dead ? t("common.status.eventCancelled") : o.end < now && o.end > o.start ? t("common.status.eventEnded") : o.start <= now && o.end >= now ? t("common.status.eventNow") : null;
  const tz = tzOf(o.allDay);
  return (
    <View className="flex-1 bg-background">
      <Header name={fileName} sub={null}>
        <ViewTabs view={view} setView={setView} views={["details", "source"]} />
      </Header>
      {view === "source" ? (
        <View className="flex-1 pt-3">{source}</View>
      ) : (
        <ScrollView contentContainerClassName="p-4">
          <View testID="calendar-single" className="overflow-hidden rounded-2xl border border-border bg-card">
            <View className="flex-row border-b border-dashed border-border">
              <View className="w-24 items-center justify-center bg-primary px-1.5 py-4">
                <Text className="text-[11px] font-bold uppercase text-primary-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1.5 }}>
                  {formatDateWith(new Date(o.start), { month: "short", timeZone: tz })}
                </Text>
                <Text className="text-4xl font-bold text-primary-foreground">{formatDateWith(new Date(o.start), { day: "numeric", timeZone: tz })}</Text>
                <Text className="text-xs text-primary-foreground" numberOfLines={1}>{formatDateWith(new Date(o.start), { weekday: "long", timeZone: tz })}</Text>
              </View>
              <View className="flex-1 justify-center gap-1.5 px-4 py-4">
                {state ? (
                  <View className={`self-start rounded-full px-2 py-0.5 ${dead ? "bg-destructive/10" : "bg-muted"}`}>
                    <Text className={`text-xs font-medium ${dead ? "text-destructive" : "text-foreground"}`}>{state}</Text>
                  </View>
                ) : null}
                <Text className={`text-lg font-bold text-foreground ${dead ? "line-through" : ""}`}>{ev.summary || t("common.label.untitledEvent")}</Text>
              </View>
            </View>
            <View className="px-3 py-1">
              <DetailRows o={o} />
            </View>
            <View className="border-t border-border px-4 py-3">
              <EventActions o={o} text={text} canExport={canExport} solidGoogle />
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
