import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useKeyboardLift } from "@/ui/useKeyboardLift";
import { Stack, useLocalSearchParams } from "expo-router";
import { Icon, type IconName } from "@/ui/Icon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { toast } from "@/ui/toast";
import { rtlLine, useT } from "@/lib/i18n";
import { richText } from "@/lib/rich-text";
import { formatDateWith } from "@/lib/format-locale";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useColorTheme } from "@/theme/useColorTheme";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { usePermissions } from "@/workspace/usePermissions";
import {
  listComments, postComment, editComment, deleteComment,
  MAX_COMMENT_LENGTH, type CommentRow,
} from "@/comments/api";
import { groupByDay, quotedParent, canEdit, canDelete, isRunStart } from "@/comments/thread";
import { inputStartAlign } from "@/lib/direction";

/** Show the character count only once the cap is within reach. */
const COUNTER_THRESHOLD = MAX_COMMENT_LENGTH - 500;

function clockTime(ts: number): string {
  return formatDateWith(ts, { hour: "2-digit", minute: "2-digit" }, "en-US");
}

type Row =
  | { kind: "day"; key: string; label: string }
  | { kind: "comment"; key: string; comment: CommentRow; header: boolean };

/**
 * The conversation on one file.
 *
 * Shaped like the chat it is rather than like web's two-column page: own
 * messages right, everyone else left, day separators, and an author header only
 * when the speaker changes or five minutes pass.
 *
 * Replies render inline with a quoted parent rather than indented. Indenting
 * means deciding what to do at depth two, and the desktop app's answer today is
 * to not draw the comment at all; a flat list with a quote cannot hide anything,
 * and a second indent costs a quarter of the line on a phone.
 *
 * The list is NOT `inverted`, though a chat usually would be: an inverted
 * FlatList renders ListEmptyComponent rotated 180 degrees, and this screen's
 * empty and error states are load-bearing. It scrolls to the end on content
 * growth instead, which puts the newest message in the same place.
 */
