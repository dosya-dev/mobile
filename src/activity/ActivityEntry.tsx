import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { Avatar } from "@/ui/Avatar";
import { Badge } from "@/ui/Badge";
import { fonts } from "@/theme/fonts";
import { relativeTime } from "@/notifications/inbox";
import { isolateInRtl, rtlLine, useT } from "@/lib/i18n";
import { DATE_TIME_NUMERIC, formatDateWith, localDigits } from "@/lib/format-locale";
import type { T } from "@/i18n/translator";
import { actionPhrase, parseUA } from "./catalog.generated";
import { activitySentence, activitySentenceTemplate } from "./activityLabels";
import type { ActivityRow } from "./api";

/** Absolute timestamp for the detail block - the feed's relative times are
 * useless the moment someone is reconstructing what happened when. */
function absoluteTime(createdAt: number): string {
  return formatDateWith(createdAt, DATE_TIME_NUMERIC);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * The badges beside the timestamp. Each one is here because it answers a
 * question the sentence above it raises and the detail block would hide: what
 * the rename was, who it was really done by, which client did it, whether it
 * actually worked.
 */
function rowBadges(a: ActivityRow, t: T): string[] {
  const meta = a.meta ?? {};
  const out: string[] = [];
  // `outcome` is "success" on almost every row; only a failure is worth a badge.
  if (a.outcome && a.outcome !== "success") out.push(a.outcome);
  if (a.on_behalf_of) out.push(t("activity.label.onBehalfOfName", { name: a.obo_name ?? a.on_behalf_of }));
  // "web" is the assumed origin, so saying it adds nothing; "mobile" or "cli" does.
  if (a.source && a.source !== "web") out.push(a.source);
  const oldName = str(meta.old_name);
  const newName = str(meta.new_name);
  if (oldName && newName) out.push(`${oldName} → ${newName}`);
  const email = str(meta.email);
  if (email) out.push(email);
  const fileCount = num(meta.file_count);
  if (fileCount && fileCount > 1) out.push(t("common.label.filecountFiles", { fileCount: localDigits(fileCount) }));
  const via = str(meta.via);
  if (via) out.push(t("activity.label.viaVia", { via }));
  return out;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row gap-3 py-0.5">
      <Text className="w-16 shrink-0 text-[11px] text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-[11px] text-foreground">{value}</Text>
    </View>
  );
}

/**
 * The detail behind a row: when, where from, on what device, through which
 * client, and against which resource.
 *
 * Every forensic field here can be null, and on a non-privileged viewer's view
 * of someone ELSE's row they all are - the API scrubs them server-side
 * (gateActivityRow). So this renders what survived rather than deciding who is
 * allowed to see what; a gated row simply shows When and Resource.
 */
function Detail({ row, now }: { row: ActivityRow; now: number }) {
  const t = useT();
  const meta = row.meta ?? {};
  const geo = (meta.geo ?? null) as { city?: string; country?: string } | null;
  const parsed = parseUA(row.user_agent);
  // parseUA is the shared copy and says "Unknown" in English only.
  const device = { ...parsed, browser: parsed.browser === "Unknown" ? t("files.label.unknown") : parsed.browser };
  const where = row.source_ip
    ? row.source_ip + (geo?.country ? ` · ${geo.city ? `${geo.city}, ` : ""}${geo.country}` : "")
    : null;
  const resource = row.resource_name
    ?? row.entity_name
    ?? (row.entity_type ? `${row.entity_type} ${row.entity_id ?? ""}`.trim() : null);
  const reason = str(meta.reason);
  return (
    <View testID={`activity-detail-${row.id}`} className="pb-3 ps-11 pe-5">
      <DetailRow label={t("activity.label.when")} value={rtlLine(`${absoluteTime(row.created_at)} · ${relativeTime(row.created_at, now)}`)} />
      {where ? <DetailRow label={t("files.label.where")} value={rtlLine(where)} /> : null}
      {row.user_agent ? (
        <DetailRow label={t("common.label.device")} value={rtlLine(device.browser + (device.os ? ` · ${device.os}` : ""))} />
      ) : null}
      {row.source ? <DetailRow label={t("activity.label.source")} value={row.source} /> : null}
      {row.outcome ? <DetailRow label={t("activity.label.outcome")} value={row.outcome + (reason ? ` (${reason})` : "")} /> : null}
      {resource ? <DetailRow label={t("activity.label.resource")} value={resource} /> : null}
      {row.user_email ? <DetailRow label={t("activity.label.account")} value={row.user_email} /> : null}
      {row.session_id ? <DetailRow label={t("activity.label.session")} value={row.session_id} /> : null}
    </View>
  );
}

