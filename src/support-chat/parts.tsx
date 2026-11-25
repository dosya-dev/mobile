// Pieces of the live chat screen: avatar, bubbles, system lines, rating card and
// the past-conversations list. Ported from the desktop components
// (apps/desktop/src/renderer/components/support-chat) onto the mobile UI kit.
import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { Icon } from "@/ui/Icon";
import { DosyaLogo } from "@/ui/brand-icons";
import { fonts } from "@/theme/fonts";
import { useColorTheme } from "@/theme/useColorTheme";
import { useLocale, useT } from "@/lib/i18n";
import { inputStartAlign } from "@/lib/direction";
import { chatAttachmentSource, personaAvatarUri } from "./api";
import { useSupportChat, type ThreadMessage } from "./store";
import type { ChatMessage, Persona, Rating } from "./types";

/** Who is answering: the persona's photo when there is one, otherwise the dosya mark. */
export function SupportAvatar({ persona, size = 28 }: { persona: Pick<Persona, "avatar_url"> | null; size?: number }) {
  const { tokens } = useColorTheme();
  if (persona?.avatar_url) {
    return (
      <ExpoImage
        source={{ uri: personaAvatarUri(persona.avatar_url) }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      testID="support-logo-avatar"
      className="items-center justify-center rounded-full border border-border bg-background"
      style={{ width: size, height: size }}
    >
      <DosyaLogo size={Math.round(size * 0.62)} color={tokens.foreground} />
    </View>
  );
}

/** Green presence dot: support always reads as available. */
export function OnlineDot() {
  const { tokens } = useColorTheme();
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.brand }} />;
}

export function Bubble({ message: m, status }: { message: ThreadMessage; status: string | null }) {
  const own = m.author_type === "user";
  return (
    <View className={"max-w-[85%] flex-row gap-2 " + (own ? "self-end" : "self-start")}>
      {!own ? <SupportAvatar persona={m.persona ?? null} size={24} /> : null}
      <View className={"shrink " + (own ? "items-end" : "items-start")}>
        <View className={"rounded-2xl px-3 py-2 " + (own ? "bg-primary" : "border border-border bg-secondary")}>
          {m.body ? (
            <Text className={"text-[15px] " + (own ? "text-primary-foreground" : "text-foreground")} style={{ fontFamily: fonts.regular }}>
              {m.body}
            </Text>
          ) : null}
          {m.previews
            ? m.previews.map((p) => (
                <ExpoImage key={p.key} source={{ uri: p.url }} style={{ width: 180, height: 180, borderRadius: 10, marginTop: 6 }} contentFit="cover" />
              ))
            : m.attachments.map((a) => (
                <ExpoImage key={a.id} source={chatAttachmentSource(a.id)} style={{ width: 180, height: 180, borderRadius: 10, marginTop: 6 }} contentFit="cover" />
              ))}
        </View>
        {status ? <Text className="mt-0.5 px-1 text-[11px] text-muted-foreground">{status}</Text> : null}
      </View>
    </View>
  );
}

export function SystemLine({ message: m }: { message: ChatMessage }) {
  const t = useT();
  let text = m.body;
  if (m.kind === "ticket_created") {
    text = t("support-chat.description.weOpenedTicketTicketnumberForThis", { ticketNumber: String(m.meta?.ticket_number ?? "") });
  } else if (m.kind === "persona_joined") {
    const who = m.meta?.persona_name;
    if (typeof who === "string" && who) text = t("support-chat.description.personaJoinedTheConversation", { name: who });
  } else if (m.kind === "closed") {
    text = t("support-chat.label.conversationEnded");
  }
  return <Text className="my-1 self-center text-center text-xs text-muted-foreground">{text}</Text>;
}

const MAX_COMMENT = 500;

