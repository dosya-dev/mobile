import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/ui/Screen";
import { Section } from "@/ui/Section";
import { SettingsRow } from "@/ui/SettingsRow";
import { Button } from "@/ui/Button";
import { PromptDialog } from "@/ui/PromptDialog";
import { Text } from "@/ui/Text";
import { WorkspaceHeader } from "@/files/WorkspaceHeader";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useAuthStore } from "@/auth/authStore";
import { useVault } from "@/vault/store";
import { UnlockCard } from "@/vault/ui/UnlockCard";
import { VaultIntro } from "@/vault/ui/onboarding/VaultIntro";
import { PassphraseStep } from "@/vault/ui/onboarding/PassphraseStep";
import { RecoveryKeyStep } from "@/vault/ui/onboarding/RecoveryKeyStep";
import { VaultReady } from "@/vault/ui/onboarding/VaultReady";
import { markIntroSeen, readIntroSeen } from "@/vault/ui/onboarding/introSeen";
import { useTabBarHold } from "@/orbit/tabBarHold";
import { SpaceRow } from "@/vault/ui/SpaceRow";
import { useT } from "@/lib/i18n";

/**
 * The Vault's front screen: the gate first, the Spaces once it is open.
 *
 * This file, and the two screens under it, are the only place the app imports
 * the Vault store from. expo-router loads a route module the first time it is
 * navigated to, so the e2ee bundle the store pulls in behind it stays out of
 * the boot path - see VaultRootRow for the other half of that rule.
 */
const EXPLAINER_URL = "https://dosya.dev/vault";

