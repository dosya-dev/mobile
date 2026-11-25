import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/ui/Icon";
import * as FileSystem from "expo-file-system/legacy";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useFile } from "@/files/hooks";
import { getDownloadUrl } from "@/files/api";
import { canDownload, needsUnlock, viewOnlySource } from "@/files/lock";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { uploadOne } from "@/upload/runner";
import {
  addCard, addEmail, addPhone, contactView, matchesQuery, parseVCardFile,
  removeCard, removeLine, serializeVCardFile, setDisplayName, setLineValue,
  MAX_VCF_PARSE_BYTES, type ContactView, type VCardDoc,
} from "@/contacts/vcardFile";
import { inputStartAlign } from "@/lib/direction";

type Phase = "loading" | "error" | "ready";

/** One editable row: a phone or email with its type label. */
function FieldRow(props: {
  icon: "call-outline" | "mail-outline";
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
  onOpen: () => void;
  testID: string;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  if (props.editing) {
    return (
      <View className="mb-2 flex-row items-center gap-2">
        <Icon name={props.icon} size={16} color={tokens.mutedForeground} />
        <TextInput
          testID={`${props.testID}-input`}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-foreground"
          style={{ fontFamily: fonts.regular, fontSize: 15, ...inputStartAlign() }}
          value={props.value}
          onChangeText={props.onChange}
          autoCapitalize="none"
          placeholder={props.label}
          placeholderTextColor={tokens.mutedForeground}
        />
        <Pressable testID={`${props.testID}-remove`} hitSlop={8} onPress={props.onRemove} accessibilityRole="button" accessibilityLabel={t("common.accessibility.removeMName", { mName: props.label })}>
          <Icon name="close-circle" size={20} color={tokens.mutedForeground} />
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable testID={props.testID} onPress={props.onOpen} className="mb-2 flex-row items-center gap-2" accessibilityRole="button">
      <Icon name={props.icon} size={16} color={tokens.mutedForeground} />
      <View className="flex-1">
        <Text className="text-foreground" numberOfLines={1}>{props.value}</Text>
        <Text className="text-xs text-muted-foreground">{props.label}</Text>
      </View>
    </Pressable>
  );
}

function ContactCard(props: {
  view: ContactView;
  cardIndex: number;
  editable: boolean;
  editing: boolean;
  onToggleEdit: () => void;
  onEdit: (mutate: (doc: VCardDoc) => VCardDoc) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const { view, cardIndex } = props;

  return (
    <View testID={`contact-${cardIndex}`} className="mb-3 rounded-xl border border-border bg-card p-4">
      <View className="mb-2 flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Text className="text-foreground" style={{ fontFamily: fonts.medium }}>
            {view.displayName.trim().charAt(0).toUpperCase() || "?"}
          </Text>
        </View>
        <View className="flex-1">
          {props.editing ? (
            <TextInput
              testID={`contact-${cardIndex}-name-input`}
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              style={{ fontFamily: fonts.medium, fontSize: 16, ...inputStartAlign() }}
              value={view.displayName}
              onChangeText={(text) => props.onEdit((d) => setDisplayName(d, cardIndex, text))}
            />
          ) : (
            <Text className="text-foreground" style={{ fontFamily: fonts.medium, fontSize: 16 }} numberOfLines={1}>
              {view.displayName}
            </Text>
          )}
          {view.org && !props.editing ? (
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>{view.org}</Text>
          ) : null}
        </View>
        {props.editable ? (
          <Pressable
            testID={`contact-${cardIndex}-edit`}
            hitSlop={8}
            onPress={props.onToggleEdit}
            accessibilityRole="button"
            accessibilityLabel={props.editing ? t("contacts.action.doneEditingContact") : t("contacts.action.editContact")}
          >
            <Icon name={props.editing ? "checkmark" : "pencil"} size={18} color={tokens.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {view.phones.map((p, i) => (
        <FieldRow
          key={`tel-${p.lineIndex}`}
          icon="call-outline"
          label={p.label}
          value={p.value}
          editing={props.editing}
          testID={`contact-${cardIndex}-phone-${i}`}
          onChange={(v) => props.onEdit((d) => setLineValue(d, cardIndex, p.lineIndex, v))}
          onRemove={() => props.onEdit((d) => removeLine(d, cardIndex, p.lineIndex))}
          onOpen={() => void Linking.openURL(`tel:${p.value.replace(/[^+\d]/g, "")}`).catch(() => toast(t("contacts.error.canTPlaceCallsOnThisDevice"), "error"))}
        />
      ))}
      {view.emails.map((e, i) => (
        <FieldRow
          key={`email-${e.lineIndex}`}
          icon="mail-outline"
          label={e.label}
          value={e.value}
          editing={props.editing}
          testID={`contact-${cardIndex}-email-${i}`}
          onChange={(v) => props.onEdit((d) => setLineValue(d, cardIndex, e.lineIndex, v))}
          onRemove={() => props.onEdit((d) => removeLine(d, cardIndex, e.lineIndex))}
          onOpen={() => void Linking.openURL(`mailto:${e.value}`).catch(() => toast(t("contacts.error.noMailAppAvailable"), "error"))}
        />
      ))}

      {props.editing ? (
        <View className="mt-2 flex-row gap-2">
          <Pressable testID={`contact-${cardIndex}-add-phone`} onPress={() => props.onEdit((d) => addPhone(d, cardIndex, "cell", ""))} accessibilityRole="button">
            <Text className="text-sm text-primary">{t("contacts.label.phone")}</Text>
          </Pressable>
          <Pressable testID={`contact-${cardIndex}-add-email`} onPress={() => props.onEdit((d) => addEmail(d, cardIndex, "home", ""))} accessibilityRole="button">
            <Text className="text-sm text-primary">{t("contacts.label.email")}</Text>
          </Pressable>
          <View className="flex-1" />
          <Pressable testID={`contact-${cardIndex}-delete`} onPress={props.onDelete} accessibilityRole="button">
            <Text className="text-sm text-destructive">{t("common.delete")}</Text>
          </Pressable>
        </View>
      ) : null}

      {view.hiddenCount > 0 && props.editing ? (
        // Reassurance, not decoration: the user is editing a file that holds
        // more than this screen shows, and needs to know it survives the save.
        <Text testID={`contact-${cardIndex}-hidden`} className="mt-2 text-xs text-muted-foreground">
          {t("contacts.description.hiddencountOtherHiddenCountPluralOneFieldIsOtherFieldsAreKeptUnchanged", { hiddenCount: view.hiddenCount })}
        </Text>
      ) : null}
    </View>
  );
}

export default function ContactsRoute() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: file, isLoading, isError } = useFile(id);
  const queryClient = useQueryClient();
  const { tokens } = useColorTheme();
  const activeWsId = useWorkspaceStore((s) => s.activeId);

  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [doc, setDoc] = useState<VCardDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [editingCard, setEditingCard] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Guards a single in-flight load per mount, matching read.tsx's runIdRef.
  const runIdRef = useRef(0);

  // A locked file cannot be versioned - /api/upload/init returns 403 for one -
  // so the screen is read-only rather than offering a save that must fail.
  const editable = !!file && file.lock_mode === "none";
  const tooBig = !!file && file.size_bytes > MAX_VCF_PARSE_BYTES;

  const load = useCallback(() => {
    if (!file) return;
    const runId = ++runIdRef.current;
    setPhase("loading");
    setErrorMessage(null);
    const raw = viewOnlySource(file);
    const resolve = raw ? Promise.resolve(raw.uri) : getDownloadUrl(file.id);
    resolve
      .then((url) => fetch(url, raw ? { headers: raw.headers } : undefined))
      .then((res) => {
        if (!res.ok) throw new Error(t("contacts.error.couldnTLoadContactsStatus", { status: String(res.status) }));
        return res.text();
      })
      .then((text) => {
        if (runIdRef.current !== runId) return;
        setDoc(parseVCardFile(text));
        setDirty(false);
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (runIdRef.current !== runId) return;
        setErrorMessage(err instanceof Error ? err.message : t("contacts.error.couldnTLoadContacts"));
        setPhase("error");
      });
  }, [file, t]);

  useEffect(() => {
    if (!file) return;
    // A file still behind its password gate, or too large to parse, has no
    // business on this screen - send it back to the detail page, which knows
    // how to present both.
    if (needsUnlock(file, null) || tooBig) {
      router.replace(`/file/${id}`);
      return;
    }
    load();
    // Gate strictly on file identity: `load` is a fresh identity whenever the
    // file object changes, and depending on it would re-fetch on unrelated
    // re-renders, discarding unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  const edit = useCallback((mutate: (d: VCardDoc) => VCardDoc) => {
    setDoc((cur) => (cur ? mutate(cur) : cur));
    setDirty(true);
  }, []);

  // Recomputed only when the document actually changes: contactView walks
  // every line of every card, and the search box re-renders on each keystroke.
  // `t` is a dependency because contactView falls back to a translated "(no name)".
  const views = useMemo(() => (doc ? doc.cards.map(contactView) : []), [doc, t]);
  const visible = useMemo(
    () => views.map((v, i) => ({ view: v, index: i })).filter(({ view }) => matchesQuery(view, query)),
    [views, query],
  );

  const onSave = async () => {
    if (!doc || !file || !activeWsId) return;
    setSaving(true);
    try {
      const text = serializeVCardFile(doc);
      const path = `${FileSystem.cacheDirectory}vcf-save-${file.id}.vcf`;
      await FileSystem.writeAsStringAsync(path, text);
      const info = await FileSystem.getInfoAsync(path);
      await uploadOne(
        {
          id: `vcf-${file.id}`,
          name: file.name,
          uri: path,
          size: info.exists && !info.isDirectory ? info.size ?? text.length : text.length,
          mime: "text/vcard",
          folderId: null,
          workspaceId: activeWsId,
          status: "queued",
          progress: 0,
          // Saves as a new VERSION, so the pre-edit address book stays
          // recoverable from the file's version list.
          versionOfFileId: file.id,
        },
        activeWsId,
        () => {},
      );
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      setDirty(false);
      setEditingCard(null);
      await queryClient.invalidateQueries({ queryKey: ["file", file.id] });
      await queryClient.invalidateQueries({ queryKey: ["files"] });
      toast(t("contacts.status.contactsSaved"));
    } catch (e) {
      toast(e instanceof Error ? e.message : t("contacts.error.couldnTSaveContacts"), "error");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || (phase === "loading" && !isError)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || !file) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-destructive">{t("common.error.couldnTLoadFile")}</Text>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-8">
        <Stack.Screen options={{ headerShown: true, title: file.name }} />
        <Text className="text-center text-destructive">{errorMessage}</Text>
        <View className="w-40"><Button title={t("common.retry")} onPress={load} testID="retry-contacts" /></View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: true, title: file.name }} />

      <View className="border-b border-border px-4 pb-3 pt-2">
        <View className="flex-row items-center gap-2 rounded-lg border border-border bg-card px-3">
          <Icon name="search" size={16} color={tokens.mutedForeground} />
          <TextInput
            testID="contact-search"
            className="flex-1 py-2 text-foreground"
            style={{ fontFamily: fonts.regular, fontSize: 15, ...inputStartAlign() }}
            value={query}
            onChangeText={setQuery}
            placeholder={t("common.placeholder.searchContacts")}
            placeholderTextColor={tokens.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Pressable testID="contact-search-clear" hitSlop={8} onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel={t("common.action.clearSearch")}>
              <Icon name="close-circle" size={16} color={tokens.mutedForeground} />
            </Pressable>
          ) : null}
        </View>
        <View className="mt-2 flex-row items-center">
          <Text testID="contact-count" className="flex-1 text-xs text-muted-foreground">
            {query
              ? t("contacts.label.shownOfTotalContacts", { shown: visible.length, total: views.length })
              : t("contacts.label.viewscountPluralOneContactOtherContacts", { viewsCount: views.length })}
          </Text>
          {editable ? (
            <Pressable
              testID="contact-add"
              hitSlop={8}
              onPress={() => {
                edit((d) => addCard(d, t("contacts.action.newContact")));
                setEditingCard(views.length);
                setQuery("");
              }}
              accessibilityRole="button"
              accessibilityLabel={t("contacts.action.addContact")}
            >
              <Text className="text-sm text-primary">{t("contacts.label.add")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => String(item.index)}
        contentContainerClassName="p-4"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text testID="contacts-empty" className="mt-8 text-center text-muted-foreground">
            {views.length === 0 ? t("contacts.description.noContactsInThisFile") : t("contacts.description.noContactsMatchThatSearch")}
          </Text>
        }
        renderItem={({ item }) => (
          <ContactCard
            view={item.view}
            cardIndex={item.index}
            editable={editable}
            editing={editingCard === item.index}
            onToggleEdit={() => setEditingCard((cur) => (cur === item.index ? null : item.index))}
            onEdit={edit}
            onDelete={() => setDeleteTarget(item.index)}
          />
        )}
      />

      {!editable ? (
        <View testID="contacts-readonly" className="border-t border-border px-4 py-3">
          <Text className="text-center text-xs text-muted-foreground">
            {canDownload(file)
              ? t("contacts.description.thisFileIsLockedSoContactsAreReadOnly")
              : t("contacts.description.viewOnlyTheOwnerHasDisabledChanges")}
          </Text>
        </View>
      ) : dirty ? (
        <View className="border-t border-border p-4">
          <Button
            title={saving ? t("contacts.action.saving") : t("common.action.saveChanges")}
            onPress={onSave}
            loading={saving}
            testID="contacts-save"
          />
          <Text className="mt-2 text-center text-xs text-muted-foreground">
            {t("contacts.description.savesAsANewVersionThePreviousContactsStayRecoverable")}
          </Text>
        </View>
      ) : null}

      <ConfirmDialog
        visible={deleteTarget !== null}
        title={t("contacts.heading.deleteContact")}
        message={deleteTarget !== null ? views[deleteTarget]?.displayName : undefined}
        confirmLabel={t("common.delete")}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          setEditingCard(null);
          if (target !== null) edit((d) => removeCard(d, target));
        }}
      />
    </View>
  );
}
