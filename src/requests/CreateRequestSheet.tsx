import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { useColorTheme } from "@/theme/useColorTheme";
import { useSheetBottomPad } from "@/ui/sheetInsets";
import { useT } from "@/lib/i18n";
import { parseEmails, validatePassword } from "./status";
import { localDigits } from "@/lib/format-locale";

export interface CreateRequestValues {
  title: string;
  message: string;
  expiryDays: string;
  maxFiles: string;
  maxFileSizeMb: string;
  allowedExtensions: string;
  password: string;
  emails: string[];
}

const EMPTY: CreateRequestValues = {
  title: "", message: "", expiryDays: "7", maxFiles: "",
  maxFileSizeMb: "", allowedExtensions: "", password: "", emails: [],
};

/**
 * The create form.
 *
 * Values live here and are cleared only by the caller, on success: a failed
 * create must not cost someone the eight fields they just filled in.
 *
 * The password floor is checked before the mutation rather than after. The
 * server's 400 would arrive with the sheet already dismissed, which reads as the
 * request having been made.
 *
 * Emails are chips rather than a free-text field, so a typo is visible before the
 * invite goes out instead of after. Pasting a whole list works, because people
 * paste lists.
 */
export function CreateRequestSheet(props: {
  visible: boolean;
  busy: boolean;
  resultUrl: string | null;
  onSubmit: (v: CreateRequestValues) => void;
  onClose: () => void;
  onCopyResult: () => void;
}) {
  const t = useT();
  const { tokens } = useColorTheme();
  const sheetPad = useSheetBottomPad();
  const [v, setV] = useState<CreateRequestValues>(EMPTY);
  const [emailDraft, setEmailDraft] = useState("");
  // Whether the password failed its check; the message is produced at render so a
  // language switch reaches it (typing clears the flag, so the text stays current).
  const [pwBad, setPwBad] = useState(false);

  const set = <K extends keyof CreateRequestValues>(key: K, value: CreateRequestValues[K]) =>
    setV((prev) => ({ ...prev, [key]: value }));

  const addEmails = () => {
    const parsed = parseEmails(emailDraft);
    if (!parsed.length) return;
    setV((prev) => ({ ...prev, emails: [...new Set([...prev.emails, ...parsed])] }));
    setEmailDraft("");
  };

  const submit = () => {
    const problem = validatePassword(v.password) !== null;
    setPwBad(problem);
    if (problem) return;
    props.onSubmit(v);
  };

  const close = () => {
    setV(EMPTY);
    setEmailDraft("");
    setPwBad(false);
    props.onClose();
  };

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/50">
        {/* A Modal renders in its own window, outside the screen's SafeAreaView -
            the bottom inset has to be asked for here or the submit button sits
            behind Android's three-button navigation bar. */}
        <View testID="create-sheet-panel" className="max-h-[88%] rounded-t-[22px] bg-card px-5 pt-5" style={{ paddingBottom: sheetPad }}>
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg text-foreground" style={{ fontFamily: fonts.medium }}>
              {t("file-requests.label.newFileRequest")}
            </Text>
            <Pressable
              testID="create-cancel"
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              hitSlop={10}
              onPress={close}
            >
              <Icon name="close" size={20} color={tokens.mutedForeground} />
            </Pressable>
          </View>

          {props.resultUrl ? (
            <View className="items-center py-4">
              <Icon name="checkmark-circle" size={34} color={tokens.primary} />
              <Text className="mt-2 text-base text-foreground" style={{ fontFamily: fonts.medium }}>
                {t("file-requests.status.requestCreated")}
              </Text>
              <Text
                testID="create-result-url"
                className="mt-2 text-center text-xs text-muted-foreground"
                style={{ fontFamily: fonts.mono }}
                numberOfLines={2}
              >
                {props.resultUrl}
              </Text>
              <View className="mt-5 w-full flex-row gap-3">
                <View className="flex-1">
                  <Button title={t("common.action.copyLink")} onPress={props.onCopyResult} testID="create-copy" />
                </View>
                <View className="flex-1">
                  <Button title={t("common.done")} variant="ghost" onPress={close} testID="create-done" />
                </View>
              </View>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextField
                label={t("file-requests.label.title")}
                value={v.title}
                onChangeText={(text) => set("title", text)}
                placeholder={t("file-requests.placeholder.eGBrandAssetsForQ2")}
                autoCapitalize="sentences"
                testID="create-title"
              />
              <TextField
                label={t("common.label.messageOptional")}
                value={v.message}
                onChangeText={(text) => set("message", text)}
                placeholder={t("file-requests.placeholder.anyInstructionsForWhoeverUploads")}
                autoCapitalize="sentences"
                testID="create-message"
              />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <TextField
                    label={t("file-requests.label.expiresInDays")}
                    value={v.expiryDays}
                    onChangeText={(text) => set("expiryDays", text.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    placeholder={t("file-requests.placeholder.never")}
                    testID="create-expiry"
                  />
                </View>
                <View className="flex-1">
                  <TextField
                    label={t("file-requests.label.maxFiles")}
                    value={v.maxFiles}
                    onChangeText={(text) => set("maxFiles", text.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    placeholder={t("common.placeholder.unlimited")}
                    testID="create-max-files"
                  />
                </View>
              </View>

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <TextField
                    label={t("file-requests.label.maxSizeMB")}
                    value={v.maxFileSizeMb}
                    onChangeText={(text) => set("maxFileSizeMb", text.replace(/[^0-9]/g, ""))}
                    keyboardType="number-pad"
                    placeholder={t("file-requests.placeholder.noLimit")}
                    testID="create-max-size"
                  />
                </View>
                <View className="flex-1">
                  <TextField
                    label={t("file-requests.label.allowedTypes")}
                    value={v.allowedExtensions}
                    onChangeText={(text) => set("allowedExtensions", text)}
                    autoCapitalize="none"
                    placeholder={t("file-requests.placeholder.jpgPdf")}
                    testID="create-extensions"
                  />
                </View>
              </View>

              <TextField
                label={t("sharing.label.passwordOptional")}
                value={v.password}
                onChangeText={(text) => { set("password", text); if (pwBad) setPwBad(false); }}
                secureTextEntry
                autoCapitalize="none"
                placeholder={t("common.placeholder.atLeast8Characters")}
                testID="create-password"
              />
              {pwBad ? (
                <Text testID="create-password-error" className="-mt-2 mb-3 text-xs text-destructive">
                  {validatePassword(v.password)}
                </Text>
              ) : null}

              <Text className="mb-1 text-sm text-foreground" style={{ fontFamily: fonts.medium }}>
                {t("file-requests.label.inviteByEmailOptional")}
              </Text>
              <View className="mb-2 flex-row items-start gap-2">
                <View className="flex-1">
                  <TextField
                    value={emailDraft}
                    onChangeText={setEmailDraft}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholder={t("common.placeholder.nameExampleCom")}
                    testID="create-emails"
                  />
                </View>
                <Pressable
                  testID="create-email-add"
                  accessibilityRole="button"
                  accessibilityLabel={t("file-requests.action.addRecipient")}
                  onPress={addEmails}
                  className="h-[46px] w-[46px] items-center justify-center rounded-lg bg-secondary"
                >
                  <Icon name="add" size={20} color={tokens.foreground} />
                </Pressable>
              </View>
              {v.emails.length ? (
                <View className="mb-3 flex-row flex-wrap gap-2">
                  {v.emails.map((email) => (
                    <View
                      key={email}
                      testID={`create-email-${email}`}
                      className="flex-row items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1"
                    >
                      <Text className="text-xs text-foreground">{email}</Text>
                      <Pressable
                        testID={`create-email-remove-${email}`}
                        accessibilityRole="button"
                        accessibilityLabel={t("common.accessibility.removeMName", { mName: email })}
                        hitSlop={8}
                        onPress={() => set("emails", v.emails.filter((e) => e !== email))}
                      >
                        <Icon name="close" size={12} color={tokens.mutedForeground} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}

              <View className="mt-2">
                <Button
                  title={v.emails.length ? t("file-requests.action.createAndInviteEmailsCount", { emailsCount: localDigits(v.emails.length) }) : t("file-requests.action.createRequest")}
                  onPress={submit}
                  loading={props.busy}
                  testID="create-submit"
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
