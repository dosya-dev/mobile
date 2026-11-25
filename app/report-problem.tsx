import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Device from "expo-device";
import * as Application from "expo-application";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/toast";
import { useT } from "@/lib/i18n";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { getDisplayVersion } from "@/lib/appVersion";
import { countByStatus } from "@/backup/ledger";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { collectMobileDiagnostics, diagnosticsRows, type MobileFacts } from "@/support/diagnostics";
import { createBugReport, BUG_REPORT_IMAGE_TYPES, BUG_REPORT_IMAGE_MAX_BYTES, type BugReportImage } from "@/support/api";
import { EXTENSION_FOR_TYPE, resolveImageType } from "@/support/imageTypes";
import { localDigits } from "@/lib/format-locale";
import { inputStartAlign } from "@/lib/direction";

/** The API refuses longer messages. */
const TEXT_MAX = 10_000;
/** The API accepts at most three images per message. */
const MAX_IMAGES = 3;

function currentLocale(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().locale || null; } catch { return null; }
}

/**
 * Report a problem (spec: direction B's form, A's destination). Pushed from
 * Profile, from the failed-backup screen, from the activity feed and, via
 * reportStore, from the error boundary. Params carry the prefill; the device
 * facts are read here and shown before Send.
 */
export default function ReportProblemScreen() {
  const t = useT();
  const { tokens } = useColorTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string; errorRef?: string; errorMessage?: string }>();
  const activeId = useWorkspaceStore((s) => s.activeId);

  const [text, setText] = useState("");
  const [include, setInclude] = useState(true);
  const [images, setImages] = useState<BugReportImage[]>([]);
  const [sending, setSending] = useState(false);
  const [backup, setBackup] = useState<{ error: number; skipped: number } | null>(null);

  useEffect(() => {
    let alive = true;
    countByStatus(activeId)
      .then((c) => { if (alive) setBackup({ error: c.error, skipped: c.skipped_large }); })
      .catch(() => { if (alive) setBackup(null); });
    return () => { alive = false; };
  }, [activeId]);

  const facts: MobileFacts = useMemo(() => ({
    displayVersion: getDisplayVersion(),
    build: Application.nativeBuildVersion ?? null,
    osName: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion ?? null,
    model: Device.modelName ?? null,
    locale: currentLocale(),
    workspaceId: activeId,
    backup,
  }), [activeId, backup]);

  const diagnostics = useMemo(() => collectMobileDiagnostics(facts, {
    page: params.from ?? null, errorRef: params.errorRef ?? null, errorMessage: params.errorMessage ?? null,
  }), [facts, params.from, params.errorRef, params.errorMessage]);
  const rows = useMemo(() => diagnosticsRows(diagnostics, backup, t), [diagnostics, backup, t]);

  const addScreenshots = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast(t("report-problem.error.allowPhotoAccessToAttachAScreenshot"), "error"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: MAX_IMAGES - images.length,
      // The server accepts only PNG/JPEG/WebP/GIF - without this iOS can hand
      // back a HEIC original (or a ProRAW/HDR variant) that always fails.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (res.canceled) return;
    const kept: BugReportImage[] = [];
    let named = images.length;
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
      named += 1;
      const name = a.fileName ?? `screenshot-${named}.${EXTENSION_FOR_TYPE[type] ?? "jpg"}`;
      kept.push({ uri: a.uri, name, type });
    }
    setImages((prev) => [...prev, ...kept].slice(0, MAX_IMAGES));
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await createBugReport({
        body: body.slice(0, TEXT_MAX),
        workspaceId: activeId,
        diagnostics: include ? JSON.stringify(diagnostics) : null,
        images,
      });
      toast(t("report-problem.status.reportSentWeReplyAtYourAccountEmail"));
      router.back();
    } catch (e) {
      toast(
        t("report-problem.error.couldNotSendHasErrorSelectTrueErrorOtherPleaseTryAgain", {
          hasError: String(e instanceof Error),
          error: e instanceof Error ? e.message : "",
        }),
        "error",
      );
      setSending(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: t("common.heading.reportAProblem"), headerShown: true }} />
      <ScrollView contentContainerClassName="px-5 py-4 gap-4" keyboardShouldPersistTaps="handled">
        <Text className="text-sm text-muted-foreground">
          {t("report-problem.description.oneOrTwoSentencesIsEnoughTheDetailsBelowTravelWithItAndWe")}
        </Text>

        <TextInput
          testID="report-text"
          value={text}
          onChangeText={setText}
          placeholder={t("report-problem.placeholder.whatWentWrongWhatDidYouExpectInstead")}
          placeholderTextColor={tokens.mutedForeground}
          multiline
          maxLength={TEXT_MAX}
          editable={!sending}
          accessibilityLabel={t("report-problem.accessibility.whatWentWrong")}
          className="min-h-28 rounded-xl border border-border bg-card px-3 py-2 text-base text-foreground"
          style={{ fontFamily: fonts.regular, textAlignVertical: "top", ...inputStartAlign() }}
        />

        <View className="gap-2">
          <Button
            testID="report-add-screenshot"
            title={images.length >= MAX_IMAGES ? t("report-problem.action.maximagesScreenshotsAttached", { maxImages: localDigits(MAX_IMAGES) }) : t("report-problem.action.addScreenshot")}
            variant="ghost"
            disabled={sending || images.length >= MAX_IMAGES}
            onPress={addScreenshots}
          />
          {images.map((img, i) => (
            <View key={`${img.uri}-${i}`} className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={1}>{img.name}</Text>
              <Pressable
                testID={`remove-image-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t("common.accessibility.removeMName", { mName: img.name })}
                hitSlop={8}
                disabled={sending}
                onPress={() => removeImage(i)}
              >
                <Text className="text-xs text-destructive">{t("common.remove")}</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View className="rounded-xl border border-border bg-secondary p-3 gap-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Icon name="alert-circle" size={16} color={tokens.mutedForeground} />
              <Text className="text-sm text-foreground" style={{ fontFamily: fonts.medium }}>{t("report-problem.label.diagnostics")}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-muted-foreground">{t("report-problem.label.include")}</Text>
              <Checkbox
                testID="include-diagnostics"
                checked={include}
                onChange={setInclude}
                accessibilityLabel={t("report-problem.label.includeDiagnostics")}
              />
            </View>
          </View>
          {rows.map((r, i) => (
            <View key={`${i}-${r.label}`} className="flex-row justify-between gap-3 border-t border-border py-1.5">
              <Text className="text-xs text-muted-foreground">{r.label}</Text>
              <Text className="flex-1 text-right text-xs text-foreground" style={{ fontFamily: fonts.mono ?? fonts.regular }}>{r.value}</Text>
            </View>
          ))}
          <Text className="text-xs text-muted-foreground">{t("report-problem.description.nothingFromYourPhotosOrFilesIsIncludedInTheseDetails")}</Text>
        </View>

        <Button testID="report-send" title={t("report-problem.action.sendReport")} onPress={send} loading={sending} disabled={!text.trim()} />
      </ScrollView>
    </View>
  );
}
