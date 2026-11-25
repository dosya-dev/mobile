import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/ui/Text";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Icon } from "@/ui/Icon";
import * as Clipboard from "expo-clipboard";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { PromptDialog } from "@/ui/PromptDialog";
import { API_BASE_URL } from "@/api";
import { openShare, unlockShare, requestShareCode, verifyShareCode, type SharePayload, type ShareFile } from "@/share/api";
import { useShareIntentStore } from "@/share-intent/store";
import { shareUrl } from "@/share/config";
import { SharePreview } from "@/share/SharePreview";
import { downloadToCache, shareFile } from "@/files/download";
import { formatBytes, kindLabel } from "@/files/format";
import { expiryShort } from "@/share/format";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useT } from "@/lib/i18n";
import { byteCount } from "@/lib/format-locale";
import { richText } from "@/lib/rich-text";
import type { T } from "@/i18n/translator";

/**
 * What the recipient sees.
 *
 * The screen this replaces showed a name, a size and one button, and reported
 * every 410 with the same sentence. It could not preview a file, could not
 * browse a shared folder, could not list a bundle, and never called
 * request-code / verify-code - so a link sent privately to someone was
 * unopenable in the very app that received the notification about it.
 */

type Gate = "loading" | "ready" | "password" | "recipient" | "error";
/** Which failure the page shows. The text is produced at render, so it follows the language. */
type LoadError = "revoked" | "expired" | "missing" | "other";

