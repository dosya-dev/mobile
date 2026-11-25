import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { toast } from "@/ui/toast";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useColorTheme } from "@/theme/useColorTheme";
import { rtlLine, useT } from "@/lib/i18n";
import type { MessageKey } from "@/i18n/keys";
import { formatBytes, formatDate } from "@/files/format";
import {
  listUploads, listRecipients, addRecipient, removeRecipient,
  resendInvite, patchRequest, revokeRequest,
  type RequestRow, type RecipientRow, type UploadRow,
} from "@/requests/api";
import {
  requestStatus, statusLabel, describeLimits, destinationLabel,
  recipientState, parseEmails,
} from "@/requests/status";
import { localDigits } from "@/lib/format-locale";

/**
 * One file request: the link, what arrived, who was asked, and the controls.
 *
 * Uploads are read-only. Opening one would need the viewer's whole lock and
 * hidden-mode dance for no clear gain - the same files are in the destination
 * folder, where the viewer already works.
 */
export default function RequestDetailScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const requestId = id ?? "";
  const router = useRouter();
  const { tokens } = useColorTheme();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  // Server text as sent, or one of our own messages kept as a key so it follows a language switch.
  const [addError, setAddError] = useState<{ text: string } | { key: MessageKey } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RecipientRow | null>(null);
  const [closing, setClosing] = useState(false);

  const uploadsQ = useQuery({
    queryKey: ["file-request", requestId, "uploads"],
    enabled: !!requestId,
    queryFn: () => listUploads(requestId),
  });
  const recipientsQ = useQuery({
    queryKey: ["file-request", requestId, "recipients"],
    enabled: !!requestId,
    queryFn: () => listRecipients(requestId),
  });

  const request = uploadsQ.data?.request ?? null;
  const uploads = uploadsQ.data?.uploads ?? [];
  const recipients = recipientsQ.data ?? [];
  const now = Math.floor(Date.now() / 1000);
  const status = request ? requestStatus(request, now) : null;
  const closed = request?.is_revoked === 1;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["file-request", requestId] });
    void qc.invalidateQueries({ queryKey: ["file-requests"] });
  };
  const onError = (e: unknown) => toast(e instanceof Error ? e.message : t("common.error.somethingWentWrong"), "error");

  const add = useMutation({
    mutationFn: (email: string) => addRecipient(requestId, email),
    onSuccess: () => { setNewEmail(""); setAddError(null); invalidate(); },
    // 409 (already a recipient) and 410 (request closed) are both about the
    // address just typed, so they belong against the field rather than in a toast
    // that slides away before it is read.
    onError: (e) => setAddError(e instanceof Error ? { text: e.message } : { key: "file-requests.error.couldNotAddThatAddress" }),
  });

  const remove = useMutation({
    mutationFn: (recipientId: string) => removeRecipient(requestId, recipientId),
    onSuccess: invalidate,
    onError,
  });

  const resend = useMutation({
    mutationFn: (recipientId: string) => resendInvite(requestId, recipientId),
    onSuccess: () => toast(t("file-requests.label.inviteResent")),
    onError,
  });

  const resendAll = useMutation({
    mutationFn: async (targets: RecipientRow[]) => {
      let sent = 0;
      for (const r of targets) {
        try { await resendInvite(requestId, r.id); sent++; } catch { /* counted below */ }
      }
      return { sent, total: targets.length };
    },
    // Reports how many of how many. A resend that claims success while the mail
    // provider refused half of them is worse than saying so.
    onSuccess: ({ sent, total }) =>
      toast(sent === total ? t("file-requests.error.resentToTotal", { total: localDigits(total) }) : t("file-requests.error.resentToSentOfTotal", { sent: localDigits(sent), total: localDigits(total) }), sent ? "success" : "error"),
    onError,
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchRequest(requestId, body),
    onSuccess: () => { setEditing(false); setEditTitle(null); setEditMessage(null); invalidate(); },
    onError,
  });

  const close = useMutation({
    mutationFn: () => revokeRequest(requestId),
    onSuccess: () => { toast(t("file-requests.status.requestClosed")); invalidate(); },
    onError,
  });

  const submitAdd = () => {
    const [email] = parseEmails(newEmail);
    if (!email) { setAddError({ key: "file-requests.error.enterAValidEmailAddress" }); return; }
    add.mutate(email);
  };

  const saveEdit = () => {
    const body: Record<string, unknown> = {};
    if (editTitle !== null && editTitle.trim() !== (request?.title ?? "")) body.title = editTitle.trim();
    if (editMessage !== null && editMessage.trim() !== (request?.message ?? "")) body.message = editMessage.trim();
    // Only what changed. PATCH writes exactly the keys it receives, so sending
    // the whole form would rewrite fields nobody touched.
    if (!Object.keys(body).length) { setEditing(false); return; }
    patch.mutate(body);
  };

  const pending = recipients.filter((r) => recipientState(r) !== "uploaded");

  if (uploadsQ.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: true, title: t("file-requests.heading.request") }} />
        <View className="mt-16 items-center"><ActivityIndicator color={tokens.primary} /></View>
      </SafeAreaView>
    );
  }

  if (uploadsQ.isError || !request) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
        <Stack.Screen options={{ headerShown: true, title: t("file-requests.heading.request") }} />
        <View className="mt-16 items-center px-8" testID="detail-error">
          <Icon name="cloud-offline-outline" size={26} color={tokens.mutedForeground} />
          <Text className="mt-2 text-center text-sm text-muted-foreground">
            {t("file-requests.error.couldNotLoadThisRequest")}
          </Text>
          <Pressable
            testID="detail-retry"
            accessibilityRole="button"
            onPress={() => void uploadsQ.refetch()}
            className="mt-3 rounded-lg border border-border px-3 py-1.5"
          >
            <Text className="text-xs text-foreground">{t("common.retry")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const limits = describeLimits(request);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: request.title || t("file-requests.heading.request") }} />
      <ScrollView contentContainerClassName="pb-10" keyboardShouldPersistTaps="handled">
        {/* ── the request itself ───────────────────────────────── */}
        <View className="border-b border-border px-5 py-4">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-lg text-foreground" style={{ fontFamily: fonts.medium }}>
              {request.title || t("file-requests.label.untitledRequest")}
            </Text>
            {status ? (
              <View className="rounded-full bg-secondary px-2 py-0.5">
                <Text className="text-[10.5px] text-muted-foreground" style={{ fontFamily: fonts.medium }}>
                  {statusLabel(status)}
                </Text>
              </View>
            ) : null}
          </View>
          {request.message ? (
            <Text className="mt-1 text-sm text-muted-foreground">{request.message}</Text>
          ) : null}
          <Text className="mt-1.5 text-xs text-muted-foreground">
            {t("file-requests.label.uploadsLandInDestinationLabel", { destinationLabel: destinationLabel(request) })}
            {request.expires_at ? ` ${t("file-requests.label.expiresDate", { date: formatDate(request.expires_at) })}` : ` ${t("file-requests.label.noExpiry")}`}
          </Text>
          {limits ? <Text className="mt-0.5 text-[11px] text-muted-foreground">{limits}</Text> : null}

          <Text
            testID="detail-link"
            className="mt-3 text-xs text-muted-foreground"
            style={{ fontFamily: fonts.mono }}
            numberOfLines={2}
          >
            {request.url}
          </Text>
          <View className="mt-2.5 flex-row gap-2">
            <Pressable
              testID="detail-copy"
              accessibilityRole="button"
              onPress={() => { void Clipboard.setStringAsync(request.url); toast(t("common.label.linkCopied")); }}
              className="flex-row items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5"
            >
              <Icon name="copy-outline" size={13} color={tokens.foreground} />
              <Text className="text-xs text-foreground">{t("common.action.copyLink")}</Text>
            </Pressable>
            <Pressable
              testID="detail-share"
              accessibilityRole="button"
              onPress={() => void Share.share({ message: request.url })}
              className="flex-row items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5"
            >
              <Icon name="share-outline" size={13} color={tokens.foreground} />
              <Text className="text-xs text-foreground">{t("common.action.share")}</Text>
            </Pressable>
          </View>
        </View>

        {/* ── uploads ─────────────────────────────────────────── */}
        <SectionHeading label={t("file-requests.label.uploadsUploadsCount", { uploadsCount: localDigits(uploads.length) })} />
        {uploads.length === 0 ? (
          <Text testID="uploads-empty" className="px-5 py-3 text-sm text-muted-foreground">
            {t("file-requests.description.nothingUploadedYet")}
          </Text>
        ) : (
          uploads.map((u: UploadRow) => (
            <View key={u.id} testID={`upload-${u.id}`} className="flex-row items-center gap-3 border-b border-border px-5 py-3">
              <Icon name="document-outline" size={18} color={tokens.mutedForeground} />
              <View className="flex-1">
                <Text className="text-sm text-foreground" numberOfLines={1}>{u.file_name}</Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {rtlLine(`${formatBytes(u.size_bytes)} · ${u.uploader_name || u.uploader_email || t("file-request-detail.label.anonymous")}`)}
                </Text>
              </View>
            </View>
          ))
        )}

        {/* ── recipients ──────────────────────────────────────── */}
        <View className="mt-2 flex-row items-center justify-between px-5 pb-1 pt-4">
          <Text className="text-xs uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.medium }}>
            {t("file-requests.label.recipientsRecipientsCount", { recipientsCount: localDigits(recipients.length) })}
          </Text>
          {pending.length > 0 && !closed ? (
            <Pressable
              testID="recipients-resend-all"
              accessibilityRole="button"
              disabled={resendAll.isPending}
              onPress={() => resendAll.mutate(pending)}
            >
              <Text className="text-xs text-primary" style={{ fontFamily: fonts.medium }}>
                {resendAll.isPending ? t("report-problem.status.sending") : t("file-requests.action.resendAllPendingCount", { pendingCount: localDigits(pending.length) })}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {recipients.length === 0 ? (
          <Text testID="recipients-empty" className="px-5 py-3 text-sm text-muted-foreground">
            {t("file-requests.description.nobodyHasBeenInvitedTheLinkWorksOnItsOwn")}
          </Text>
        ) : (
          recipients.map((r) => (
            <RecipientRowView
              key={r.id}
              recipient={r}
              closed={!!closed}
              busy={resend.isPending || remove.isPending}
              onResend={() => resend.mutate(r.id)}
              onRemove={() => setRemoveTarget(r)}
            />
          ))
        )}

        {!closed ? (
          <View className="px-5 pt-3">
            <View className="flex-row items-start gap-2">
              <View className="flex-1">
                <TextField
                  value={newEmail}
                  onChangeText={(text) => { setNewEmail(text); if (addError) setAddError(null); }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder={t("file-requests.placeholder.inviteAnotherAddress")}
                  testID="recipient-add-input"
                />
              </View>
              <Pressable
                testID="recipient-add"
                accessibilityRole="button"
                accessibilityLabel={t("file-requests.action.addRecipient")}
                disabled={add.isPending}
                onPress={submitAdd}
                className="h-[46px] w-[46px] items-center justify-center rounded-lg bg-secondary"
              >
                <Icon name="add" size={20} color={tokens.foreground} />
              </Pressable>
            </View>
            {addError && ("key" in addError || addError.text) ? (
              <Text testID="recipient-add-error" className="-mt-2 text-xs text-destructive">{"text" in addError ? addError.text : t(addError.key)}</Text>
            ) : null}
          </View>
        ) : null}

        {/* ── edit and close ──────────────────────────────────── */}
        <SectionHeading label={t("dashboard.action.manage")} />
        {editing ? (
          <View className="px-5 pt-3">
            <TextField
              label={t("file-requests.label.title")}
              value={editTitle ?? request.title ?? ""}
              onChangeText={setEditTitle}
              autoCapitalize="sentences"
              testID="edit-title"
            />
            <TextField
              label={t("common.label.message")}
              value={editMessage ?? request.message ?? ""}
              onChangeText={setEditMessage}
              autoCapitalize="sentences"
              testID="edit-message"
            />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button
                  title={t("common.cancel")}
                  variant="ghost"
                  onPress={() => { setEditing(false); setEditTitle(null); setEditMessage(null); }}
                  testID="edit-cancel"
                />
              </View>
              <View className="flex-1">
                <Button title={t("common.save")} onPress={saveEdit} loading={patch.isPending} testID="edit-save" />
              </View>
            </View>
          </View>
        ) : (
          <View className="px-5 pt-3">
            <Pressable
              testID="detail-edit"
              accessibilityRole="button"
              onPress={() => setEditing(true)}
              className="flex-row items-center gap-2 py-2.5"
            >
              <Icon name="create-outline" size={18} color={tokens.foreground} />
              <Text className="text-sm text-foreground">{t("file-requests.action.editTitleAndMessage")}</Text>
            </Pressable>
            {!closed ? (
              <Pressable
                testID="detail-close"
                accessibilityRole="button"
                onPress={() => setClosing(true)}
                className="flex-row items-center gap-2 py-2.5"
              >
                <Icon name="lock-closed-outline" size={18} color={tokens.destructive} />
                <Text className="text-sm text-destructive">{t("file-requests.action.closeRequest")}</Text>
              </Pressable>
            ) : (
              <Text className="py-2.5 text-xs text-muted-foreground">
                {t("file-requests.description.thisRequestIsClosedTheLinkNoLongerAcceptsUploads")}
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!removeTarget}
        title={t("file-requests.heading.removeRecipient")}
        message={removeTarget ? t("file-requests.description.emailKeepsAnyFilesAlreadyUploaded", { email: removeTarget.email }) : undefined}
        confirmLabel={t("common.remove")}
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) remove.mutate(target.id);
        }}
      />

      <ConfirmDialog
        visible={closing}
        title={t("file-requests.heading.closeThisRequest")}
        // Named for what the server does: DELETE sets is_revoked and keeps the
        // row, so promising a delete would be a lie the list disproves.
        message={t("file-requests.description.itStopsAcceptingUploadsFilesAlreadyReceivedAreKept")}
        confirmLabel={t("file-requests.action.closeRequest")}
        destructive
        onCancel={() => setClosing(false)}
        onConfirm={() => { setClosing(false); close.mutate(); }}
      />
    </SafeAreaView>
  );
}

function SectionHeading(props: { label: string }) {
  return (
    <Text
      className="px-5 pb-1 pt-4 text-xs uppercase tracking-wider text-muted-foreground"
      style={{ fontFamily: fonts.medium }}
    >
      {props.label}
    </Text>
  );
}

/** Keys, not text: produced at render so a language switch reaches it. */
const STATE_COPY: Record<string, MessageKey> = {
  uploaded: "common.status.uploaded",
  invited: "common.status.invited",
  pending: "file-requests.label.notSentYet",
};

function RecipientRowView(props: {
  recipient: RecipientRow;
  closed: boolean;
  busy: boolean;
  onResend: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const r = props.recipient;
  const state = recipientState(r);

  return (
    <View testID={`recipient-${r.id}`} className="flex-row items-center gap-3 border-b border-border px-5 py-3">
      <Icon
        name={state === "uploaded" ? "checkmark-circle" : "mail-outline"}
        size={18}
        color={state === "uploaded" ? tokens.primary : tokens.mutedForeground}
      />
      <View className="flex-1">
        <Text className="text-sm text-foreground" numberOfLines={1}>{r.email}</Text>
        <Text className="text-xs text-muted-foreground">{t(STATE_COPY[state])}</Text>
      </View>
      {state !== "uploaded" && !props.closed ? (
        <Pressable
          testID={`recipient-${r.id}-resend`}
          accessibilityRole="button"
          accessibilityLabel={t("file-requests.action.resendToEmail", { email: r.email })}
          hitSlop={8}
          disabled={props.busy}
          onPress={props.onResend}
        >
          <Icon name="send-outline" size={17} color={tokens.foreground} />
        </Pressable>
      ) : null}
      <Pressable
        testID={`recipient-${r.id}-remove`}
        accessibilityRole="button"
        accessibilityLabel={t("common.accessibility.removeMName", { mName: r.email })}
        hitSlop={8}
        disabled={props.busy}
        onPress={props.onRemove}
      >
        <Icon name="trash-outline" size={17} color={tokens.destructive} />
      </Pressable>
    </View>
  );
}