/**
 * The row's sentence, with the actor and the subject in bold. It is ONE
 * message per action code, so each language orders the actor, the verb and the
 * subject its own way; a code this app has no message for keeps the machine
 * name opened up, as the server sent it.
 */
function Sentence({ row, name: rawName, subject: rawSubject, t }: { row: ActivityRow; name: string; subject: string | null; t: T }) {
  const template = activitySentenceTemplate(row.action, !!rawSubject, t);
  // Each name keeps its own direction inside an Arabic, Hebrew or Persian sentence.
  const name = isolateInRtl(rawName);
  const subject = rawSubject === null ? null : isolateInRtl(rawSubject);
  if (template === null) {
    return (
      <>
        <Text style={{ fontFamily: fonts.bold }}>{name}</Text>
        <Text className="text-muted-foreground">{` ${actionPhrase(row.action)}`}</Text>
        {subject ? <Text style={{ fontFamily: fonts.bold }}>{` ${subject}`}</Text> : null}
      </>
    );
  }
  // split() with one capture group alternates text and the captured name.
  const parts = template.split(/\{(actor|subject)\}/);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      // The space before the subject belongs to its bold span.
      const next = parts[i + 1];
      const text = next === "subject" && part.endsWith(" ") ? part.slice(0, -1) : part;
      if (text) out.push(<Text key={i} className="text-muted-foreground">{text}</Text>);
    } else if (part === "actor") {
      out.push(<Text key={i} style={{ fontFamily: fonts.bold }}>{name}</Text>);
    } else {
      const prev = parts[i - 1];
      out.push(
        <Text key={i} style={{ fontFamily: fonts.bold }}>{`${prev.endsWith(" ") ? " " : ""}${subject}`}</Text>,
      );
    }
  });
  return <>{out}</>;
}

/**
 * One activity row: a sentence, its badges, and a detail block it expands into.
 *
 * Expanding in place rather than pushing a screen is deliberate - reading an
 * audit trail is a scanning job, and a row you have to navigate away from (and
 * back to, losing your scroll position) stops being worth opening.
 */
export function ActivityEntry({ row, now }: { row: ActivityRow; now: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const name = row.user_name ?? t("files.label.unknown");
  const subject = row.resource_name ?? str((row.meta ?? {}).name) ?? row.entity_name;
  const badges = rowBadges(row, t);
  return (
    <View className="border-b border-border">
      <Pressable
        testID={`activity-${row.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          activitySentence(row.action, name, subject, t)
          ?? `${name} ${actionPhrase(row.action)}${subject ? ` ${subject}` : ""}`
        }
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-start gap-3 px-5 py-3"
      >
        <Avatar initials={name} color="#706e69" size={32} radius={16} />
        <View className="min-w-0 flex-1">
          <Text className="text-sm leading-snug text-foreground">
            <Sentence row={row} name={name} subject={subject} t={t} />
          </Text>
          <View className="mt-1 flex-row flex-wrap items-center gap-1.5">
            <Text className="text-[11px] text-muted-foreground">{relativeTime(row.created_at, now)}</Text>
            {badges.map((b) => (
              <Badge key={b} label={b} variant="outline" />
            ))}
          </View>
        </View>
      </Pressable>
      {open ? <Detail row={row} now={now} /> : null}
    </View>
  );
}
