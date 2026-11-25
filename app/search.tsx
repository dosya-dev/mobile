// /search: the name search with the content results under it, plus - where
// this phone's Personas is ready and this role may see files - the people
// whose name starts with the typed text, each with "Go to person" (their
// persona screen). The people come from the engine on this phone
// (engine.findByName); nothing about people is asked of a server and the
// content search has no person filter. An old `person=` link is a plain
// search. People ported from the desktop's pages/SearchPage.tsx (from
// apps/web/src/pages/search.tsx) - keep the behaviour and copy in step.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import { TextField } from "@/ui/TextField";
import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useWorkspaces, useSearch } from "@/files/hooks";
import { FileRow } from "@/files/FileRow";
import { FolderRow } from "@/files/FolderRow";
import { usePermissions } from "@/workspace/usePermissions";
import { isolateInRtl, useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { searchRows, type SearchTab, type SearchSort } from "@/files/search-view";
import { fonts } from "@/theme/fonts";
import { formatNumber } from "@/lib/format-locale";
import { isImageHit, type ContentHit } from "@/ai-search/api";
import { useContentSearch, type ContentState } from "@/ai-search/useContentSearch";
import { personaHref, type PersonaCard } from "@/personas/api";
import { FaceAvatar } from "@/personas/FaceAvatar";
import { usePersonasEntry } from "@/personas/hooks";

const TABS: { key: SearchTab; label: MessageKey }[] = [
  { key: "all", label: "common.label.all" },
  { key: "files", label: "common.label.files" },
  { key: "folders", label: "common.label.folders" },
];

const SORTS: { key: SearchSort; label: MessageKey }[] = [
  { key: "name_asc", label: "search.option.nameAZ" },
  { key: "name_desc", label: "search.option.nameZA" },
  { key: "newest", label: "search.option.newestFirst" },
  { key: "oldest", label: "search.option.oldestFirst" },
];

/** How many people the suggestions show. */
export const PEOPLE_SUGGESTIONS_MAX = 5;

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const query = typeof params.q === "string" ? params.q : "";
  const workspaces = useWorkspaces();
  const wsId = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  return <NameSearch wsId={wsId} initialQuery={query} />;
}

// ── Name search ───────────────────────────────────────────

function NameSearch({ wsId, initialQuery }: { wsId: string | null; initialQuery: string }) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const [q, setQ] = useState(initialQuery);
  const [tab, setTab] = useState<SearchTab>("all");
  const [sort, setSort] = useState<SearchSort>("name_asc");
  const [sortOpen, setSortOpen] = useState(false);
  const search = useSearch(wsId, q);
  // AI search: what is INSIDE files. Hidden unless the workspace has it on.
  const content = useContentSearch(wsId, q);
  const showContent = tab !== "folders" && content.state !== "hidden";
  const contentHasHits = content.state === "ok" && content.files.length > 0;
  const contentPending = content.state === "loading" || content.state === "busy";

  // People (Personas): with two or more letters, the named people whose name
  // starts with them, found by this phone's engine, under the field. Only for
  // a signed-in role that may see files (permissions answered and
  // access_files); only the latest answer lands.
  const { can, permissions } = usePermissions();
  const entry = usePersonasEntry(wsId);
  const mayAskPeople = entry.visible && permissions !== undefined && can("access_files");
  const people = usePeople(wsId, q, mayAskPeople);
  const showSuggestions = q.trim().length >= 2 && people.length > 0;

  const rows = searchRows(search.data, tab, sort);
  const sortActions: SheetAction[] = SORTS.map((s) => ({
    label: t(s.label),
    icon: sort === s.key ? "checkmark" : "swap-vertical-outline",
    onPress: () => setSort(s.key),
  }));

  return (
    // No "top" edge: the native header below already occupies the safe area, and the raw
    // device insets are still reported inside the screen - keeping it pads the status bar
    // height in a second time and gapped the input away from the header.
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("search.heading.search") }} />
      <View className="px-5 pt-3">
        <TextField value={q} onChangeText={setQ} placeholder={t("search.placeholder.searchFilesAndFolders")} autoCapitalize="none" testID="search-input" />
      </View>

      {showSuggestions ? (
        <View className="-mt-2 px-5 pb-2" testID="people-suggestions">
          <Text className="mb-1.5 text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>{t("personas.label.people")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {people.map((p) => (
              <PersonChip key={p.id} persona={p} onPress={() => router.push(personaHref(p.id))} testID={`people-suggestion-${p.id}`} />
            ))}
          </View>
        </View>
      ) : null}

      <View className="flex-row items-center justify-between px-5 py-2">
        <View className="flex-row gap-2">
          {TABS.map((tb) => (
            <Pressable
              key={tb.key}
              testID={`search-tab-${tb.key}`}
              accessibilityRole="button"
              onPress={() => setTab(tb.key)}
              className={"rounded-full px-3 py-1 " + (tab === tb.key ? "bg-primary" : "bg-secondary")}
            >
              <Text className={tab === tb.key ? "text-sm text-primary-foreground" : "text-sm text-secondary-foreground"}>
                {t(tb.label)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          testID="search-sort"
          accessibilityRole="button"
          accessibilityLabel={t("search.action.sortResults")}
          hitSlop={8}
          onPress={() => setSortOpen(true)}
          className="flex-row items-center gap-1"
        >
          <Icon name="swap-vertical" size={18} color={tokens.foreground} />
        </Pressable>
      </View>

      {search.isFetching ? (
        <View className="py-6"><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.type + ":" + r.item.id}
          renderItem={({ item }) =>
            item.type === "folder"
              ? <FolderRow folder={item.item} onPress={() => router.push({ pathname: "/folder/[id]", params: { id: item.item.id, name: item.item.name } })} />
              : <FileRow file={item.item} onPress={() => router.push(`/file/${item.item.id}`)} />
          }
          ListEmptyComponent={q.trim() && !(showContent && (contentHasHits || contentPending))
            ? <Text className="mt-8 text-center text-muted-foreground">{t("search.empty.noResults")}</Text>
            : null}
          ListFooterComponent={showContent
            ? <ContentResults content={content as Exclude<ContentState, { state: "hidden" }>} onOpen={(f) => router.push(`/file/${f.id}`)} />
            : null}
        />
      )}

      <ActionSheet visible={sortOpen} onClose={() => setSortOpen(false)} actions={sortActions} />
    </SafeAreaView>
  );
}

/** How long after the last letter the people suggestions are asked for. */
export const PEOPLE_DEBOUNCE_MS = 250;

// The engine host is required lazily (as the viewer's people chips do): it
// pulls in the e2ee bundle, which must not load with the search screen.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadEngineHost = () => require("@/personas/device/engine-host") as typeof import("@/personas/device/engine-host");

/**
 * The named people for the suggestions (two or more letters), from this
 * phone's engine once the text settles (PEOPLE_DEBOUNCE_MS after the last
 * letter); the newest answer wins, and nothing while Personas is not ready
 * here. The previous answer stays on screen until the new one lands, so the
 * chips do not flicker while typing; a change of workspace clears them.
 */
function usePeople(wsId: string | null, q: string, mayAsk: boolean): PersonaCard[] {
  const [people, setPeople] = useState<PersonaCard[]>([]);
  const seq = useRef(0);
  const query = q.trim();
  const asking = !!wsId && mayAsk && query.length >= 2;
  useEffect(() => { setPeople([]); }, [wsId, mayAsk]);
  useEffect(() => {
    const mine = ++seq.current;
    if (!asking || !wsId) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const engine = loadEngineHost().personasEngine(wsId);
          const st = await engine.status();
          if (mine !== seq.current) return;
          setPeople(st.state === "ready" ? engine.findByName(query, PEOPLE_SUGGESTIONS_MAX).filter((p) => p.name) : []);
        } catch {
          // Off, locked, offline, signed out: no people, nothing said.
          if (mine === seq.current) setPeople([]);
        }
      })();
    }, PEOPLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wsId, asking, query]);
  return asking ? people : [];
}

