import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeyboardLift } from "@/ui/useKeyboardLift";
import { Stack } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/toast";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useLocale, useT } from "@/lib/i18n";
import { inputStartAlign } from "@/lib/direction";
import { formatDateWith } from "@/lib/format-locale";
import { BUG_REPORT_IMAGE_MAX_BYTES, BUG_REPORT_IMAGE_TYPES } from "@/support/api";
import { EXTENSION_FOR_TYPE, resolveImageType } from "@/support/imageTypes";
import { useSupportChat, type ThreadMessage } from "@/support-chat/store";
import type { ChatImage } from "@/support-chat/api";
import { Bubble, ConversationList, OnlineDot, RatingCard, SupportAvatar, SystemLine } from "@/support-chat/parts";

const MAX_IMAGES = 10;
const TYPING_IDLE_MS = 3000;
/** The seven days the server allows for rating an ended conversation. */
const RATING_WINDOW_SEC = 7 * 24 * 3600;

type Row = { kind: "day"; key: string; label: string } | { kind: "msg"; key: string; message: ThreadMessage };

function dayKey(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Live chat with dosya support, opened from Settings > Preferences. The same
 * room as web and desktop. The socket is open only while this screen shows
 * (store.showChat); away from it, replies arrive as the server's push.
 */
export default function SupportChatScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { tokens } = useColorTheme();
  const conn = useSupportChat((s) => s.conn);
  const persona = useSupportChat((s) => s.persona);
  const conversation = useSupportChat((s) => s.conversation);
  const messages = useSupportChat((s) => s.messages);
  const viewing = useSupportChat((s) => s.viewing);
  const historyMessages = useSupportChat((s) => s.historyMessages);
  const history = useSupportChat((s) => s.history);
  const typing = useSupportChat((s) => s.typing);
  const typingName = useSupportChat((s) => s.typingName);
  const pending = useSupportChat((s) => s.pending);
  const staffSeenAt = useSupportChat((s) => s.staffSeenAt);
  const lastError = useSupportChat((s) => s.lastError);
  const notAvailable = useSupportChat((s) => s.notAvailable);
  const lastFailedDraft = useSupportChat((s) => s.lastFailedDraft);
  const showChat = useSupportChat((s) => s.showChat);
  const send = useSupportChat((s) => s.send);
  const setTyping = useSupportChat((s) => s.setTyping);
  const clearFailedDraft = useSupportChat((s) => s.clearFailedDraft);
  const endConversation = useSupportChat((s) => s.endConversation);
  const startConversation = useSupportChat((s) => s.startConversation);
  const rate = useSupportChat((s) => s.rate);
  const viewConversation = useSupportChat((s) => s.viewConversation);
  const clearError = useSupportChat((s) => s.clearError);

  const [text, setText] = useState("");
  const [images, setImages] = useState<ChatImage[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const keyboardLift = useKeyboardLift();

  // The newest message stays in view when the keyboard opens.
  useEffect(() => {
    if (keyboardLift > 0) listRef.current?.scrollToEnd({ animated: true });
  }, [keyboardLift]);

  useEffect(() => {
    showChat(true);
    return () => showChat(false);
  }, [showChat]);

  // A message that failed to send comes back as editable text.
  useEffect(() => {
    if (lastFailedDraft == null) return;
    setText(lastFailedDraft);
    clearFailedDraft();
  }, [lastFailedDraft, clearFailedDraft]);

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  const pastView = viewing !== null && viewing !== conversation?.id;
  const pastItem = pastView ? history.find((h) => h.id === viewing) ?? null : null;
  const shown = pastView ? historyMessages : messages;
  const ended = conversation?.status === "ended";
  const somethingSaid = messages.some((m) => m.author_type !== "system");
  const canEnd = !ended && !!conversation && somethingSaid && !pastView;
  const lastOwn = [...shown].reverse().find((m) => m.author_type === "user");

  const status = ended
    ? t("support-chat.label.conversationEnded")
    : persona
      ? t("support-chat.status.personaIsOnline", { name: persona.name })
      : t("support-chat.status.onlineUsuallyRepliesInAFewMinutes");
  const heading = persona ? t("support-chat.heading.personaFromDosya", { name: persona.name }) : t("support-chat.heading.dosyaSupport");

  const rows = useMemo(() => {
    const out: Row[] = [];
    const today = dayKey(Math.floor(Date.now() / 1000));
    let last = "";
    for (const m of shown) {
      const k = dayKey(m.created_at);
      if (k !== last) {
        out.push({
          kind: "day", key: `day:${k}`,
          label: k === today ? t("support-chat.label.today") : formatDateWith(m.created_at, { dateStyle: "long" }, locale),
        });
        last = k;
      }
      out.push({ kind: "msg", key: m.id, message: m });
    }
    return out;
  }, [shown, t, locale]);

  const ownStatus = (m: ThreadMessage): string => {
    if (pending[m.id] === "uploading" || pending[m.id] === "sending") return t("support-chat.status.sending");
    if (m.created_at <= staffSeenAt) return t("support-chat.status.seen");
    return t("support-chat.status.sent");
  };

  const disabled = conn === "closed";
  const canSend = !disabled && (text.trim().length > 0 || images.length > 0);
  const stopTyping = () => {
    if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; setTyping(false); }
  };
  const onChange = (v: string) => {
    setText(v);
    if (!typingTimer.current) setTyping(true);
    else clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };
  const submit = () => {
    if (!canSend) return;
    stopTyping();
    void send(text.trim(), images);
    setText("");
    setImages([]);
  };

  const addScreenshots = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast(t("report-problem.error.allowPhotoAccessToAttachAScreenshot"), "error"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - images.length,
      // The server takes PNG/JPEG/WebP/GIF only; iOS would otherwise hand back HEIC.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled) return;
    const kept: ChatImage[] = [];
    for (const a of res.assets) {
      const type = resolveImageType(a.mimeType, a.uri);
      if (!type || !(BUG_REPORT_IMAGE_TYPES as readonly string[]).includes(type)) {
        toast(t("report-problem.error.thatImageTypeIsNotSupportedUsePNGOrJPEG"), "error");
        continue;
      }
      const info = await FileSystem.getInfoAsync(a.uri);
      const size = info.exists && !info.isDirectory ? info.size ?? 0 : 0;
      if (size > BUG_REPORT_IMAGE_MAX_BYTES) {
        toast(t("report-problem.error.thatImageIsOver5MBAndCannotBeAttached"), "error");
        continue;
      }
      kept.push({ uri: a.uri, name: a.fileName ?? `screenshot-${images.length + kept.length + 1}.${EXTENSION_FOR_TYPE[type] ?? "jpg"}`, type });
    }
    setImages((cur) => [...cur, ...kept].slice(0, MAX_IMAGES));
  };

  const ratingClosed = (c: { ended_at: number | null } | null) =>
    lastError === "rating_closed" || (c?.ended_at != null && Date.now() / 1000 - c.ended_at > RATING_WINDOW_SEC);

  const startButton = (
    <Pressable
      testID="support-chat-start"
      accessibilityRole="button"
      className="items-center rounded-lg border border-border px-3 py-2.5"
      onPress={() => { clearError(); startConversation(); }}
    >
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("support-chat.action.startANewConversation")}</Text>
    </Pressable>
  );

  let footer;
  if (pastView) {
    footer = (
      <View className="gap-2 border-t border-border p-3">
        {pastItem && pastItem.status === "ended" ? (
          <RatingCard name={pastItem.persona?.name ?? null} rating={pastItem.rating} closed={ratingClosed(pastItem)} onRate={rate} />
        ) : null}
        <Pressable accessibilityRole="button" className="items-center rounded-lg px-3 py-2" onPress={() => void viewConversation(null)}>
          <Text className="text-sm text-foreground">{t("support-chat.action.back")}</Text>
        </Pressable>
        {startButton}
      </View>
    );
  } else if (ended) {
    footer = (
      <View className="gap-2 border-t border-border p-3">
        <RatingCard name={persona?.name ?? null} rating={conversation?.rating ?? null} closed={ratingClosed(conversation)} onRate={rate} />
        {lastError === "too_many_conversations" ? (
          <Text className="text-xs text-muted-foreground">{t("support-chat.description.youHaveStartedTooManyConversationsToday")}</Text>
        ) : null}
        {startButton}
      </View>
    );
  } else if (notAvailable) {
    footer = <Text className="border-t border-border p-3 text-sm text-muted-foreground">{t("support-chat.description.liveChatIsAvailableOnPaidPlans")}</Text>;
  } else {
    footer = (
      <View className="border-t border-border px-3 py-2">
        {images.length > 0 ? (
          <View className="mb-2 flex-row flex-wrap gap-2">
            {images.map((img, i) => (
              <View key={`${img.uri}:${i}`} className="flex-row items-center gap-1 rounded-md bg-secondary px-2 py-1">
                <Text className="max-w-40 text-xs text-foreground" numberOfLines={1}>{img.name}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t("support-chat.action.close")} hitSlop={8} onPress={() => setImages((cur) => cur.filter((_, j) => j !== i))}>
                  <Icon name="close" size={14} color={tokens.mutedForeground} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-end gap-2">
          <Pressable
            testID="support-chat-attach"
            accessibilityRole="button"
            accessibilityLabel={t("support-chat.action.screenshot")}
            disabled={disabled || images.length >= MAX_IMAGES}
            onPress={() => void addScreenshots()}
            className="h-10 w-10 items-center justify-center rounded-full"
          >
            <Icon name="image-outline" size={22} color={tokens.mutedForeground} />
          </Pressable>
          <TextInput
            testID="support-chat-input"
            value={text}
            onChangeText={onChange}
            editable={!disabled}
            placeholder={t("support-chat.placeholder.writeAMessage")}
            placeholderTextColor={tokens.mutedForeground}
            multiline
            className="max-h-28 flex-1 rounded-2xl bg-secondary px-3.5 py-2.5 text-[15px] text-foreground"
            style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
          />
          <Pressable
            testID="support-chat-send"
            accessibilityRole="button"
            accessibilityLabel={t("support-chat.action.send")}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={submit}
            className={"h-10 w-10 items-center justify-center rounded-full " + (canSend ? "bg-primary" : "bg-secondary")}
          >
            <Icon name="arrow-up" size={18} color={canSend ? tokens.primaryForeground : tokens.mutedForeground} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("common.action.liveChat"),
          headerRight: () => (
            <View className="flex-row items-center gap-4">
              <Pressable testID="support-chat-history" accessibilityRole="button" accessibilityLabel={t("support-chat.action.conversations")} hitSlop={10} onPress={() => setListOpen(true)}>
                <Icon name="time-outline" size={22} color={tokens.foreground} />
              </Pressable>
              {canEnd ? (
                <Pressable testID="support-chat-end" accessibilityRole="button" accessibilityLabel={t("support-chat.action.endConversation")} hitSlop={10} onPress={() => setConfirmEnd(true)}>
                  <Icon name="checkmark-circle-outline" size={22} color={tokens.foreground} />
                </Pressable>
              ) : null}
            </View>
          ),
        }}
      />
      <View className="flex-row items-center gap-3 border-b border-border px-4 py-3">
        <SupportAvatar persona={persona} size={36} />
        <View className="flex-1">
          <Text className="text-[15px] text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={1}>{heading}</Text>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            {!ended ? <OnlineDot /> : null}
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>{status}</Text>
          </View>
        </View>
      </View>
      {conn === "reconnecting" || conn === "polling" ? (
        <Text className="bg-secondary px-4 py-1 text-center text-xs text-muted-foreground">{t("support-chat.status.reconnecting")}</Text>
      ) : null}
      <View testID="support-chat-body" className="flex-1" style={{ paddingBottom: keyboardLift }}>
        <FlatList
          ref={listRef}
          testID="support-chat-thread"
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerClassName="gap-2 px-4 pb-3 pt-2"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) =>
            item.kind === "day" ? (
              <Text className="my-2 text-center text-[11px] text-muted-foreground">{item.label}</Text>
            ) : item.message.author_type === "system" ? (
              <SystemLine message={item.message} />
            ) : (
              <Bubble message={item.message} status={item.message.id === lastOwn?.id ? ownStatus(item.message) : null} />
            )
          }
          ListFooterComponent={
            typing && !pastView ? (
              <Text className="mt-1 text-xs text-muted-foreground">
                {t("support-chat.status.personaIsTyping", { name: typingName || t("support-chat.heading.dosyaSupport") })}
              </Text>
            ) : null
          }
        />
        {footer}
      </View>
      <ConversationList visible={listOpen} onClose={() => setListOpen(false)} />
      <ConfirmDialog
        visible={confirmEnd}
        title={t("support-chat.action.endConversation")}
        message={t("support-chat.description.endThisConversation")}
        confirmLabel={t("common.yes")}
        onConfirm={() => { setConfirmEnd(false); endConversation(); }}
        onCancel={() => setConfirmEnd(false)}
      />
    </SafeAreaView>
  );
}
