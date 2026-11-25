// One persona: cover, name (rename inline), photo count, Rename / Merge /
// Remove person, and the photos newest first in month sections. Ported from
// the desktop's components/personas/PersonaView.tsx (from
// apps/web/src/pages/personas/persona.tsx, design-ref Persona) - keep the
// behaviour and copy in step.
//
// Everything comes from this phone's engine: the persona and its photos
// (with the face id of this persona in each) from engine.personaPhotos, and
// every action is journaled for the user's other devices. The file names,
// dates and folders come from the photo listing the engine reads from
// (personasPhotoRows); a photo missing there is not readable any more
// (trashed, hidden, locked) and leaves the persona on the next read, so it
// is not shown.
//
// Mobile differences: a photo's menu is an ActionSheet on a long press
// ("Not <name>", "Set as cover", "Show in folder"), the next page loads as
// the list nears its end, a tap opens the app's viewer with this persona's
// photos as neighbours, and the Remove confirm is a dialog with the name in bold.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import type { PersonasEngine } from "@dosya-dev/personas-engine";
import { ActionSheet, type SheetAction } from "@/ui/ActionSheet";
import { Button } from "@/ui/Button";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { toast } from "@/ui/toast";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { FileThumb } from "@/files/FileThumb";
import type { FileDetail } from "@/files/types";
import { useViewerList } from "@/viewer/viewerStore";
import { formatDateWith, formatNumber } from "@/lib/format-locale";
import { isolateInRtl, useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";
import { personaHref, type FaceBox, type PersonaCard } from "./api";
import { personasPhotoRows, type PhotoRow } from "./device/engine-host";
import { FaceAvatar } from "./FaceAvatar";
import { MergeSheet } from "./MergeSheet";
import { PersonaNameField } from "./NameField";
import type { ReadyStatus } from "./progress";

/** Photos a row. */
export const COLUMNS = 3;
/** Photos per page. */
const PAGE = 60;
/** The engine's largest page. */
const ENGINE_PAGE_MAX = 500;

export type Photo = { file: PhotoRow; face_id: string; box: FaceBox };

type Page =
  | { state: "ready"; persona: PersonaCard; faces: { file_id: string; face_id: string; box: FaceBox }[]; more: boolean }
  | { state: "gone" };

/** The persona and its first `count` photos (the engine pages by cursor). */
function readPage(engine: Pick<PersonasEngine, "personaPhotos">, pid: string, count: number): Page {
  try {
    let cursor: string | null = null;
    let persona: PersonaCard | null = null;
    const faces: { file_id: string; face_id: string; box: FaceBox }[] = [];
    do {
      const p = engine.personaPhotos(pid, cursor, Math.min(ENGINE_PAGE_MAX, count - faces.length));
      persona = p.persona;
      faces.push(...p.files);
      cursor = p.next;
    } while (cursor && faces.length < count);
    return { state: "ready", persona: persona!, faces, more: cursor !== null };
  } catch {
    return { state: "gone" };
  }
}

/** The thumbnail and the viewer want a file row; the listing's rows carry the file fields. */
export function toFileItem(r: PhotoRow, wsId: string): FileDetail {
  const created = r.created_at ?? 0;
  return {
    id: r.id, name: r.name ?? "", size_bytes: r.size_bytes ?? 0, mime_type: r.mime_type ?? "", extension: r.extension ?? null,
    created_at: created, updated_at: r.updated_at ?? created, current_version: r.current_version ?? 1,
    lock_mode: r.lock_mode ?? "none", is_hidden: r.is_hidden ?? 0, share_count: 0, comment_count: 0,
    folder_id: r.folder_id, workspace_id: wsId, uploaded_by: r.uploaded_by ?? null,
  };
}

const dateOf = (r: PhotoRow) => Number(r.taken_at ?? r.created_at ?? 0);

/** Year-month key in the phone's own time zone. */
const monthKey = (unix: number) => { const d = new Date(unix * 1000); return `${d.getFullYear()}-${d.getMonth()}`; };

export interface Month { key: string; label: string; photos: Photo[] }

/** The photos in month sections, in the order given (newest first). */
export function byMonth(photos: Photo[]): Month[] {
  const out: Month[] = [];
  for (const p of photos) {
    const at = dateOf(p.file);
    const key = monthKey(at);
    let m = out.find((x) => x.key === key);
    if (!m) {
      m = { key, label: formatDateWith(at, { month: "long", year: "numeric" }), photos: [] };
      out.push(m);
    }
    m.photos.push(p);
  }
  return out;
}

/** One FlatList row: a month heading or up to COLUMNS photos. */
type Row = { type: "month"; key: string; label: string; count: number } | { type: "photos"; key: string; photos: Photo[] };

export function toRows(months: Month[]): Row[] {
  const rows: Row[] = [];
  for (const m of months) {
    rows.push({ type: "month", key: `m-${m.key}`, label: m.label, count: m.photos.length });
    for (let i = 0; i < m.photos.length; i += COLUMNS) {
      rows.push({ type: "photos", key: `p-${m.key}-${i}`, photos: m.photos.slice(i, i + COLUMNS) });
    }
  }
  return rows;
}

export interface PersonaViewProps {
  wsId: string;
  personaId: string;
  engine: PersonasEngine;
  /** The engine's status: a new object after every change, so the screen reads the engine again. */
  status?: ReadyStatus;
}

export function PersonaView({ wsId, personaId, engine, status }: PersonaViewProps) {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const setViewerList = useViewerList((s) => s.setViewerList);
  const [count, setCount] = useState(PAGE);
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [menuFor, setMenuFor] = useState<Photo | null>(null);
  // Bumped after an action, so the screen reads the engine again even when no status change follows.
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<ReadonlyMap<string, PhotoRow> | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- status and version are change signals
  const page = useMemo(() => readPage(engine, personaId, count), [engine, personaId, count, status, version]);

  // The listing is cached for a few minutes and shared with the engine; the
  // same Map comes back until it is made again.
  useEffect(() => {
    let cancelled = false;
    personasPhotoRows(wsId).then(
      (r) => { if (!cancelled) setRows((prev) => (prev === r ? prev : r)); },
      () => { if (!cancelled) setRows((prev) => prev ?? new Map()); },
    );
    return () => { cancelled = true; };
  }, [wsId, status]);

  const photos = useMemo<Photo[]>(() => {
    if (page.state !== "ready" || !rows) return [];
    const out: Photo[] = [];
    for (const f of page.faces) {
      const file = rows.get(f.file_id);
      if (file) out.push({ file, face_id: f.face_id, box: f.box });
    }
    return out;
  }, [page, rows]);

  const list = useMemo(() => toRows(byMonth(photos)), [photos]);

  if (page.state === "gone") {
    return (
      <Centered>
        <Icon name="people-outline" size={32} color={tokens.mutedForeground} />
        <Text className="mt-3 text-center text-sm text-muted-foreground" testID="persona-gone" accessibilityLiveRegion="polite">{t("personas.error.personaIsNoLongerHere")}</Text>
      </Centered>
    );
  }

  const { persona } = page;
  const name = persona.name;
  const changed = () => setVersion((v) => v + 1);
  const leave = () => { if (router.canGoBack()) router.back(); else router.replace("/personas"); };

  const perform = async (run: () => Promise<unknown>) => {
    try {
      await run();
      changed();
    } catch {
      toast(t("personas.error.couldNotUpdatePersona"), "error");
    }
  };
  const notThis = (p: Photo) => perform(() => engine.notThisPerson(p.face_id));
  const makeCover = (p: Photo) => perform(() => engine.setCover(persona.id, p.face_id));

  const showInFolder = (p: Photo) => {
    if (p.file.folder_id) router.push({ pathname: "/folder/[id]", params: { id: p.file.folder_id } });
    else router.push("/");
  };

  const openPhoto = (p: Photo) => {
    setViewerList(photos.map((x) => toFileItem(x.file, wsId)), name ?? t("common.label.personas"));
    router.push(`/file/${p.file.id}`);
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await engine.removePersona(persona.id);
      setRemoveOpen(false);
      leave();
    } catch {
      toast(t("personas.error.couldNotUpdatePersona"), "error");
    } finally {
      setRemoving(false);
    }
  };

  const menuActions: SheetAction[] = menuFor ? [
    { label: name ? t("personas.action.notName", { name: isolateInRtl(name) }) : t("personas.action.notThisPerson"), icon: "person-remove", onPress: () => void notThis(menuFor) },
    { label: t("personas.action.setAsCover"), icon: "image-outline", onPress: () => void makeCover(menuFor) },
    { label: t("personas.action.showInFolder"), icon: "folder-open-outline", onPress: () => showInFolder(menuFor) },
  ] : [];

  const header = (
    <View className="px-5 pb-2 pt-4" testID="persona-header">
      <View className="items-center gap-3">
        <FaceAvatar fileId={persona.cover_file_id} box={persona.cover_box} name={name} size={112} testID="persona-cover" />
        {renaming ? (
          <PersonaNameField
            engine={engine}
            personaId={persona.id}
            initial={name ?? ""}
            onSaved={() => { setRenaming(false); changed(); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <Text className="text-center text-2xl text-foreground" style={{ fontFamily: fonts.bold }} accessibilityRole="header" testID="persona-title">
            {name ? isolateInRtl(name) : t("common.label.unnamed")}
          </Text>
        )}
        <Text className="-mt-1 text-sm text-muted-foreground" testID="persona-count">
          {t("files.label.countPluralOnePhotoOtherPhotos", { count: persona.photo_count })}
        </Text>
      </View>

      <View className="mt-4 flex-row flex-wrap justify-center gap-2">
        <OutlineButton
          testID="persona-rename"
          icon={name ? "pencil-outline" : "add"}
          label={name ? t("common.action.rename") : t("personas.action.addAName")}
          accessibilityLabel={name ? t("personas.action.renameName", { name: isolateInRtl(name) }) : t("personas.action.addAName")}
          onPress={() => setRenaming(true)}
        />
        <OutlineButton testID="persona-merge" icon="swap-horizontal" label={t("personas.action.merge")} onPress={() => setMerging(true)} />
        <OutlineButton testID="persona-remove" icon="person-remove" label={t("personas.action.removePerson")} destructive onPress={() => setRemoveOpen(true)} />
      </View>
    </View>
  );

  return (
    <View className="flex-1" testID={`persona-${persona.id}`}>
      <FlatList
        testID="persona-list"
        data={list}
        keyExtractor={(r) => r.key}
        ListHeaderComponent={header}
        ListEmptyComponent={rows
          ? <Text className="mt-6 px-5 text-sm text-muted-foreground" testID="persona-empty">{t("personas.description.noPhotosToShow")}</Text>
          : <View className="py-10"><ActivityIndicator accessibilityLabel={t("common.status.loading")} /></View>}
        ListFooterComponent={<View className="h-10" />}
        onEndReached={() => { if (page.more) setCount((c) => c + PAGE); }}
        onEndReachedThreshold={0.6}
        renderItem={({ item }) => item.type === "month" ? (
          <View className="flex-row items-baseline gap-2 px-5 pb-2 pt-5" testID={`persona-month-${item.key}`}>
            <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }} accessibilityRole="header">{item.label}</Text>
            <Text className="text-xs text-muted-foreground">{formatNumber(item.count)}</Text>
          </View>
        ) : (
          <View className="flex-row gap-0.5 px-0.5 pb-0.5">
            {item.photos.map((p) => (
              <PhotoTile key={p.file.id} file={toFileItem(p.file, wsId)} onOpen={() => openPhoto(p)} onMenu={() => setMenuFor(p)} />
            ))}
            {item.photos.length < COLUMNS
              ? Array.from({ length: COLUMNS - item.photos.length }, (_, i) => <View key={`pad-${i}`} className="flex-1" />)
              : null}
          </View>
        )}
      />

      <ActionSheet visible={menuFor !== null} onClose={() => setMenuFor(null)} actions={menuActions} />

      <MergeSheet
        visible={merging}
        engine={engine}
        target={persona}
        onClose={() => setMerging(false)}
        onMerged={(survivor) => {
          setMerging(false);
          changed();
          if (survivor !== persona.id) router.replace(personaHref(survivor));
        }}
      />

      <RemoveConfirm visible={removeOpen} name={name} busy={removing} onCancel={() => { if (!removing) setRemoveOpen(false); }} onConfirm={() => void remove()} />
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center px-8">{children}</View>;
}

function OutlineButton({ testID, icon, label, accessibilityLabel, destructive, onPress }: {
  testID: string; icon: IconName; label: string; accessibilityLabel?: string; destructive?: boolean; onPress: () => void;
}) {
  const { tokens } = useColorTheme();
  const color = destructive ? tokens.destructive : tokens.foreground;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className="min-h-[44px] flex-row items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2"
    >
      <Icon name={icon} size={16} color={color} />
      <Text className={"text-sm " + (destructive ? "text-destructive" : "text-foreground")} style={{ fontFamily: fonts.medium }}>{label}</Text>
    </Pressable>
  );
}

