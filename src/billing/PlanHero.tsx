import { useEffect, useRef } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import type { PurchasesPackage } from "react-native-purchases";
import { useT } from "@/lib/i18n";
import { Text } from "@/ui/Text";
import { fonts } from "@/theme/fonts";
import { perMonthEquivalent, type Interval } from "./paywallModel";

/**
 * The chosen tier's size and the store's price for the chosen period. The
 * price and its period sit on one line; on yearly the full yearly price is
 * the figure, the per-month equivalent only a muted "≈" line under it.
 * Every amount comes from the store, never the catalog.
 */
export function PlanHero(props: {
  planId: string;
  storageLabel: string;
  pkg: PurchasesPackage;
  interval: Interval;
  savingPct: number | null;
}) {
  const t = useT();
  const { planId, storageLabel, pkg, interval, savingPct } = props;
  const perMonth = interval === "year" ? perMonthEquivalent(pkg.product.price, pkg.product.currencyCode) : null;
  const motion = useSwapMotion(`${planId}:${interval}`);

  return (
    <View testID="plan-hero" className="pb-4 pt-2">
      <Text className="text-xs uppercase text-muted-foreground" style={{ letterSpacing: 1.5, fontFamily: fonts.medium }}>
        {t("upgrade.label.yourSpace")}
      </Text>
      <Animated.View style={motion}>
        <Text testID="plan-hero-storage" className="text-foreground" style={{ fontFamily: fonts.bold, fontSize: 44, lineHeight: 52 }}>
          {storageLabel}
        </Text>
        <View testID="plan-hero-price" className="flex-row items-baseline gap-1.5">
          <Text className="text-foreground" style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 }}>
            {pkg.product.priceString}
          </Text>
          <Text className="text-base text-muted-foreground">
            {interval === "month" ? t("upgrade.label.perMonth") : t("upgrade.label.perYear")}
          </Text>
        </View>
        {/* Fixed height so switching period never moves the controls below. */}
        <View className="mt-1.5 flex-row items-center gap-2" style={{ minHeight: 22 }}>
          {interval === "year" && savingPct !== null ? (
            <View testID="plan-hero-saving" className="rounded-full bg-brand px-2 py-0.5">
              <Text className="text-xs text-brand-foreground" style={{ fontFamily: fonts.medium }}>
                {t("upgrade.label.savePctVsMonthly", { pct: savingPct })}
              </Text>
            </View>
          ) : null}
          {perMonth ? (
            <Text testID="plan-hero-per-month" className="text-xs text-muted-foreground">
              {t("upgrade.label.approxPerMonth", { price: perMonth })}
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * A short fade and rise whenever `key` changes; none on first render and none
 * when the system asks for reduced motion. A ref, not state: learning the
 * setting must not re-render the screen.
 */
function useSwapMotion(key: string) {
  const opacity = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);
  const lastKey = useRef(key);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((on) => {
        if (alive) reduceMotion.current = on;
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (on: boolean) => {
      reduceMotion.current = on;
    });
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    if (reduceMotion.current) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    opacity.setValue(0.2);
    translateY.setValue(6);
    const run = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [key, opacity, translateY]);

  return { opacity, transform: [{ translateY }] };
}
