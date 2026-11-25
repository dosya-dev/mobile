import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { useT } from "@/lib/i18n";
import { useWorkspaces } from "@/files/hooks";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { formatDate } from "@/files/format";
import { listRequests, createRequest, type RequestRow } from "@/requests/api";
import { requestStatus, statusLabel, describeLimits, destinationLabel } from "@/requests/status";
import { CreateRequestSheet, type CreateRequestValues } from "@/requests/CreateRequestSheet";

/** Chip colours per state. Closed and expired are quiet; full is informational, not an error. */
const CHIP: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-primary/15", text: "text-primary" },
  full: { bg: "bg-secondary", text: "text-foreground" },
  expired: { bg: "bg-secondary", text: "text-muted-foreground" },
  closed: { bg: "bg-secondary", text: "text-muted-foreground" },
};

export default function RequestsScreen() {
  const t = useT();
  const router = useRouter();
  const { tokens } = useColorTheme();
  const workspaces = useWorkspaces();
  const ws = useWorkspaceStore((s) => s.activeId) ?? workspaces.data?.[0]?.id ?? null;
  const qc = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["file-requests", ws],
    enabled: !!ws,
    queryFn: () => listRequests(ws as string),
  });

  const create = useMutation({
    mutationFn: (v: CreateRequestValues) =>
      createRequest({
        workspaceId: ws as string,
        title: v.title.trim() || undefined,
        message: v.message.trim() || undefined,
        password: v.password || undefined,
        expiresInDays: v.expiryDays ? Number(v.expiryDays) : null,
        maxFiles: v.maxFiles ? Number(v.maxFiles) : null,
        maxFileSizeMb: v.maxFileSizeMb ? Number(v.maxFileSizeMb) : null,
        allowedExtensions: v.allowedExtensions.trim() || undefined,
        emails: v.emails,
      }),
    onSuccess: (res, v) => {
      void qc.invalidateQueries({ queryKey: ["file-requests"] });
      // With invites there is nothing to hand over - the mail carries the link.
      // Without them the link IS the deliverable, so the sheet stays to offer it.
      if (v.emails.length) {
        toast(t("file-requests.status.invitedEmailsCountPluralOnePersonOtherPeople", { emailsCount: v.emails.length }));
        setSheetOpen(false);
      } else {
        setResultUrl(res.url);
      }
    },
    onError: (e) => toast(e instanceof Error ? e.message : t("file-requests.error.couldNotCreateTheRequest"), "error"),
  });

  const now = Math.floor(Date.now() / 1000);
  const requests = q.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("file-requests.heading.fileRequests") }} />

      {/* In the body rather than as a headerRight: the empty state needs a call
          to action too, and one control that is always in the same place beats a
          second copy of it that only exists when the list is empty. */}
      <View className="flex-row items-center justify-between border-b border-border px-5 py-2.5">
        <Text className="text-xs text-muted-foreground">
          {requests.length
            ? t("file-requests.label.requestscountPluralOneRequestOtherRequests", { requestsCount: requests.length })
            : t("file-requests.label.askAnyoneForFiles")}
        </Text>
        <Pressable
          testID="requests-new"
          accessibilityRole="button"
          accessibilityLabel={t("file-requests.label.newFileRequest")}
          onPress={() => { setResultUrl(null); setSheetOpen(true); }}
          className="flex-row items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5"
        >
          <Icon name="add" size={14} color={tokens.primaryForeground} />
          <Text className="text-xs text-primary-foreground" style={{ fontFamily: fonts.medium }}>
            {t("file-requests.action.newRequest")}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        contentContainerClassName="pb-8"
        renderItem={({ item }) => <RequestCard request={item} now={now} onPress={() => router.push(`/file-requests/${item.id}`)} />}
        ListEmptyComponent={
          q.isLoading ? (
            <View className="mt-16 items-center"><ActivityIndicator color={tokens.primary} /></View>
          ) : q.isError || !ws ? (
            <View className="mt-16 items-center px-8" testID="requests-error">
              <Icon name="cloud-offline-outline" size={26} color={tokens.mutedForeground} />
              <Text className="mt-2 text-center text-sm text-muted-foreground">
                {t("file-requests.error.couldNotLoadYourFileRequests")}
              </Text>
              <Pressable
                testID="requests-retry"
                accessibilityRole="button"
                onPress={() => void q.refetch()}
                className="mt-3 rounded-lg border border-border px-3 py-1.5"
              >
                <Text className="text-xs text-foreground">{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : (
            <View className="mt-16 items-center px-8" testID="requests-empty">
              <Icon name="cloud-upload-outline" size={26} color={tokens.mutedForeground} />
              <Text className="mt-2 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                {t("file-requests.empty.noFileRequestsYet")}
              </Text>
              <Text className="mt-0.5 text-center text-xs text-muted-foreground">
                {t("file-requests.description.askAnyoneForFilesTheyDoNotNeedAnAccount")}
              </Text>
            </View>
          )
        }
      />

      <CreateRequestSheet
        visible={sheetOpen}
        busy={create.isPending}
        resultUrl={resultUrl}
        onSubmit={(v) => create.mutate(v)}
        onClose={() => { setSheetOpen(false); setResultUrl(null); }}
        onCopyResult={() => {
          if (resultUrl) {
            void Clipboard.setStringAsync(resultUrl);
            toast(t("common.label.linkCopied"));
          }
        }}
      />
    </SafeAreaView>
  );
}

function RequestCard(props: { request: RequestRow; now: number; onPress: () => void }) {
  const t = useT();
  const { tokens } = useColorTheme();
  const r = props.request;
  const status = requestStatus(r, props.now);
  const limits = describeLimits(r);

  return (
    <Pressable
      testID={`request-${r.id}`}
      accessibilityRole="button"
      onPress={props.onPress}
      className="flex-row items-center gap-3 border-b border-border px-5 py-3.5"
    >
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-base text-foreground" numberOfLines={1} style={{ fontFamily: fonts.medium }}>
            {r.title || t("file-requests.label.untitledRequest")}
          </Text>
          <View className={"rounded-full px-2 py-0.5 " + CHIP[status].bg}>
            <Text className={"text-[10.5px] " + CHIP[status].text} style={{ fontFamily: fonts.medium }}>
              {statusLabel(status)}
            </Text>
          </View>
        </View>
        <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={1}>
          {t("file-requests.description.uploadcountPluralOneUploadOtherUploadsDestinationLabel", { uploadCount: r.upload_count, destinationLabel: destinationLabel(r) })}
          {r.expires_at ? ` ${t("file-requests.label.expiresDate", { date: formatDate(r.expires_at) })}` : ""}
        </Text>
        {limits ? (
          <Text className="mt-0.5 text-[11px] text-muted-foreground" numberOfLines={1}>
            {limits}
          </Text>
        ) : null}
      </View>
      {r.is_password_protected === 1 ? (
        <Icon name="lock-closed" size={13} color={tokens.mutedForeground} />
      ) : null}
      <Icon name="chevron-forward" size={18} color={tokens.mutedForeground} />
    </Pressable>
  );
}