export default function VaultScreen() {
  const t = useT();
  const router = useRouter();
  const accountId = useAuthStore((s) => s.user?.id) ?? null;
  const status = useVault((s) => s.status);
  const hasIdentity = useVault((s) => s.hasIdentity);
  const error = useVault((s) => s.error);
  const spaces = useVault((s) => s.spaces);
  const recoveryKeyOnce = useVault((s) => s.recoveryKeyOnce);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);
  const [naming, setNaming] = useState(false);
  // First run, before there is a Vault: the intro, then the passphrase. Null
  // until this phone's "seen the intro" flag has been read.
  const [stage, setStage] = useState<"intro" | "passphrase" | null>(null);
  const [introStart, setIntroStart] = useState(0);
  // After the recovery key: a one-off "ready" page. Local on purpose - it is
  // the tail of THIS setup, and must not come back on the next visit.
  const [ready, setReady] = useState(false);

  // Read this account's saved Spaces list before asking whether it has an
  // identity at all: the list is local and free, the check is a request.
  useEffect(() => {
    void (async () => {
      if (accountId) await useVault.getState().hydrate(accountId);
      await useVault.getState().checkIdentity();
    })();
  }, [accountId]);

  useEffect(() => {
    if (hasIdentity !== false || stage !== null) return;
    void readIntroSeen().then((seen) => setStage(seen ? "passphrase" : "intro"));
  }, [hasIdentity, stage]);

  const startSetup = () => {
    void markIntroSeen();
    setStage("passphrase");
  };

  // The first-run screens are full height: the bar goes while any is up.
  const onboarding = hasIdentity === false || !!recoveryKeyOnce || ready;
  useTabBarHold("vault-onboarding", onboarding);

  // Once per unlocked session. Discovery is a network round trip, and a screen
  // that re-ran it on every render would re-run it on every keystroke in the
  // New Space dialog.
  const discovered = useRef(false);
  useEffect(() => {
    if (status !== "unlocked") {
      discovered.current = false;
      return;
    }
    if (discovered.current) return;
    discovered.current = true;
    void useVault.getState().refreshSpaces();
  }, [status]);

  const mySpaces = useMemo(
    () => useVault.getState().mySpacesForActiveWorkspace(),
    // The store's filter reads both of these; listing them here is what makes
    // the memo recompute when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaces, activeWorkspaceId],
  );
  const sharedSpaces = spaces.filter((s) => s.shared);

  const openSpace = (id: string, name: string) => {
    void (async () => {
      if (!(await useVault.getState().openSpace(id))) return;
      router.push({ pathname: "/vault/space/[id]/[folderId]", params: { id, folderId: "root", name } });
    })();
  };

  const createSpace = (name: string) => {
    setNaming(false);
    if (!name) return;
    void (async () => {
      const id = await useVault.getState().createSpace(name);
      if (!id) return;
      router.push({ pathname: "/vault/space/[id]/[folderId]", params: { id, folderId: "root", name } });
    })();
  };

  if (hasIdentity === false) {
    if (stage === null) {
      return (
        <View testID="vault-checking" className="flex-1 items-center justify-center bg-background">
          <ActivityIndicator />
        </View>
      );
    }
    return stage === "intro" ? (
      <VaultIntro
        initialIndex={introStart}
        onSetUp={startSetup}
        // Back out to Files; the intro is not marked seen, so it greets them next time.
        onNotNow={() => router.navigate("/")}
      />
    ) : (
      <PassphraseStep
        onBack={() => {
          setIntroStart(2);
          setStage("intro");
        }}
      />
    );
  }

  if (recoveryKeyOnce) return <RecoveryKeyStep onDone={() => setReady(true)} />;

  if (ready) {
    return (
      <VaultReady
        onCreateSpace={() => {
          setReady(false);
          setNaming(true);
        }}
        onDone={() => setReady(false)}
      />
    );
  }

  return (
    // No back arrow: this is a tab's root, not a page you arrived at from the
    // file list, and there is nothing behind it to go back to.
    <Screen title="Vault" header={<WorkspaceHeader />}>
      <ScrollView contentContainerClassName="pb-8" keyboardShouldPersistTaps="handled">
        {hasIdentity === null ? (
          error ? (
            // A failed check is NOT "no Vault": routing to Setup here would
            // upsert a second identity over the user's real one.
            <View className="rounded-lg border border-border bg-card p-5">
              <Text className="mb-4 text-sm text-destructive">{error}</Text>
              <Button title={t("common.retry")} testID="vault-retry" onPress={() => void useVault.getState().checkIdentity()} />
            </View>
          ) : (
            <View testID="vault-checking" className="items-center py-10">
              <ActivityIndicator />
            </View>
          )
        ) : status !== "unlocked" ? (
          <UnlockCard />
        ) : (
          <>
            <View className="mb-5">
              <Text className="text-sm text-muted-foreground">
                {t("vault.description.yourFilesAreEncryptedOnThisPhoneBeforeTheyEverLeaveItDosyaOnly")}
              </Text>
              <Pressable
                testID="vault-what-is"
                accessibilityRole="link"
                hitSlop={8}
                className="mt-2 self-start"
                onPress={() => void Linking.openURL(EXPLAINER_URL)}
              >
                <Text className="text-sm text-primary">{t("vault.description.whatIsVault")}</Text>
              </Pressable>
            </View>

            <Section title={t("vault.heading.mySpaces")}>
              {mySpaces.length === 0 ? (
                <View className="px-4 py-3">
                  <Text className="text-sm text-muted-foreground">{t("vault.description.noSpacesYetInThisWorkspace")}</Text>
                </View>
              ) : (
                mySpaces.map((s, i) => (
                  <SpaceRow key={s.id} space={s} border={i < mySpaces.length - 1} onPress={() => openSpace(s.id, s.name)} />
                ))
              )}
            </Section>

            {sharedSpaces.length > 0 ? (
              <Section title={t("vault.heading.sharedWithMe")}>
                {sharedSpaces.map((s, i) => (
                  <SpaceRow key={s.id} space={s} border={i < sharedSpaces.length - 1} onPress={() => openSpace(s.id, s.name)} />
                ))}
              </Section>
            ) : null}

            {error ? <Text className="mb-4 text-sm text-destructive">{error}</Text> : null}

            <Button title={t("vault.action.newSpace")} testID="vault-new-space" onPress={() => setNaming(true)} />

            <View className="mt-6">
              <Section>
                {/* `right={null}` rather than nothing: a chevron would promise
                    a screen behind the row, and this one acts on the spot. */}
                <SettingsRow icon="lock-closed" label={t("common.action.lock")} testID="vault-lock" right={null} onPress={() => void useVault.getState().lock()} />
              </Section>
            </View>
          </>
        )}
      </ScrollView>

      {naming ? (
        <PromptDialog
          visible
          title={t("vault.heading.newSpace")}
          placeholder={t("vault.placeholder.spaceName")}
          confirmLabel={t("common.action.create")}
          onCancel={() => setNaming(false)}
          onSubmit={createSpace}
        />
      ) : null}
    </Screen>
  );
}
