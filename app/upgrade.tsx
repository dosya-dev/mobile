import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/auth/authStore";
import { track } from "@/analytics/analytics";
import { useT } from "@/lib/i18n";
import { ELIGIBILITY_KEY, STORE_STATUS_KEY, useCatalogPlans, useEligibility, useOfferings, useStoreStatus } from "@/billing/hooks";
import { runPurchase, runRestore, type FlowState } from "@/billing/purchaseFlow";
import { ActivationSheet } from "@/billing/ActivationSheet";
import { CodeSheet } from "@/billing/CodeSheet";
import { buildPaywallRows, defaultTierIndex, intervalFor, notEligibleKey, productToPlan, type Interval } from "@/billing/paywallModel";
import { PlanHero } from "@/billing/PlanHero";
import { TierPicker } from "@/billing/TierPicker";
import { WhatYouGet } from "@/billing/WhatYouGet";
import { formatBytes } from "@/lib/format";
import { Segmented } from "@/share/controls";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const THIS_STORE = Platform.OS === "android" ? "Google Play" : "App Store";
const OTHER_STORE = Platform.OS === "android" ? "App Store" : "Google Play";
const THIS_PROVIDER = Platform.OS === "android" ? "google" : "apple";

/**
 * In-app upgrade (store billing). The store decides prices: every amount on
 * this screen is RevenueCat's priceString; the catalog only names the plans.
 * The purchase button appears only when the server says this account may buy
 * here, it does not already subscribe through this platform's store, and both
 * the catalog and the store answered. What happens after
 * Continue or Restore lives in purchaseFlow.ts; ActivationSheet shows it.
 */