/** Stars, "was it solved" and an optional note once a conversation ended; read-only after the 7-day window. */
export function RatingCard({ name, rating, closed, onRate }: {
  name: string | null;
  rating: Rating | null;
  closed: boolean;
  onRate: (stars: number, solved: boolean, comment: string) => Promise<void>;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const [stars, setStars] = useState(rating?.stars ?? 0);
  const [solved, setSolved] = useState<boolean | null>(rating?.solved ?? null);
  const [comment, setComment] = useState(rating?.comment ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rating) return;
    setStars(rating.stars);
    setSolved(rating.solved);
    setComment(rating.comment ?? "");
  }, [rating?.stars, rating?.solved, rating?.comment]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = name ? t("support-chat.heading.howWasYourChatWithName", { name }) : t("support-chat.heading.howWasYourChat");
  const shown = rating && closed ? rating.stars : stars;
  const unchanged = rating !== null && stars === rating.stars && solved === rating.solved && comment.trim() === (rating.comment ?? "");
  const canSend = !closed && !!stars && solved !== null && !busy && !unchanged;
  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try { await onRate(stars, solved as boolean, comment); } finally { setBusy(false); }
  };
  const pill = (active: boolean) => "rounded-full border px-3 py-1.5 " + (active ? "border-primary bg-primary" : "border-border");

  return (
    <View testID="support-chat-rating" className="gap-2.5 rounded-xl border border-border p-3">
      <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{heading}</Text>
      <View className="flex-row gap-1" accessibilityRole={closed ? "image" : "radiogroup"} accessibilityLabel={t("support-chat.label.starsOutOfFive", { count: shown })}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            disabled={closed}
            accessibilityRole="radio"
            accessibilityState={{ checked: stars === n }}
            accessibilityLabel={t("support-chat.label.starsOutOfFive", { count: n })}
            hitSlop={4}
            onPress={() => setStars(n)}
          >
            <Icon name={n <= shown ? "star" : "star-outline"} size={24} color={n <= shown ? "#fbbf24" : tokens.mutedForeground} />
          </Pressable>
        ))}
      </View>
      {rating ? <Text className="text-xs text-muted-foreground">{t("support-chat.feedback.thanksForYourFeedback")}</Text> : null}
      {closed ? (
        rating ? <Text className="text-xs text-muted-foreground">{rating.solved ? t("support-chat.label.solved") : t("support-chat.label.notSolved")}</Text> : null
      ) : (
        <>
          <Text className="text-xs text-muted-foreground">{t("support-chat.label.wasYourIssueSolved")}</Text>
          <View className="flex-row gap-2">
            <Pressable accessibilityRole="button" accessibilityState={{ selected: solved === true }} className={pill(solved === true)} onPress={() => setSolved(true)}>
              <Text className={"text-xs " + (solved === true ? "text-primary-foreground" : "text-foreground")}>{t("common.yes")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: solved === false }} className={pill(solved === false)} onPress={() => setSolved(false)}>
              <Text className={"text-xs " + (solved === false ? "text-primary-foreground" : "text-foreground")}>{t("common.no")}</Text>
            </Pressable>
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            maxLength={MAX_COMMENT}
            multiline
            placeholder={t("support-chat.placeholder.anythingElseOptional")}
            placeholderTextColor={tokens.mutedForeground}
            className="min-h-12 rounded-xl bg-secondary px-3 py-2 text-sm text-foreground"
            style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
          />
          <Pressable
            testID="support-chat-rate"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void submit()}
            className={"self-end rounded-lg px-3 py-1.5 " + (canSend ? "bg-primary" : "bg-secondary")}
          >
            <Text className={"text-xs " + (canSend ? "text-primary-foreground" : "text-muted-foreground")} style={{ fontFamily: fonts.medium }}>
              {t("support-chat.action.sendRating")}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

/** Past and current conversations, newest first, as a sheet over the chat. */
export function ConversationList({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { tokens } = useColorTheme();
  const history = useSupportChat((s) => s.history);
  const loadHistory = useSupportChat((s) => s.loadHistory);
  const viewConversation = useSupportChat((s) => s.viewConversation);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  useEffect(() => { if (visible) void loadHistory(); }, [visible, loadHistory]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <Text className="text-base text-foreground" style={{ fontFamily: fonts.medium }}>{t("support-chat.action.conversations")}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("support-chat.action.close")} hitSlop={10} onPress={onClose}>
            <Icon name="close" size={22} color={tokens.mutedForeground} />
          </Pressable>
        </View>
        <FlatList
          data={history}
          keyExtractor={(c) => c.id}
          ListEmptyComponent={<Text className="p-6 text-center text-sm text-muted-foreground">{t("support-chat.label.noConversationsYet")}</Text>}
          renderItem={({ item: c }) => (
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-3 border-b border-border px-4 py-3"
              onPress={() => { void viewConversation(c.id); onClose(); }}
            >
              <SupportAvatar persona={c.persona} size={28} />
              <View className="flex-1">
                <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }} numberOfLines={1}>
                  {c.title || t("support-chat.label.conversation")}
                </Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {c.persona ? `${c.persona.name} · ` : ""}{fmt.format(new Date(c.started_at * 1000))}
                </Text>
              </View>
              {c.rating ? (
                <View className="flex-row items-center gap-0.5" accessibilityLabel={t("support-chat.label.starsOutOfFive", { count: c.rating.stars })}>
                  <Icon name="star" size={14} color="#fbbf24" />
                  <Text className="text-xs text-muted-foreground">{c.rating.stars}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}
