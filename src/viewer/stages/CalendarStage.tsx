import { useMemo } from "react";
import { View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatDateWith } from "@/lib/format-locale";
import { calendarSpan, type IcalOccurrence } from "@/lib/ical.generated";
import { eventCount, firstOnOrAfter, isCancelled, isSingleEvent, todayKey, type ParsedCalendar } from "@/calendar/calendarRead";

/** How many events the peek shows. Enough to recognise the calendar by. */
const PEEK = 3;

const tzOf = (allDay: boolean) => (allDay ? "UTC" : undefined);

const stem = (fileName: string) => fileName.replace(/\.(ics|ical|icalendar)$/i, "");

/**
 * A peek at the calendar, like ContactsStage is a peek at an address book:
 * its name, how many events and over what span, and the next few of them (or
 * the last few, for a calendar that is all in the past). A single invite shows
 * as its date and title. Reading it all lives on the calendar route, which the
 * primary action ("Open") opens.
 *
 * `parsed` is null for a calendar over the inline text cap: the viewer does
 * not fetch or parse that body, so the card names the file and its size only.
 */
export function CalendarStage({ parsed, fileName, sizeLabel }: { parsed: ParsedCalendar | null; fileName: string; sizeLabel: string }) {
  if (!parsed) return <UnreadCalendar fileName={fileName} sizeLabel={sizeLabel} />;
  return <ParsedCalendarStage parsed={parsed} fileName={fileName} />;
}

function UnreadCalendar({ fileName, sizeLabel }: { fileName: string; sizeLabel: string }) {
  const t = useT();
  const { tokens } = useColorTheme();
  return (
    <View testID="calendar-stage" className="flex-1 items-center justify-center px-8">
      <View testID="calendar-stage-unread" className="w-full flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3.5">
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-primary">
          <Icon name="calendar-outline" size={20} color={tokens.primaryForeground} />
        </View>
        <View className="flex-1">
          <Text className="text-[14px] font-bold text-foreground" numberOfLines={1}>{stem(fileName)}</Text>
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>{`${t("common.label.calendar")} · ${sizeLabel}`}</Text>
        </View>
      </View>
    </View>
  );
}

function ParsedCalendarStage({ parsed, fileName }: { parsed: ParsedCalendar; fileName: string }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { cal, occ } = parsed;
  const single = isSingleEvent(cal);
  const peek = useMemo(() => {
    const start = firstOnOrAfter(occ, todayKey());
    const from = start >= occ.length ? Math.max(0, occ.length - PEEK) : start;
    return occ.slice(from, from + PEEK);
  }, [occ]);
  const sub = useMemo(() => {
    const { first, last } = calendarSpan(cal);
    const f = (ms: number) => formatDateWith(new Date(ms), { month: "short", year: "numeric", timeZone: "UTC" });
    const span = f(first) === f(last) ? f(first) : `${f(first)} - ${f(last)}`;
    return `${t("common.description.eventCount", { count: eventCount(cal) })} · ${span}`;
  }, [cal, t]);

  return (
    <View testID="calendar-stage" className="flex-1 items-center justify-center px-8">
      <View className="w-full gap-2">
        {single ? null : (
          <View className="mb-1 flex-row items-center gap-3 px-1">
            <View className="h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Icon name="calendar-outline" size={18} color={tokens.primaryForeground} />
            </View>
            <View className="flex-1">
              <Text className="text-[14px] font-bold text-foreground" numberOfLines={1}>{cal.name || stem(fileName)}</Text>
              <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>{sub}</Text>
            </View>
          </View>
        )}
        {peek.map((o, i) => <PeekCard key={`${o.key}-${i}`} o={o} index={i} />)}
      </View>
    </View>
  );
}

function PeekCard({ o, index }: { o: IcalOccurrence; index: number }) {
  const t = useT();
  const tz = tzOf(o.allDay);
  const dead = isCancelled(o.event);
  return (
    <View testID={`calendar-peek-${index}`} className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3">
      <View className="w-10 items-center">
        <Text className="text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.mono }}>
          {formatDateWith(new Date(o.start), { month: "short", timeZone: tz })}
        </Text>
        <Text className="text-[17px] font-bold text-foreground">{formatDateWith(new Date(o.start), { day: "numeric", timeZone: tz })}</Text>
      </View>
      <View className="flex-1">
        <Text className={`text-[13.5px] font-medium ${dead ? "text-muted-foreground line-through" : "text-foreground"}`} numberOfLines={1}>
          {o.event.summary || t("common.label.untitledEvent")}
        </Text>
        <Text className="text-[10.5px] text-muted-foreground" numberOfLines={1} style={{ fontFamily: fonts.mono }}>
          {o.allDay ? t("common.label.allDay") : formatDateWith(new Date(o.start), { weekday: "short", hour: "numeric", minute: "2-digit" })}
          {o.event.location ? ` · ${o.event.location}` : ""}
        </Text>
      </View>
    </View>
  );
}
