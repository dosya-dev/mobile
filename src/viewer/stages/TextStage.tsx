import { useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Icon, type IconName } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { documentDir } from "@/lib/text-direction";
import { useT } from "@/lib/i18n";
import { toast } from "@/ui/toast";
import { useColorTheme } from "@/theme/useColorTheme";
import { kindLabel, splitLines } from "@/files/format";
import { codeTokenColors, languageForExtension, tokenizeLine, type TokenKind } from "../codeHighlight";

/**
 * Roughly the height of the viewer sheet's collapsed content (grabber, name,
 * meta, primary button) - it floats over the stage rather than reserving
 * space in the layout, so the last lines of a long file need this much
 * padding of their own to scroll clear of it.
 */
const SHEET_CLEARANCE = 140;

/**
 * A text or code file, on a card that reads like a page.
 *
 * The type strip along the top carries the two things the old preview never
 * said: what the file is, and how much of it there is, plus a wrap toggle,
 * copy and share for content that's worth acting on, not just glancing at.
 *
 * The card follows the app theme rather than the stage, because this is the
 * one stage whose content is text the user actually reads - which is also
 * why syntax-highlight colours are tuned for both a light and a dark card
 * instead of pinning the card to one fixed "editor" background.
 */
export function TextStage(props: {
  text: string | null;
  mimeType: string;
  extension: string | null;
  mutedColor: string;
}) {
  const t = useT();
  const { scheme, tokens } = useColorTheme();
  const [wrap, setWrap] = useState(false);

  const renderLines = useMemo(() => (props.text == null ? [] : splitLines(props.text)), [props.text]);
  const lang = useMemo(() => languageForExtension(props.extension), [props.extension]);
  const tokenColors = useMemo(() => codeTokenColors(scheme), [scheme]);
  const gutterWidth = Math.max(20, String(renderLines.length).length * 7 + 10);

  const onCopy = async () => {
    await Clipboard.setStringAsync(props.text ?? "");
    toast(t("files.status.copiedToClipboard"));
  };
  const onShare = () => {
    void Share.share({ message: props.text ?? "" });
  };

  const lineNodes = renderLines.map((line, i) => (
    <View key={i} className="flex-row">
      <Text
        className="pe-2 text-right text-[10.5px] text-muted-foreground"
        style={{ fontFamily: fonts.mono, lineHeight: 20, width: gutterWidth }}
      >
        {i + 1}
      </Text>
      <Text
        className={`text-[11px] leading-5 text-foreground ${wrap ? "flex-1" : ""}`}
        style={{ fontFamily: fonts.mono }}
      >
        {renderTokens(line, lang, tokenColors)}
      </Text>
    </View>
  ));

  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="h-full w-full overflow-hidden rounded-xl border border-border bg-card">
        <View className="flex-row items-center gap-2 border-b border-border px-3 py-2">
          <Icon name="document-text-outline" size={13} color={props.mutedColor} />
          <Text className="text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1 }}>
            {kindLabel(props.mimeType, props.extension)}
          </Text>
          <View className="ms-auto flex-row items-center gap-0.5">
            {renderLines.length > 0 ? (
              <>
                <Text className="me-1.5 text-[10px] text-muted-foreground" style={{ fontFamily: fonts.mono }}>
                  {t("files.label.renderlinescountPluralOneLineOtherLines", { renderLinesCount: renderLines.length })}
                </Text>
                <ToolbarButton
                  testID="text-stage-wrap"
                  icon="reorder-four-outline"
                  label={wrap ? t("files.label.turnOffLineWrap") : t("files.label.wrapLongLines")}
                  active={wrap}
                  color={props.mutedColor}
                  activeColor={tokens.primary}
                  onPress={() => setWrap((w) => !w)}
                />
                <ToolbarButton
                  testID="text-stage-copy"
                  icon="copy-outline"
                  label={t("common.copy")}
                  color={props.mutedColor}
                  activeColor={tokens.primary}
                  onPress={onCopy}
                />
                <ToolbarButton
                  testID="text-stage-share"
                  icon="share-outline"
                  label={t("common.action.share")}
                  color={props.mutedColor}
                  activeColor={tokens.primary}
                  onPress={onShare}
                />
              </>
            ) : null}
          </View>
        </View>
        {props.text == null ? (
          <View className="h-40 items-center justify-center">
            <ActivityIndicator color={props.mutedColor} />
          </View>
        ) : (
          <ScrollView
            testID="text-stage-body"
            nestedScrollEnabled
            className="flex-1"
            style={{ direction: documentDir(props.text ?? "") }}
            contentContainerStyle={{ paddingBottom: SHEET_CLEARANCE }}
          >
            {wrap ? (
              <View className="px-3 py-2.5">{lineNodes}</View>
            ) : (
              <ScrollView
                testID="text-stage-hscroll"
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingEnd: 16 }}
              >
                <View className="px-3 py-2.5">{lineNodes}</View>
              </ScrollView>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function renderTokens(line: string, lang: ReturnType<typeof languageForExtension>, palette: Record<TokenKind, string>): ReactNode {
  if (lang === "plain" || line === "") return line;
  return tokenizeLine(line, lang).map((t, i) =>
    t.kind === "plain" ? t.text : (
      <Text key={i} style={{ color: palette[t.kind], fontFamily: fonts.mono }}>
        {t.text}
      </Text>
    ),
  );
}

function ToolbarButton(props: {
  testID: string;
  icon: IconName;
  label: string;
  color: string;
  activeColor: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.active }}
      hitSlop={8}
      className="rounded-md p-1.5"
      onPress={props.onPress}
    >
      <Icon name={props.icon} size={14} color={props.active ? props.activeColor : props.color} />
    </Pressable>
  );
}
