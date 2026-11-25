import { useMemo } from "react";
import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { Icon } from "@/ui/Icon";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { documentDir } from "@/lib/text-direction";
import { lineCount } from "@/files/format";
import { parseMarkdown, type InlineToken, type MdBlock } from "../markdown";
import { isSafeExternalUrl } from "@/lib/safeUrl";
import { localDigits } from "@/lib/format-locale";

/**
 * Markdown rendered as the document it is, instead of its source.
 *
 * Same card as TextStage, same app-theme colours - this is content the user
 * reads. The subset matches what parseMarkdown produces; anything fancier in
 * the file arrives as plain paragraph text, which is exactly what the old
 * behaviour was for the whole file.
 */
export function MarkdownStage(props: { text: string | null; mutedColor: string }) {
  const t = useT();
  const blocks = useMemo(() => (props.text == null ? null : parseMarkdown(props.text)), [props.text]);

  return (
    <View className="flex-1 items-center justify-center px-6">
      <View className="max-h-full w-full overflow-hidden rounded-xl border border-border bg-card">
        <View className="flex-row items-center gap-2 border-b border-border px-3 py-2.5">
          <Icon name="logo-markdown" size={13} color={props.mutedColor} />
          <Text className="text-[10px] uppercase text-muted-foreground" style={{ fontFamily: fonts.mono, letterSpacing: 1 }}>
            {t("common.label.markdown")}
          </Text>
          {props.text ? (
            <Text className="ms-auto text-[10px] text-muted-foreground" style={{ fontFamily: fonts.mono }}>
              {t("files.label.linecountLines", { lineCount: localDigits(lineCount(props.text)) })}
            </Text>
          ) : null}
        </View>
        {blocks == null ? (
          <View className="h-40 items-center justify-center">
            <ActivityIndicator color={props.mutedColor} />
          </View>
        ) : (
          <ScrollView testID="markdown-stage-body" nestedScrollEnabled className="max-h-[440px]" style={{ direction: documentDir(props.text ?? "") }} contentContainerClassName="px-4 py-3">
            {blocks.map((block, i) => (
              <Block key={i} block={block} first={i === 0} />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-[17px] font-bold leading-6",
  2: "text-[15px] font-bold leading-5",
  3: "text-[13px] font-bold leading-5",
};

function Block(props: { block: MdBlock; first: boolean }) {
  const { block, first } = props;
  const mt = first ? "" : "mt-2.5";

  if (block.kind === "heading") {
    return (
      <Text className={`${first ? "" : "mt-3"} ${HEADING_CLASS[block.level]} text-foreground`}>
        <Inline tokens={block.inline} />
      </Text>
    );
  }
  if (block.kind === "code") {
    return (
      <View className={`${mt} rounded-lg bg-muted`}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="p-2.5">
          <Text className="text-[11px] leading-4 text-foreground" style={{ fontFamily: fonts.mono }}>
            {block.text}
          </Text>
        </ScrollView>
      </View>
    );
  }
  if (block.kind === "quote") {
    return (
      <View className={`${mt} border-border ps-2.5`} style={{ borderStartWidth: 2 }}>
        <Text className="text-[12.5px] italic leading-5 text-muted-foreground">
          <Inline tokens={block.inline} />
        </Text>
      </View>
    );
  }
  if (block.kind === "list") {
    return (
      <View className={`${mt} gap-1`}>
        {block.items.map((item, i) => (
          <View key={i} className="flex-row">
            <Text className="w-5 text-[12.5px] leading-5 text-muted-foreground">
              {block.ordered ? `${i + 1}.` : "•"}
            </Text>
            <Text className="flex-1 text-[12.5px] leading-5 text-foreground">
              <Inline tokens={item} />
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.kind === "hr") {
    return <View className={`${mt} h-px bg-border`} />;
  }
  return (
    <Text className={`${mt} text-[12.5px] leading-5 text-foreground`}>
      <Inline tokens={block.inline} />
    </Text>
  );
}

/**
 * Inline runs as nested Text, which RN styles cumulatively. Links open in
 * the system browser - the WebView the reader uses for this is overkill for
 * a README's worth of occasional links.
 */
function Inline(props: { tokens: InlineToken[] }) {
  return (
    <>
      {props.tokens.map((t, i) => {
        if (t.kind === "bold") return <Text key={i} className="font-bold">{t.text}</Text>;
        if (t.kind === "italic") return <Text key={i} className="italic">{t.text}</Text>;
        if (t.kind === "code") {
          return (
            <Text key={i} className="text-[11.5px] text-foreground" style={{ fontFamily: fonts.mono }}>
              {t.text}
            </Text>
          );
        }
        if (t.kind === "link") {
          return (
            <Text
              key={i}
              className="text-primary underline"
              accessibilityRole="link"
              onPress={() => {
                if (isSafeExternalUrl(t.url)) void Linking.openURL(t.url);
              }}
            >
              {t.text}
            </Text>
          );
        }
        return <Text key={i}>{t.text}</Text>;
      })}
    </>
  );
}