function PhotoTile({ file, onOpen, onMenu }: { file: FileDetail; onOpen: () => void; onMenu: () => void }) {
  const t = useT();
  return (
    <Pressable
      testID={`persona-photo-${file.id}`}
      accessibilityRole="button"
      accessibilityLabel={file.name}
      accessibilityHint={t("personas.action.photoOptions")}
      onPress={onOpen}
      onLongPress={onMenu}
      delayLongPress={350}
      className="flex-1"
    >
      <FileThumb file={file} variant="photo" />
    </Pressable>
  );
}

/** "Are you sure?" with the person's name in bold; Remove person deletes their face data from all the user's devices. */
function RemoveConfirm({ visible, name, busy, onCancel, onConfirm }: {
  visible: boolean; name: string | null; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 px-8">
        <View className="w-full rounded-xl bg-card p-5" testID="persona-remove-dialog" accessibilityViewIsModal>
          <Text className="text-lg text-foreground" style={{ fontFamily: fonts.medium }} accessibilityRole="header">{t("common.heading.areYouSure")}</Text>
          <Text className="mt-2 text-sm text-muted-foreground" testID="persona-remove-statement">
            {name
              ? richText(t("personas.description.youAreRemovingNameTheirFaceDataIsDeleted"), {
                name: <Text className="text-sm text-foreground" style={{ fontFamily: fonts.bold }} testID="persona-remove-name">{isolateInRtl(name)}</Text>,
              })
              : t("personas.description.youAreRemovingThisPersonTheirFaceDataIsDeleted")}
          </Text>
          <View className="mt-5 flex-row gap-3">
            <View className="flex-1"><Button title={t("common.cancel")} variant="ghost" onPress={onCancel} disabled={busy} testID="persona-remove-cancel" /></View>
            <View className="flex-1">
              <Pressable
                testID="persona-remove-confirm"
                accessibilityRole="button"
                accessibilityLabel={t("personas.action.removePerson")}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={onConfirm}
                className={"items-center justify-center rounded-lg bg-destructive px-5 py-3" + (busy ? " opacity-60" : "")}
              >
                {busy
                  ? <ActivityIndicator color="#ffffff" />
                  : <Text className="text-base text-destructive-foreground" style={{ fontFamily: fonts.medium }}>{t("personas.action.removePerson")}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