export default function UpgradeScreen() {
  const t = useT();
  const router = useRouter();
  const eligibility = useEligibility();
  const catalog = useCatalogPlans();
  const offerings = useOfferings();
  const storeStatus = useStoreStatus();
  const [interval, setBillingInterval] = useState<Interval>("year");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<{ state: FlowState; detail?: string }>({ state: "idle" });
  // The paywall was opened. Once per visit to this screen.
  useEffect(() => { track("paywall_view"); }, []);
  const [restoring, setRestoring] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  // The plan Continue bought, fixed at the tap: the success sheet names it
  // even if the selection were to change before activation lands.
  const [purchasedName, setPurchasedName] = useState<string | null>(null);
  const busy = restoring || flow.state === "paying" || flow.state === "confirming";
  // Set before the first await, so a second tap that lands before React
  // re-renders (and before `busy` turns true) starts nothing.
  const inFlight = useRef(false);
  const once = (run: () => Promise<void>, onSettled?: () => void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    void run().finally(() => {
      inFlight.current = false;
      onSettled?.();
    });
  };
  const setFlowState = useCallback(
    (state: FlowState, detail?: string) => {
      setFlow({ state, detail });
      if (state === "active") {
        // The plan is confirmed by our server. Counted as a result, without
        // the plan or the price; the store is the platform's own.
        track("purchase_complete", { store: Platform.OS === "ios" ? "app_store" : "play" });
        // ME_KEY is invalidated by awaitPlanActivation.
        void queryClient.invalidateQueries({ queryKey: ELIGIBILITY_KEY });
        void queryClient.invalidateQueries({ queryKey: STORE_STATUS_KEY });
      }
    },
    [queryClient],
  );

  const rows = useMemo(
    () => buildPaywallRows(catalog.data ?? [], offerings.data ?? [], productToPlan),
    [catalog.data, offerings.data],
  );
  // One tier at a time. A tier the store sells only one way shows that
  // period, whatever the switch last asked for; switching keeps the tier.
  const selectedRow = rows.find((r) => r.planId === selectedId) ?? rows[defaultTierIndex(rows)];
  const shownInterval = selectedRow ? intervalFor(selectedRow, interval) : interval;
  const selectedPkg = selectedRow ? (shownInterval === "month" ? selectedRow.monthly : selectedRow.yearly) : undefined;
  const selected = selectedRow && selectedPkg ? { row: selectedRow, pkg: selectedPkg } : undefined;
  const currentPlanStorage = (() => {
    const id = eligibility.data?.current_plan.id;
    const plan = id ? catalog.data?.find((p) => p.id === id) : undefined;
    return plan ? (plan.storage_label ?? formatBytes(plan.storage_bytes)) : null;
  })();

  const restorePurchases = () => {
    if (!eligibility.data || busy || inFlight.current) return;
    const currentPlanId = eligibility.data.current_plan.id;
    setRestoring(true);
    setPurchasedName(null);
    once(() => runRestore(currentPlanId, userId, setFlowState), () => setRestoring(false));
  };

  const purchaseSelected = () => {
    if (!selected || busy || inFlight.current) return;
    setPurchasedName(selected.row.name);
    once(() => runPurchase(selected.pkg, selected.row.planId, userId, setFlowState));
  };

  const retry = () => {
    void eligibility.refetch();
    void storeStatus.refetch();
    void catalog.refetch();
    void offerings.refetch();
  };

  const restoreButton = (
    <Button testID="upgrade-restore" variant="ghost" loading={restoring} disabled={busy} title={t("upgrade.action.restorePurchases")} onPress={restorePurchases} />
  );
  const sameStore = storeStatus.data?.provider === THIS_PROVIDER ? storeStatus.data : null;

  let body: ReactNode;
  if (eligibility.isError || storeStatus.isError) {
    body = <LoadError onRetry={retry} />;
  } else if (!eligibility.data || storeStatus.isPending) {
    body = <Loading />;
  } else if (sameStore) {
    // Already subscribed through this store: a second purchase here would be a
    // second subscription, so changes and cancelling go through the store.
    const manageUrl = sameStore.manage_url;
    body = (
      <View className="pt-4">
        <Text className="mb-2 text-base text-foreground">{t("upgrade.label.currentPlan", { plan: eligibility.data.current_plan.name })}</Text>
        <Text className="mb-4 text-sm text-muted-foreground">{t("upgrade.label.managedInThisStore", { store: THIS_STORE })}</Text>
        <Button testID="upgrade-manage" title={t("upgrade.action.manageSubscription")} onPress={() => void Linking.openURL(manageUrl).catch(() => {})} />
        <View className="mt-2 flex-row justify-center">{restoreButton}</View>
      </View>
    );
  } else if (!eligibility.data.can_purchase) {
    const { reason, current_plan } = eligibility.data;
    body = (
      <View className="pt-4">
        <Text className="mb-2 text-base text-foreground">{t("upgrade.label.currentPlan", { plan: current_plan.name })}</Text>
        <Text className="text-sm text-muted-foreground">{t(notEligibleKey(reason), { store: OTHER_STORE })}</Text>
      </View>
    );
  } else if (catalog.isError || offerings.isError) {
    body = <LoadError onRetry={retry} />;
  } else if (!catalog.data || !offerings.data) {
    body = <Loading />;
  } else if (rows.length === 0) {
    // Also covers a store that returned no packages (fetchOfferings swallows errors).
    body = <LoadError onRetry={retry} />;
  } else {
    const index = Math.max(0, rows.findIndex((r) => r.planId === selectedRow?.planId));
    body = (
      <>
        {selected ? (
          <PlanHero
            planId={selected.row.planId}
            storageLabel={selected.row.storageLabel}
            pkg={selected.pkg}
            interval={shownInterval}
            savingPct={shownInterval === "year" ? selected.row.yearlySavingPct : null}
          />
        ) : null}
        <TierPicker tiers={rows} index={index} disabled={busy} onChange={(i) => setSelectedId(rows[i]!.planId)} />
        <View className="mt-4">
          <Segmented
            testID="upgrade-interval"
            disabled={busy}
            value={shownInterval}
            onChange={(k) => setBillingInterval(k as Interval)}
            options={[
              { key: "month", label: t("upgrade.label.monthly") },
              { key: "year", label: t("upgrade.label.yearly") },
            ]}
          />
        </View>
        {selected ? (
          <View className="mt-4">
            <WhatYouGet row={selected.row} />
          </View>
        ) : null}
        {selected ? (
          <View className="mt-4">
            <Button
              testID="upgrade-continue"
              variant="brand"
              title={t("upgrade.action.continueToStore", { store: THIS_STORE })}
              loading={busy}
              onPress={purchaseSelected}
            />
            <Text testID="upgrade-current-plan" className="mt-2 text-center text-xs text-muted-foreground">
              {currentPlanStorage
                ? t("upgrade.label.currentPlanWithStorage", { plan: eligibility.data.current_plan.name, storage: currentPlanStorage })
                : t("upgrade.label.currentPlan", { plan: eligibility.data.current_plan.name })}
            </Text>
          </View>
        ) : null}
        <View className="mt-1 flex-row justify-center">
          {restoreButton}
          <Button testID="upgrade-have-code" variant="ghost" disabled={busy} title={t("upgrade.action.haveACode")} onPress={() => setCodeOpen(true)} />
        </View>
        <Text testID="upgrade-legal" className="mt-1 text-center text-xs text-muted-foreground">
          {t("upgrade.label.legal", { store: THIS_STORE })} {t("upgrade.label.cancelAnytime", { store: THIS_STORE })}
        </Text>
        <View className="mt-2 flex-row justify-center gap-4">
          <Text testID="upgrade-terms" className="text-xs text-foreground underline" onPress={() => router.push("/terms")}>
            {t("legal.heading.termsOfService")}
          </Text>
          <Text testID="upgrade-privacy" className="text-xs text-foreground underline" onPress={() => router.push("/privacy")}>
            {t("legal.heading.privacyPolicy")}
          </Text>
        </View>
      </>
    );
  }

  return (
    <Screen underNativeHeader>
      <ScrollView contentContainerClassName="pb-6">{body}</ScrollView>
      <CodeSheet
        visible={codeOpen}
        storeName={THIS_STORE}
        currentPlanId={eligibility.data?.current_plan.id ?? ""}
        onClose={() => setCodeOpen(false)}
        onRestore={restorePurchases}
        onPurchase={purchaseSelected}
        onPlanChanged={(planName) => setFlow({ state: "active", detail: planName })}
      />
      <ActivationSheet
        state={flow.state}
        detail={flow.detail}
        planName={flow.detail ?? purchasedName ?? selected?.row.name}
        onClose={() => setFlow({ state: "idle" })}
        onDone={() => {
          setFlow({ state: "idle" });
          router.back();
        }}
        restoring={restoring}
        onRestore={restorePurchases}
        onOpen={(route) => router.push(route)}
      />
    </Screen>
  );
}

function Loading() {
  return (
    <View className="items-center pt-10">
      <ActivityIndicator />
    </View>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <View className="items-center pt-10">
      <Text className="mb-4 text-center text-sm text-muted-foreground">{t("upgrade.error.couldNotLoad")}</Text>
      <Button testID="upgrade-retry" title={t("upgrade.action.retry")} onPress={onRetry} />
    </View>
  );
}
