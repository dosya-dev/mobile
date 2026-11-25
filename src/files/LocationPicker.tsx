import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { fonts } from "@/theme/fonts";
import type { RegionInfo } from "./api";
import { useT } from "@/lib/i18n";

/**
 * Group the locations a workspace can be created in, filtered by a search box.
 *
 * A workspace's location is chosen once, at creation, and the server refuses to
 * move it afterwards - so this list is the only place the choice is ever
 * offered and it has to make 40-odd locations findable on a phone. Continents
 * come back in the order the server sent them (first appearance wins), and so
 * do the rows inside each, so the server keeps control of what is listed first.
 * A continent whose locations all fail the search is dropped rather than shown
 * as an empty heading.
 *
 * The query matches a city, a country or a location code, case-insensitively,
 * as a substring. A whitespace-only query is no query at all.
 */
export function groupLocations(regions: RegionInfo[], query: string): [string, RegionInfo[]][] {
  const q = query.trim().toLowerCase();
  const matched = q
    ? regions.filter(
        (r) =>
          r.city.toLowerCase().includes(q) ||
          r.country.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q),
      )
    : regions;
  const byContinent = new Map<string, RegionInfo[]>();
  for (const r of matched) {
    const rows = byContinent.get(r.continent);
    if (rows) rows.push(r);
    else byContinent.set(r.continent, [r]);
  }
  return [...byContinent.entries()];
}

/**
 * The location picker, mirroring web and desktop: a search field over a list
 * grouped by continent, one row per location, the caller's `value` marked as
 * selected.
 *
 * A plain ScrollView rather than a FlatList: this renders inside the create
 * step's own scroll view, and a virtualised list nested in a ScrollView of the
 * same orientation loses its virtualisation and warns about it.
 */
export function LocationPicker({
  regions,
  value,
  onChange,
}: {
  regions: RegionInfo[];
  value: string;
  onChange: (code: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupLocations(regions, query), [regions, query]);

  return (
    <View>
      <TextField
        testID="location-search"
        value={query}
        onChangeText={setQuery}
        placeholder={t("create-workspace.placeholder.searchACityOrCountry")}
        autoCapitalize="none"
      />
      <ScrollView
        testID="location-list"
        // Android needs this to scroll a list nested in another scroll view.
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        className="max-h-64 rounded-lg border border-border bg-card"
      >
        {groups.map(([continent, rows]) => (
          <View key={continent} testID={`location-group-${continent}`}>
            {/* Parity with the web/desktop pickers, whose continent wrapper
                carries role="group": a header role is the mobile equivalent,
                and it lets VoiceOver/TalkBack jump between continents rather
                than reading 40 locations in one run. */}
            <Text
              accessibilityRole="header"
              className="bg-muted px-3 py-1.5 text-[10px] uppercase text-muted-foreground"
              style={{ fontFamily: fonts.medium }}
            >
              {continent}
            </Text>
            {rows.map((r) => {
              const selected = r.code === value;
              return (
                <Pressable
                  key={r.code}
                  testID={`location-${r.code}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.city}, ${r.country}`}
                  accessibilityState={{ selected }}
                  onPress={() => onChange(r.code)}
                  className={
                    "flex-row items-center justify-between border-b border-border px-3 py-3 " +
                    (selected ? "bg-primary/10" : "")
                  }
                >
                  <Text
                    className={"flex-1 text-sm " + (selected ? "text-primary" : "text-foreground")}
                    numberOfLines={1}
                    style={{ fontFamily: selected ? fonts.medium : fonts.regular }}
                  >
                    {r.flag ? `${r.flag} ` : ""}
                    {r.city}, {r.country}
                  </Text>
                  {/* A colour difference alone is not a selection state. The
                      word is what a screen reader's row summary and a
                      colour-blind eye both get. */}
                  <Text
                    className={"ms-2 text-xs " + (selected ? "text-primary" : "text-muted-foreground")}
                    style={{ fontFamily: fonts.regular }}
                  >
                    {selected ? t("files.status.selected") : r.code}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        {/* Branch on the input, not the output: an empty list means there was
            nothing to search, which is not the same as a query that missed. */}
        {regions.length === 0 ? (
          <Text testID="location-empty" className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t("files.description.noLocationsAvailable")}
          </Text>
        ) : null}
        {regions.length > 0 && groups.length === 0 ? (
          <Text testID="location-no-match" className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t("files.description.noLocationMatches")}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