export default function CommentsScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ fileId?: string; name?: string }>();
  const fileId = params.fileId ?? null;
  const fileName = params.name ?? t("common.label.thisFile");

  const { tokens } = useColorTheme();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const { userId, roleName } = usePermissions();
  const qc = useQueryClient();
  const listRef = useRef<FlatList<Row>>(null);
  // Keeps the composer above the keyboard on both platforms (see useKeyboardLift).
  const keyboardLift = useKeyboardLift();

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [pendingDelete, setPendingDelete] = useState<CommentRow | null>(null);

  // Without both, the request would carry workspace_id=undefined. Treated as the
  // same failure the network can produce, and shown the same way.
  const ready = !!ws && !!fileId;

  const q = useQuery({
    queryKey: ["comments", fileId],
    enabled: ready,
    queryFn: () => listComments(ws as string, fileId as string),
  });

  const comments = q.data ?? [];
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["comments", fileId] });
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : t("common.error.somethingWentWrong"), "error");

  const post = useMutation({
    mutationFn: (input: { body: string; parentId: string | null }) =>
      postComment({ workspaceId: ws as string, fileId: fileId as string, body: input.body, parentId: input.parentId }),
    // Cleared here and nowhere else: a failed post must leave the typed message
    // exactly where it was.
    onSuccess: () => { setBody(""); setReplyTo(null); invalidate(); },
    onError,
  });

  const edit = useMutation({
    mutationFn: (v: { id: string; body: string }) => editComment(v.id, v.body),
    onSuccess: () => { setEditId(null); invalidate(); },
    // A 403 means the server disagrees with what we offered - refetch so the
    // screen stops showing a control that does not work.
    onError: (e) => { onError(e); invalidate(); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: invalidate,
    onError: (e) => { onError(e); invalidate(); },
  });

  const trimmed = body.trim();
  const tooLong = body.length > MAX_COMMENT_LENGTH;
  const canSend = !!trimmed && !tooLong && !post.isPending;

  const submit = () => {
    if (!canSend) return;
    post.mutate({ body: trimmed, parentId: replyTo?.id ?? null });
  };

  // Stable for the life of the screen: day labels do not need to re-date
  // themselves mid-conversation.
  const now = useMemo(() => Math.floor(Date.now() / 1000), []);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const section of groupByDay(comments, now)) {
      out.push({ kind: "day", key: `day-${section.key}`, label: section.label });
      section.comments.forEach((c, i) => {
        out.push({ kind: "comment", key: c.id, comment: c, header: isRunStart(c, section.comments[i - 1]) });
      });
    }
    return out;
  }, [comments, now, t]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("comments.heading.comments") }} />
      <View testID="comments-body" className="flex-1" style={{ paddingBottom: keyboardLift }}>
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerClassName="px-4 pb-3 pt-2"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <Text className="mb-3 text-center text-xs text-muted-foreground" numberOfLines={1}>
              {fileName}
            </Text>
          }
          renderItem={({ item }) =>
            item.kind === "day" ? (
              <Text
                className="my-3 text-center text-[11px] uppercase tracking-wider text-muted-foreground"
                style={{ fontFamily: fonts.medium }}
              >
                {item.label}
              </Text>
            ) : (
              <Bubble
                comment={item.comment}
                header={item.header}
                mine={item.comment.user_id === userId}
                quote={quotedParent(item.comment, comments)}
                editable={canEdit(item.comment, userId)}
                deletable={canDelete(item.comment, userId, roleName)}
                editing={editId === item.comment.id}
                editBody={editBody}
                busy={edit.isPending || remove.isPending}
                onReply={() => setReplyTo(item.comment)}
                onStartEdit={() => { setEditId(item.comment.id); setEditBody(item.comment.body); }}
                onEditBody={setEditBody}
                onSaveEdit={() => {
                  const next = editBody.trim();
                  if (!next || next.length > MAX_COMMENT_LENGTH) return;
                  edit.mutate({ id: item.comment.id, body: next });
                }}
                onCancelEdit={() => setEditId(null)}
                onDelete={() => setPendingDelete(item.comment)}
              />
            )
          }
          ListEmptyComponent={
            q.isLoading ? (
              <View className="mt-16 items-center"><ActivityIndicator color={tokens.primary} /></View>
            ) : q.isError || !ready ? (
              <View className="mt-16 items-center px-8" testID="comments-error">
                <Icon name="cloud-offline-outline" size={26} color={tokens.mutedForeground} />
                <Text className="mt-2 text-center text-sm text-muted-foreground">
                  {t("comments.error.couldNotLoadThisConversation")}
                </Text>
                <Pressable
                  testID="comments-retry"
                  accessibilityRole="button"
                  onPress={() => void q.refetch()}
                  className="mt-3 rounded-lg border border-border px-3 py-1.5"
                >
                  <Text className="text-xs text-foreground">{t("common.retry")}</Text>
                </Pressable>
              </View>
            ) : (
              <View className="mt-16 items-center px-8" testID="comments-empty">
                <Icon name="chatbubble-ellipses-outline" size={26} color={tokens.mutedForeground} />
                <Text className="mt-2 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                  {t("files.empty.noCommentsYet")}
                </Text>
                <Text className="mt-0.5 text-center text-xs text-muted-foreground">
                  {t("comments.description.startTheConversationOnThisFile")}
                </Text>
              </View>
            )
          }
        />

        {replyTo ? (
          <View
            testID="comments-reply-strip"
            className="flex-row items-center gap-2 border-t border-border bg-secondary px-4 py-2"
          >
            <Icon name="arrow-undo-outline" size={13} color={tokens.mutedForeground} />
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>
              {richText(t("files.label.replyingToUserName"), {
                userName: <Text style={{ fontFamily: fonts.medium }}>{replyTo.user_name}</Text>,
              })}
            </Text>
            <Pressable
              testID="comments-reply-cancel"
              accessibilityRole="button"
              accessibilityLabel={t("files.tooltip.cancelReply")}
              hitSlop={10}
              onPress={() => setReplyTo(null)}
            >
              <Icon name="close" size={15} color={tokens.mutedForeground} />
            </Pressable>
          </View>
        ) : null}

        <View className="border-t border-border px-3 py-2">
          <View className="flex-row items-end gap-2">
            <TextInput
              testID="comments-input"
              value={body}
              onChangeText={setBody}
              placeholder={t("comments.placeholder.writeAComment")}
              placeholderTextColor={tokens.mutedForeground}
              multiline
              className="max-h-28 flex-1 rounded-2xl bg-secondary px-3.5 py-2.5 text-[15px] text-foreground"
              style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
            />
            <Pressable
              testID="comments-send"
              accessibilityRole="button"
              accessibilityLabel={t("comments.action.sendComment")}
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={submit}
              className={"h-10 w-10 items-center justify-center rounded-full " + (canSend ? "bg-primary" : "bg-secondary")}
            >
              {post.isPending ? (
                <ActivityIndicator size="small" color={tokens.primaryForeground} />
              ) : (
                <Icon
                  name="arrow-up"
                  size={18}
                  color={canSend ? tokens.primaryForeground : tokens.mutedForeground}
                />
              )}
            </Pressable>
          </View>
          {body.length > COUNTER_THRESHOLD ? (
            <Text
              testID="comments-counter"
              className={"mt-1 self-end text-[11px] " + (tooLong ? "text-destructive" : "text-muted-foreground")}
              style={{ fontFamily: fonts.mono }}
            >
              {body.length} / {MAX_COMMENT_LENGTH}
            </Text>
          ) : null}
        </View>
      </View>

      <ConfirmDialog
        visible={!!pendingDelete}
        title={t("comments.heading.deleteComment")}
        message={t("comments.description.anyRepliesToItAreDeletedToo")}
        confirmLabel={t("common.delete")}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) remove.mutate(target.id);
        }}
      />
    </SafeAreaView>
  );
}