/** A named person as a chip: face, name and "Go to person". */
function PersonChip({ persona: p, onPress, testID }: { persona: PersonaCard; onPress: () => void; testID: string }) {
  const t = useT();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${p.name}, ${t("personas.action.goToPerson")}`}
      onPress={onPress}
      className="min-h-[44px] flex-row items-center gap-2 rounded-full border border-border bg-card py-1 ps-1 pe-3"
    >
      <FaceAvatar fileId={p.cover_file_id} box={p.cover_box} name={p.name} size={32} />
      <Text className="max-w-[140px] text-sm text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={1}>{isolateInRtl(p.name ?? "")}</Text>
      <Text className="text-xs text-muted-foreground">{t("personas.action.goToPerson")}</Text>
    </Pressable>
  );
}

/** "In file contents": the AI search hits for the query, with their loading and busy lines. */
function ContentResults({ content, onOpen }: { content: Exclude<ContentState, { state: "hidden" }>; onOpen: (f: ContentHit) => void }) {
  const t = useT();
  const line = (text: string) => (
    <Text className="px-5 py-2 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>{text}</Text>
  );
  return (
    <View testID="content-results" className="mt-4 pb-6">
      <Text className="px-5 pb-1 text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
        {t("search.label.inFileContents")}
      </Text>
      {content.state === "loading" ? line(t("search.status.searchingFileContents"))
        : content.state === "busy" ? line(t("search.status.contentSearchIsBusyRetrying"))
        : content.files.length === 0 ? line(t("search.label.noContentMatches"))
        : content.files.map((f) => (
          <View key={f.id} testID="content-hit">
            <FileRow file={f} onPress={() => onOpen(f)} />
            {/* An image's "text" is the vision model's description or OCR attempt,
                which is index material, not something to read under a photo.
                Documents keep their snippet: it says where the match is. */}
            {!isImageHit(f) && f.snippet ? (
              <Text numberOfLines={2} className="-mt-1 px-5 pb-2 text-xs text-muted-foreground" style={{ fontFamily: fonts.regular }}>
                {f.snippet}
                {f.page != null ? ` · ${t("search.label.pagePage", { page: formatNumber(f.page) })}` : ""}
              </Text>
            ) : null}
          </View>
        ))}
    </View>
  );
}
