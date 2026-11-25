import { View } from "react-native";
import { Text } from "@/ui/Text";
import { useT } from "@/lib/i18n";
import { fonts } from "@/theme/fonts";
import { contactView, type RawCard } from "@/contacts/vcardFile";
import { localDigits } from "@/lib/format-locale";

/** How many cards the peek shows before it stops. Enough to recognise the file by. */
const PEEK = 4;

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/**
 * A peek at the address book, rather than a count of it.
 *
 * "186 contacts" tells you the size of the file and nothing about which file it
 * is. Four real names do, which matters when an account holds several .vcf
 * backups taken months apart with identical names.
 *
 * The cards are display-only. Reading, searching and editing all live on the
 * contacts route, which the primary action opens.
 */
export function ContactsStage(props: { cards: RawCard[]; total: number }) {
  const t = useT();
  const peek = props.cards.slice(0, PEEK).map(contactView);
  const rest = Math.max(0, props.total - peek.length);

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="w-full gap-2">
        {peek.map((c, i) => (
          <View
            key={`${c.displayName}-${i}`}
            testID={`contact-peek-${i}`}
            className="flex-row items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3"
          >
            <View className="h-9 w-9 items-center justify-center rounded-full bg-primary">
              <Text className="text-[13px] font-bold text-primary-foreground">{initialsOf(c.displayName)}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                {c.displayName}
              </Text>
              <Text
                className="text-[10.5px] text-muted-foreground"
                numberOfLines={1}
                style={{ fontFamily: fonts.mono }}
              >
                {c.phones[0]?.value || c.emails[0]?.value || c.org || t("files.label.noNumber")}
              </Text>
            </View>
          </View>
        ))}
        {rest > 0 ? (
          <Text testID="contact-peek-rest" className="mt-1 text-center text-xs text-muted-foreground">
            {t("files.label.andRestMore", { rest: localDigits(rest) })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
