import { useRef, useState } from "react";
import { FlatList, Platform, View, useWindowDimensions } from "react-native";
import { useT } from "@/lib/i18n";
import { layoutIsRtl } from "@/lib/direction";
import { pageFromOffset } from "@/viewer/pagerIndex";
import { EncryptedOnPhoneArt, OnlyYouArt, PrivateRoomArt } from "./IntroArt";
import { OnboardingFrame, OnboardingHeading, PrimaryPill, QuietButton } from "./OnboardingFrame";

const SLIDES = ["room", "phone", "key"] as const;
type Slide = (typeof SLIDES)[number];

/**
 * What the Vault is, before anyone is asked for a passphrase: three slides,
 * swiped or stepped through with Next, then into setup.
 *
 * Shown on the first visit to a Vault tab that has no Vault behind it yet.
 * Skip and "Set up Vault" both count as having seen it; "Not now" does not,
 * so someone who backs out meets it again next time rather than a bare form.
 */
export function VaultIntro(props: {
  initialIndex?: number;
  onSetUp: () => void;
  onNotNow: () => void;
}) {
  const t = useT();
  const { width, height } = useWindowDimensions();
  const artHeight = Math.round(Math.min(330, Math.max(210, height * 0.38)));
  const pager = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(props.initialIndex ?? 0);
  const last = index === SLIDES.length - 1;

  const goTo = (next: number) => {
    setIndex(next);
    pager.current?.scrollToIndex({ index: next, animated: true });
  };

  const copy: Record<Slide, { title: string; body: string }> = {
    room: { title: t("vault.heading.aPrivateRoomInsideDosya"), body: t("vault.description.forTheFilesThatShouldOnlyEverBeYoursIdsContractsMedical") },
    phone: { title: t("vault.heading.lockedBeforeItLeavesYourPhone"), body: t("vault.description.eachFileIsEncryptedOnThisPhoneFirstDosyaOnlyEverStores") },
    key: { title: t("vault.heading.onlyYouHoldTheKey"), body: t("vault.description.yourPassphraseNeverLeavesYourDeviceSoNobodyCanResetIt") },
  };

  return (
    <OnboardingFrame
      testID="vault-intro"
      onBack={index > 0 ? () => goTo(index - 1) : undefined}
      endAction={last ? undefined : { label: t("vault.action.skip"), onPress: props.onSetUp, testID: "vault-intro-skip" }}
      footer={
        last ? (
          <>
            <PrimaryPill title={t("vault.action.setUpVault")} onPress={props.onSetUp} testID="vault-intro-setup" />
            <QuietButton title={t("vault.action.notNow")} onPress={props.onNotNow} testID="vault-intro-not-now" />
          </>
        ) : (
          <PrimaryPill title={t("vault.action.next")} onPress={() => goTo(index + 1)} testID="vault-intro-next" />
        )
      }
    >
      <FlatList
        testID="vault-intro-pager"
        ref={pager}
        data={SLIDES}
        keyExtractor={(s) => s}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={props.initialIndex ?? 0}
        getItemLayout={(_d, i) => ({ length: width, offset: width * i, index: i })}
        // Same reading as the file viewer's pager: the reported offset stays
        // left based in RTL, so it has to be turned back into a page.
        onMomentumScrollEnd={(e) =>
          setIndex(
            pageFromOffset(
              // rtl-ok: pager offset (pageFromOffset converts it for RTL)
              e.nativeEvent.contentOffset.x,
              width,
              SLIDES.length,
              { rtl: layoutIsRtl(), platform: Platform.OS === "android" ? "android" : "ios" },
            ),
          )
        }
        renderItem={({ item }) => (
          <View style={{ width }} className="pt-2" testID={`vault-intro-slide-${item}`}>
            {item === "room" ? <PrivateRoomArt height={artHeight} /> : item === "phone" ? <EncryptedOnPhoneArt height={artHeight} /> : <OnlyYouArt height={artHeight} />}
            <View className="mt-11 px-7">
              <OnboardingHeading title={copy[item].title} body={copy[item].body} />
            </View>
          </View>
        )}
      />
      <Dots top={8 + artHeight + 18} index={index} count={SLIDES.length} label={t("vault.accessibility.slideIndexOfCount", { index: index + 1, count: SLIDES.length })} />
    </OnboardingFrame>
  );
}

function Dots(props: { top: number; index: number; count: number; label: string }) {
  return (
    <View
      testID="vault-intro-dots"
      accessible
      accessibilityLabel={props.label}
      className="absolute inset-x-0 flex-row justify-center gap-1.5"
      // Sits between the picture and the heading of whichever slide is showing.
      style={{ top: props.top }}
      pointerEvents="none"
    >
      {Array.from({ length: props.count }, (_, i) => (
        <View key={i} className={"h-2 rounded-full " + (i === props.index ? "w-[22px] bg-primary" : "w-2 bg-border")} />
      ))}
    </View>
  );
}
