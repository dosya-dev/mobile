import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { formatBytes } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { localDigits } from "@/lib/format-locale";
import { personColor, tint } from "./colors";
import { formatGigabytes, gigabyteFigure } from "./format";
import { poolSegments, type FamilyPerson } from "./people";
import type { FamilyView } from "./types";

const SIZE = 200;
const STROKE = 18;
/** The ring radius the web and desktop rings use. */
const R = 84;
const C = 2 * Math.PI * R;

/**
 * The Usage view: a ring for the pool with one arc per person (and a faded
 * arc for reserved space they have not used), then the same people ranked
 * with bars. Both are shares of the WHOLE pool. Totals only, never files.
 * Mirrors apps/desktop/src/renderer/components/family/FamilyUsage.tsx.
 */
export function FamilyUsage({ view, people }: { view: FamilyView; people: FamilyPerson[] }) {
  const t = useT();
  const { scheme, tokens } = useColorTheme();
  const dark = scheme === "dark";
  const limit = Math.max(view.pool.limit_bytes, 1);
  const used = view.pool.used_bytes;
  const pct = localDigits(Math.min(100, Math.round((used / limit) * 100)));
  const reservedTotal = view.pool.reserved_bytes ?? 0;
  const held = view.pool.held_bytes ?? 0;
  const free = view.pool.free_bytes ?? Math.max(0, limit - used);
  const width = (bytes: number) => `${Math.min(100, (Math.max(0, bytes) / limit) * 100)}%` as const;
  const segments = poolSegments(people, dark, 32);
  let offset = 0;
  const arcs = segments.map((s) => {
    const len = (Math.min(Math.max(s.bytes, 0), limit) / limit) * C;
    const arc = { key: s.key, color: s.color, len, offset };
    offset += len;
    return arc;
  });
  const firstReserved = people.find((p) => p.reserved);
  const muted = { fontFamily: fonts.regular, color: tokens.mutedForeground };
  return (
    <View testID="family-usage" className="mt-5 gap-5">
      <View className="items-center">
        <View style={{ width: SIZE, height: SIZE }}>
          <Svg width={SIZE} height={SIZE} accessibilityLabel={t("family.accessibility.pctPercentOfTheFamilyPoolUsed", { pct })}>
            {/* rtl-ok: centering (the ring sits on the disc's centre) */}
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={tokens.muted} strokeWidth={STROKE} fill="none" />
            {arcs.filter((a) => a.len > 0).map((a) => (
              // rtl-ok: centering (the arc circle sits on the disc's centre)
              <Circle key={a.key} cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={a.color} strokeWidth={STROKE} fill="none"
                strokeDasharray={`${Math.max(0, a.len - 2)} ${C}`} strokeDashoffset={-a.offset} rotation={-90} origin={`${SIZE / 2}, ${SIZE / 2}`} />
            ))}
          </Svg>
          <View className="absolute inset-0 items-center justify-center px-8">
            <Text className="text-3xl text-foreground" style={{ fontFamily: fonts.bold }}>{view.pool.used_label}</Text>
            <Text className="mt-1 text-xs" style={muted}>{t("family.label.ofLimitPct", { limitLabel: view.pool.limit_label, pct })}</Text>
            {reservedTotal > 0 && <Text className="text-xs" style={muted}>{t("family.label.sizeReserved", { size: formatGigabytes(reservedTotal) })}</Text>}
          </View>
        </View>
      </View>
      <View className="gap-3">
        {people.map((p) => {
          const color = personColor(p.colorIndex, dark);
          const heldBytes = p.reserved ? Math.max(0, p.reserved - p.used) : 0;
          return (
            <View key={p.key} testID={`family-legend-${p.key}`} className="gap-1.5">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
                  <Text numberOfLines={1} className="text-sm text-foreground" style={{ fontFamily: fonts.regular, flexShrink: 1 }}>{p.isYou ? t("common.label.you") : p.name}</Text>
                  {p.isPayer && <Text className="text-xs" style={muted}>{t("family.label.paysThePlan")}</Text>}
                  {p.reserved ? <Text className="text-xs" style={muted}>{t("family.label.reservedTag")}</Text> : null}
                </View>
                <Text className="text-sm text-foreground" style={{ fontFamily: fonts.mono }}>
                  {p.reserved ? t("family.label.usedOfReserved", { used: gigabyteFigure(p.used), reserved: formatGigabytes(p.reserved) }) : p.usedLabel}
                </Text>
              </View>
              <View className="h-1.5 flex-row overflow-hidden rounded-full bg-muted">
                <View style={{ width: width(p.used), backgroundColor: color }} />
                {heldBytes > 0 && <View style={{ width: width(heldBytes), backgroundColor: tint(color, 32) }} />}
              </View>
            </View>
          );
        })}
        {reservedTotal > 0 ? (
          <>
            <View testID="family-legend-free" className="flex-row items-center justify-between gap-3 border-t border-border pt-2.5">
              <View className="flex-row items-center gap-2">
                <View className="border border-border bg-muted" style={{ width: 10, height: 10, borderRadius: 5 }} />
                <Text className="text-xs" style={muted}>{t("family.label.freeToShare")}</Text>
              </View>
              <Text className="text-xs" style={{ ...muted, fontFamily: fonts.mono }}>{formatGigabytes(free)}</Text>
            </View>
            <View testID="family-legend-held" className="flex-row items-center justify-between gap-3">
              <View className="flex-row items-center gap-2">
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tint(personColor(firstReserved?.colorIndex ?? 1, dark), 32) }} />
                <Text className="text-xs" style={muted}>{t("family.label.heldForReservations")}</Text>
              </View>
              <Text className="text-xs" style={{ ...muted, fontFamily: fonts.mono }}>{formatGigabytes(held)}</Text>
            </View>
          </>
        ) : (
          <View className="flex-row items-center justify-between border-t border-border pt-2.5">
            <Text className="text-xs" style={muted}>{t("family.label.freeInThePool")}</Text>
            <Text className="text-xs" style={{ ...muted, fontFamily: fonts.mono }}>{formatBytes(free)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