function Bubble(props: {
  comment: CommentRow;
  header: boolean;
  mine: boolean;
  quote: { author: string; excerpt: string } | null;
  editable: boolean;
  deletable: boolean;
  editing: boolean;
  editBody: string;
  busy: boolean;
  onReply: () => void;
  onStartEdit: () => void;
  onEditBody: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const c = props.comment;
  const align = props.mine ? "items-end" : "items-start";
  const bubble = props.mine ? "bg-primary" : "bg-secondary";
  const text = props.mine ? "text-primary-foreground" : "text-foreground";
  const quiet = props.mine ? "text-primary-foreground/70" : "text-muted-foreground";

  return (
    <View testID={`comment-${c.id}`} className={"mb-1.5 w-full " + align}>
      {props.header ? (
        <Text className="mb-1 px-1 text-[11px] text-muted-foreground" numberOfLines={1}>
          <Text style={{ fontFamily: fonts.medium }}>{rtlLine(props.mine ? t("common.label.you") : c.user_name)}</Text>
          {` · ${clockTime(c.created_at)}`}
        </Text>
      ) : null}

      <View className={"max-w-[82%] rounded-2xl px-3.5 py-2.5 " + bubble}>
        {props.quote ? (
          <View
            testID={`comment-${c.id}-quote`}
            className={"mb-1.5 ps-2 " + (props.mine ? "border-primary-foreground/40" : "border-border")}
            style={{ borderStartWidth: 2 }}
          >
            <Text className={"text-[11px] " + quiet} style={{ fontFamily: fonts.medium }} numberOfLines={1}>
              {props.quote.author}
            </Text>
            <Text className={"text-[11px] " + quiet} numberOfLines={2}>
              {props.quote.excerpt}
            </Text>
          </View>
        ) : null}

        {props.editing ? (
          <View>
            <TextInput
              testID="comments-edit-input"
              value={props.editBody}
              onChangeText={props.onEditBody}
              multiline
              autoFocus
              className={"min-w-[180px] text-[15px] " + text}
              style={{ fontFamily: fonts.regular, ...inputStartAlign() }}
            />
            <View className="mt-2 flex-row justify-end gap-3">
              <Pressable testID="comments-edit-cancel" accessibilityRole="button" onPress={props.onCancelEdit}>
                <Text className={"text-xs " + quiet}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                testID="comments-edit-save"
                accessibilityRole="button"
                disabled={props.busy}
                onPress={props.onSaveEdit}
              >
                <Text className={"text-xs " + text} style={{ fontFamily: fonts.medium }}>{t("common.save")}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text className={"text-[15px] " + text} style={{ fontFamily: fonts.regular }}>
            {c.body}
          </Text>
        )}

        {c.is_edited === 1 && !props.editing ? (
          <Text testID={`comment-${c.id}-edited`} className={"mt-1 text-[10px] " + quiet}>
            {t("comments.label.edited")}
          </Text>
        ) : null}
      </View>

      {props.editing ? null : (
        <View className={"mt-1 flex-row gap-3.5 px-1 " + (props.mine ? "justify-end" : "")}>
          <BubbleAction
            testID={`comment-${c.id}-reply`}
            label={t("files.tooltip.reply")}
            icon="arrow-undo-outline"
            color={tokens.mutedForeground}
            onPress={props.onReply}
          />
          {props.editable ? (
            <BubbleAction
              testID={`comment-${c.id}-edit`}
              label={t("common.edit")}
              icon="pencil-outline"
              color={tokens.mutedForeground}
              onPress={props.onStartEdit}
            />
          ) : null}
          {props.deletable ? (
            <BubbleAction
              testID={`comment-${c.id}-delete`}
              label={t("common.delete")}
              icon="trash-outline"
              color={tokens.destructive}
              onPress={props.onDelete}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

function BubbleAction(props: {
  testID: string;
  label: string;
  icon: IconName;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={8}
      onPress={props.onPress}
      className="flex-row items-center gap-1"
    >
      <Icon name={props.icon} size={12} color={props.color} />
      <Text className="text-[11px] text-muted-foreground">{props.label}</Text>
    </Pressable>
  );
}