export default function ShareView() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { scheme, tokens } = useColorTheme();
  const t = useT();
  const router = useRouter();
  const receiveShared = useShareIntentStore((st) => st.receive);
  const [gate, setGate] = useState<Gate>("loading");
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [loadError, setLoadError] = useState<LoadError>("other");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pathId, setPathId] = useState<string | undefined>(undefined);

  const load = useCallback(async (nextPathId?: string) => {
    setGate("loading");
    try {
      const p = await openShare(token!, nextPathId);
      if (p.requiresRecipientVerification) { setPayload(p); setGate("recipient"); return; }
      if (p.requiresPassword) { setPayload(p); setGate("password"); return; }
      setPayload(p);
      setGate("ready");
    } catch (e) {
      // Revoked and expired are different events with different next steps.
      // The old screen printed one sentence for both, and a third for anything
      // else, so "the sender turned this off" and "your connection dropped"
      // read identically.
      const status = (e as { status?: number })?.status;
      const message = e instanceof Error ? e.message : "";
      if (status === 410) {
        setLoadError(/revok/i.test(message) ? "revoked" : "expired");
      } else if (status === 404) {
        setLoadError("missing");
      } else {
        setLoadError("other");
      }
      setGate("error");
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const file: ShareFile | null = payload?.file ?? null;
  const viewOnly = payload?.lockMode === "view_only";
  const isFolder = !!payload?.isFolder;
  const downloadAll = isFolder || payload?.isBundle;

  const title = isFolder
    ? payload?.folder?.current_name ?? t("shared-link.heading.sharedFolder")
    : file?.name ?? t("shared-link.heading.shared");

  /**
   * Copy the shared file into the recipient's own storage.
   *
   * Web can only offer a sign-up link here; in the app the recipient is usually
   * already signed in. The bytes are pulled to the cache first and handed to the
   * existing destination picker through the share-intent store, which is what
   * that screen already consumes - a file:// cache URI is exactly the shape its
   * contract asks for.
   */
  const onSaveToDosya = async () => {
    if (!file) return;
    setSaving(true);
    try {
      const local = await downloadToCache(`${API_BASE_URL}/api/share/${token}/download`, file.name || "download");
      receiveShared([{
        uri: local,
        name: file.name || "download",
        size: file.size_bytes ?? 0,
        mime: file.mime_type ?? "application/octet-stream",
      }]);
      router.push("/save-to");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("shared-link.error.couldNotSaveThatFile"), "error");
    } finally {
      setSaving(false);
    }
  };

  const onDownload = async () => {
    if (!payload) return;
    setBusy(true);
    try {
      const url = downloadAll
        ? `${API_BASE_URL}/api/share/${token}/download-all`
        : `${API_BASE_URL}/api/share/${token}/download`;
      const local = await downloadToCache(url, downloadAll ? `${title}.zip` : (file?.name || "download"));
      await shareFile(local);
    } catch (e) {
      toast(e instanceof Error ? e.message : t("common.error.downloadFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <Stack.Screen options={{ headerShown: true, title: t("shared-link.heading.shared") }} />

      <View className="flex-row items-center gap-2.5 border-b border-border px-4 py-2.5">
        <Text className="text-xs text-foreground" style={{ fontFamily: fonts.mono }}>dosya</Text>
        <View className="flex-1">
          <Text className="text-xs text-foreground" style={{ fontFamily: fonts.bold }} numberOfLines={1}>{title}</Text>
          <Text className="text-[10px] text-muted-foreground" numberOfLines={1}>
            {describeTarget(t, payload, file)}
          </Text>
        </View>
        {/* Two facts the old screen never showed, so nothing on it suggested a
            link was temporary or had been opened before. */}
        {payload?.expiresAt != null ? (
          <Chip icon="time-outline" label={expiryShort({ is_revoked: 0, expires_at: payload.expiresAt, revoked_at: null })} />
        ) : null}
        {payload && payload.viewCount > 0 ? <Chip icon="eye-outline" label={String(payload.viewCount)} /> : null}
      </View>

      {gate === "loading" ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      ) : gate === "error" ? (
        <Centered icon="alert-circle-outline" title={errorCopy(t, loadError).title} body={errorCopy(t, loadError).body} tone="destructive" />
      ) : gate === "recipient" ? (
        <RecipientGate token={token!} onVerified={() => void load(pathId)} />
      ) : gate === "password" ? (
        <PasswordGate token={token!} onUnlocked={() => void load(pathId)} />
      ) : isFolder && payload?.folder ? (
        <FolderBrowser
          payload={payload}
          onOpenFolder={(id) => { setPathId(id); void load(id); }}
        />
      ) : payload?.isBundle && payload.files.length > 1 ? (
        <BundleList files={payload.files} />
      ) : file ? (
        <View className="flex-1" style={{ backgroundColor: "#060b0f" }}>
          <SharePreview
            file={file}
            uri={`${API_BASE_URL}/api/share/${token}/download`}
            scheme={scheme}
            viewOnly={viewOnly}
          />
        </View>
      ) : (
        <Centered icon="document-outline" title={t("shared-link.heading.nothingToShow")} body={t("shared-link.description.thisLinkResolvedToNoFiles")} />
      )}

      {gate === "ready" ? (
        <View className="gap-2 border-t border-border px-4 pb-3 pt-3">
          {viewOnly ? (
            <View className="flex-row gap-2 rounded-lg bg-muted px-3 py-2.5">
              <Icon name="eye-outline" size={14} color={tokens.mutedForeground} style={{ marginTop: 1 }} />
              <Text className="flex-1 text-[11px] leading-4 text-muted-foreground">
                {richText(t("shared-link.description.viewOnlyLeadTheSenderTurnedOffDownloadsForThisLink"), {
                  viewOnlyLead: (
                    <Text className="text-foreground" style={{ fontFamily: fonts.bold }}>{t("shared-link.label.viewOnlyLead")}</Text>
                  ),
                })}
              </Text>
            </View>
          ) : (
            <Button
              title={busy ? t("shared-link.action.preparing") : downloadAll ? t("shared-link.action.downloadAll") : t("common.action.download")}
              onPress={() => void onDownload()}
              loading={busy}
              testID="download-shared"
            />
          )}
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                title={t("common.action.copyLink")}
                variant="ghost"
                testID="copy-share-link"
                onPress={async () => { await Clipboard.setStringAsync(shareUrl(token!)); toast(t("common.label.linkCopied")); }}
              />
            </View>
            {/* Only where it is a real action. A view-only link forbids taking
                the bytes, and a folder or bundle would save a zip rather than
                the files - so the button is absent rather than misleading. */}
            {!viewOnly && file && !downloadAll ? (
              <View className="flex-1">
                <Button title={t("shared-link.action.saveToMyDosya")} variant="ghost" testID="save-to-dosya" loading={saving} onPress={() => void onSaveToDosya()} />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function describeTarget(t: T, payload: SharePayload | null, file: ShareFile | null): string {
  if (!payload) return "";
  if (payload.isFolder) {
    const subs = payload.folder?.subfolders.length ?? 0;
    return t("common.label.countItems", { count: byteCount(payload.files.length + subs) });
  }
  if (payload.isBundle && payload.files.length > 1) return t("common.label.filecountFiles", { fileCount: byteCount(payload.files.length) });
  if (!file) return "";
  const kind = kindLabel(file.mime_type ?? "", file.extension ?? null);
  const hasSize = file.size_bytes != null;
  if (!kind) return hasSize ? formatBytes(file.size_bytes as number) : "";
  return t("shared-link.label.hassizeSelectTrueSizeOtherFileType", {
    hasSize: String(hasSize),
    size: hasSize ? formatBytes(file.size_bytes as number) : "",
    fileType: kind,
  });
}

function errorCopy(t: T, kind: LoadError): { title: string; body: string } {
  switch (kind) {
    case "revoked":
      return { title: t("shared-link.label.thisLinkWasTurnedOff"), body: t("shared-link.description.thePersonWhoSharedItRevokedTheLinkAskThemForANewOne") };
    case "expired":
      return { title: t("shared-link.label.thisLinkHasExpired"), body: t("shared-link.description.shareLinksStopWorkingOnTheDateTheSenderChoseAskThemForA") };
    case "missing":
      return { title: t("shared-link.label.nothingHere"), body: t("shared-link.description.thisLinkDoesNotPointAtAnythingItMayHaveBeenDeleted") };
    default:
      return { title: t("shared-link.error.couldNotOpenThisLink"), body: t("shared-link.description.checkYourConnectionAndTryAgain") };
  }
}

function Chip({ icon, label }: { icon: string; label: string }) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-row items-center gap-1 rounded-full border border-border px-2 py-0.5">
      <Icon name={icon as never} size={10} color={tokens.mutedForeground} />
      <Text className="text-[10px] text-muted-foreground">{label}</Text>
    </View>
  );
}

function Centered({ icon, title, body, tone }: { icon: string; title: string; body: string; tone?: "destructive" }) {
  const { tokens } = useColorTheme();
  return (
    <View className="flex-1 items-center justify-center gap-2 px-10">
      <Icon name={icon as never} size={30} color={tone === "destructive" ? tokens.destructive : tokens.mutedForeground} />
      <Text className="text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>{title}</Text>
      <Text className="text-center text-xs text-muted-foreground">{body}</Text>
    </View>
  );
}

function PasswordGate({ token, onUnlocked }: { token: string; onUnlocked: () => void }) {
  const t = useT();
  const [visible, setVisible] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      {dismissed ? (
        <View className="flex-1 items-center justify-center gap-3 px-10">
          <Icon name="lock-closed-outline" size={30} color="#8a949c" />
          <Text className="text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>
            {t("shared-link.label.thisLinkNeedsAPassword")}
          </Text>
          <Text className="text-center text-xs text-muted-foreground">
            {t("shared-link.description.askThePersonWhoSharedItForThePassword")}
          </Text>
          <View className="w-48">
            <Button title={t("shared-link.action.enterPassword")} onPress={() => { setDismissed(false); setVisible(true); }} />
          </View>
        </View>
      ) : (
        <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>
      )}
      <PromptDialog
        visible={visible}
        title={t("common.heading.passwordRequired")}
        placeholder={t("common.placeholder.password")}
        confirmLabel={t("common.action.unlock")}
        secure
        onCancel={() => { setVisible(false); setDismissed(true); }}
        onSubmit={async (password) => {
          try {
            await unlockShare(token, password);
            setVisible(false);
            onUnlocked();
          } catch (e) {
            toast(e instanceof Error ? e.message : t("common.error.wrongPassword"), "error");
          }
        }}
      />
    </>
  );
}

/**
 * The email-then-code flow for a private link.
 *
 * Mobile called neither endpoint, so a link sent to "only these people" simply
 * could not be opened in the app - the one place the recipient was most likely
 * to tap it, having just received the notification.
 */
function RecipientGate({ token, onVerified }: { token: string; onVerified: () => void }) {
  const t = useT();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    setError(""); setBusy(true);
    try {
      await requestShareCode(token, email);
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shared-link.error.couldNotSendACodeToThatAddress"));
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setError(""); setBusy(true);
    try {
      await verifyShareCode(token, email, code);
      onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("shared-link.error.thatCodeDidNotWork"));
    } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 28, gap: 10 }} keyboardShouldPersistTaps="handled">
      <View className="items-center gap-2">
        <Icon name="shield-checkmark-outline" size={30} color="#8a949c" />
        <Text className="text-center text-base text-foreground" style={{ fontFamily: fonts.bold }}>
          {t("shared-link.label.thisLinkIsForYouOnly")}
        </Text>
        <Text className="text-center text-xs text-muted-foreground">
          {step === "email"
            ? t("shared-link.description.confirmTheAddressItWasSentToAndWeWillEmailYouAOne")
            : t("shared-link.description.enterTheCodeWeSentToEmail", { email })}
        </Text>
      </View>

      {step === "email" ? (
        <>
          <TextField
            value={email}
            onChangeText={setEmail}
            placeholder={t("shared-link.placeholder.youCompanyCom")}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="recipient-email"
          />
          <Button title={t("shared-link.action.sendMeACode")} onPress={() => void send()} loading={busy} testID="send-code" />
        </>
      ) : (
        <>
          <TextField
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            mono
            maxLength={6}
            testID="recipient-code"
          />
          <Button title={t("common.action.verify")} onPress={() => void verify()} loading={busy} testID="verify-code" />
          <Pressable accessibilityRole="button" onPress={() => { setStep("email"); setCode(""); setError(""); }}>
            <Text className="text-center text-xs text-muted-foreground">{t("shared-link.action.useADifferentAddress")}</Text>
          </Pressable>
        </>
      )}

      {error ? <Text className="text-center text-xs text-destructive" testID="recipient-error">{error}</Text> : null}
      <Text className="text-center text-[11px] text-muted-foreground">{t("shared-link.description.noDosyaAccountNeeded")}</Text>
    </ScrollView>
  );
}

function FolderBrowser({ payload, onOpenFolder }: { payload: SharePayload; onOpenFolder: (id: string) => void }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const folder = payload.folder!;

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-1.5 border-b border-border px-4 py-2">
        <Icon name="folder-outline" size={12} color={tokens.mutedForeground} />
        <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
          {folder.breadcrumb.map((b) => b.name).join(" / ") || folder.root_name}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        {folder.subfolders.map((sub) => (
          <Pressable
            key={sub.id}
            testID={`shared-folder-${sub.id}`}
            accessibilityRole="button"
            onPress={() => onOpenFolder(sub.id)}
            className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
          >
            <Icon name="folder" size={18} color={tokens.mutedForeground} />
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>{sub.name}</Text>
            <Icon name="chevron-forward" size={14} color={tokens.mutedForeground} />
          </Pressable>
        ))}
        {payload.files.map((f) => (
          <View key={f.id} className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
            <Icon name="document-outline" size={18} color={tokens.mutedForeground} />
            <View className="flex-1">
              <Text className="text-sm text-foreground" numberOfLines={1}>{f.name}</Text>
              {f.size_bytes != null ? (
                <Text className="text-[10px] text-muted-foreground">{formatBytes(f.size_bytes)}</Text>
              ) : null}
            </View>
          </View>
        ))}
        {folder.subfolders.length === 0 && payload.files.length === 0 ? (
          <Text className="py-10 text-center text-xs text-muted-foreground">{t("shared-link.label.thisFolderIsEmpty")}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function BundleList({ files }: { files: ShareFile[] }) {
  const { tokens } = useColorTheme();
  const t = useT();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
      <Text className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground" style={{ fontFamily: fonts.bold }}>
        {t("shared-link.label.filescountFilesInThisLink", { filesCount: byteCount(files.length) })}
      </Text>
      {files.map((f) => (
        <View key={f.id} className="flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
          <Icon name="document-outline" size={18} color={tokens.mutedForeground} />
          <View className="flex-1">
            <Text className="text-sm text-foreground" numberOfLines={1}>{f.name}</Text>
            {f.size_bytes != null ? (
              <Text className="text-[10px] text-muted-foreground">{formatBytes(f.size_bytes)}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
