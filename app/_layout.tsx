import "../global.css";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View, ActivityIndicator } from "react-native";
import { Stack, useNavigationContainerRef, useRouter, useSegments } from "expo-router";
import * as Sentry from "@sentry/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { SpaceMono_400Regular } from "@expo-google-fonts/space-mono";
import { queryClient } from "@/lib/queryClient";
import { useAuthStore, getLastSessionDropReason, takeAccountSwitch, onBeforeSignOut } from "@/auth/authStore";
import { useColorTheme } from "@/theme/useColorTheme";
import { fonts } from "@/theme/fonts";
import { useAppearanceSync } from "@/profile/hooks";
import { AppLockGate } from "@/auth/AppLockGate";
import { OnboardingGate } from "@/onboarding/OnboardingGate";
import { hasSeenWelcome } from "@/onboarding/onboardingState";
import { WorkspaceGate } from "@/files/WorkspaceGate";
import { registerBackupTask, startAutoBackupTriggers, settleBackgroundUploads } from "@/backup/background";
import { useBackupSettings } from "@/backup/settings";
import { sweepUploadCache } from "@/upload/runner";
import { hydrateUploadQueue, resumeUploadQueue, startUploadQueuePersistence } from "@/upload/persist";
import { restoreQueryCache, startQueryPersistence } from "@/lib/queryPersist";
import { startOfflineForAccount } from "@/offline/background";
import { sweepSessionCaches } from "@/files/cacheControl";
import { hydrateUploadBlock } from "@/upload/uploadBlock";
import { startStatusBridge } from "@/backup/statusBridge";
import { startBackupAlerts } from "@/backup/alerts";
import { startPosterOnUpload } from "@/files/posterOnUpload";
import { startRemotePushRouting, routeColdStartNotification } from "@/notifications/remote";
import { syncPushRegistration, unregisterForPush } from "@/notifications/push";
import { pendingOfflinePurge, purgeAccountData } from "@/auth/purge";
import { linkFilesProvider } from "@/filesProvider/link";
import { shouldPurgeOnSignOut } from "@/auth/sessionDrop";
import { ErrorBoundary } from "@/ui/ErrorBoundary";
import { PendingReportRedirect } from "@/support/PendingReportRedirect";
import { MaintenanceScreen } from "@/ui/MaintenanceScreen";
import { useMaintenanceStore } from "@/ui/maintenanceStore";
import { useReaderPrefs } from "@/reader/readerPrefs";
import { ensureDeviceId } from "@/lib/deviceId";
import { I18nProvider, bootI18n, t as translate, useT, type BootResult } from "@/lib/i18n";
import { toast } from "@/ui/toast";
import { localeDir } from "@/i18n/locales";
import { needsReload, reloadForDirection, syncNativeDirection } from "@/lib/direction";
import { useShareIntentRouting } from "@/share-intent/useShareIntentRouting";
import { ShareIntentRedirect } from "@/share-intent/ShareIntentRedirect";
import { ReaderHost } from "@/personas/device/ReaderHost";
import { watchPersonasSchedule } from "@/personas/device/schedule";
import { initSentry, navigationIntegration, setSentryUser } from "@/telemetry/sentry";
import { startAnalytics } from "@/analytics/wiring";
import { trackScreen } from "@/analytics/analytics";

// Before any component renders: the SDK's global error handler and the
// native crash handlers must be installed ahead of the first thing that can
// throw. Idempotent, so a Fast Refresh of this module is harmless.
initSentry();

export function Providers({ children }: { children: ReactNode }) {
  // ThemeProvider owns colorScheme + the theme's CSS variables (see src/theme).
  // GestureHandlerRootView: the file list's hold-to-drag and row swipes run on
  // react-native-gesture-handler, which needs one root view above everything
  // it handles (on Android nothing fires without it).
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** Renders nothing; adopts the server's saved theme once /api/me resolves. */
function AppearanceSync() {
  useAppearanceSync();
  return null;
}

function AuthGate({ i18nReady }: { i18nReady: boolean }) {
  const { tokens } = useColorTheme();
  const t = useT();
  const status = useAuthStore((s) => s.status);
  const pending2fa = useAuthStore((s) => s.pending2fa);
  const pendingVerification = useAuthStore((s) => s.pendingVerificationEmail);
  const hydrate = useAuthStore((s) => s.hydrate);
  const maintenance = useMaintenanceStore((s) => s.maintenance);
  const segments = useSegments();
  const router = useRouter();
  // Value-before-signup deck: shown once per DEVICE (see onboardingState's
  // WELCOME_KEY, which is device-wide, unlike per-account onboarding). Null
  // means the check has not resolved yet - the redirect effect below WITHHOLDS
  // the signed-out redirect entirely while this is null, so an unhandled
  // rejection here would strand a signed-out user on a dead route forever
  // (there is no app/index.tsx to fall back to). hasSeenWelcome() itself
  // already resolves rather than rejects, but this .catch is a second,
  // independent guard: a future unguarded storage helper here must not be
  // able to reintroduce the hang. Same "seen" default as hasSeenWelcome's own
  // guard, for the same reason - login is reachable and safe; the cost is
  // losing the deck once.
  //
  // Re-read on every auth transition, not once per process. The redirect
  // effect below CONSUMES this value on every status change, so a value
  // resolved once at launch went stale the moment the deck wrote its flag:
  // a device that saw the deck, signed up, and then signed out in the same
  // session was sent back to the value deck instead of to login.
  const [welcomeSeen, setWelcomeSeen_] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    // Back to "unresolved" first, so the redirect below withholds rather than
    // acting on the previous session's answer while the new read is in flight.
    setWelcomeSeen_(null);
    void hasSeenWelcome()
      .then((seen) => { if (alive) setWelcomeSeen_(seen); })
      .catch(() => { if (alive) setWelcomeSeen_(true); });
    return () => { alive = false; };
  }, [status]);
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
  });

  // Files arriving from the OS's "Open with" chooser and share sheet (Android
  // via the native module, iOS via app/+native-intent.ts). Called here rather
  // than inside the signed-in tree below, and above the early returns, because
  // a share can land during a cold start or while the user is signed out - the
  // two moments this component is NOT rendering that tree. Missing them is the
  // difference between the feature working and the file silently vanishing.
  // This only RECEIVES; the picker is opened by <ShareIntentRedirect /> beside
  // the Stack below, once a navigator really exists to push onto.
  useShareIntentRouting();

  useEffect(() => {
    // First, and before anything that can issue a request: apiRequest reads the
    // resolved id synchronously, so the earlier this lands the fewer calls go
    // out with no device on them.
    void ensureDeviceId();
    // Offline cold start: yesterday's workspaces, listings and file records
    // come back from disk before the first screen asks (never rejects), and
    // the cache is written back whenever the app leaves the foreground.
    void restoreQueryCache();
    const stopQueryPersistence = startQueryPersistence();
    void sweepSessionCaches(); // view-only / locked bytes from the last session do not carry over
    hydrate();
    void useReaderPrefs.getState().hydrate(); // restore global font size / reading theme (see src/reader/readerPrefs.ts)
    // Backup settings drive whether auto-backup runs at all. Nothing else reads
    // them at startup, and leaving them at their in-memory defaults reports
    // "auto-backup off" to both this UI and the headless task.
    void useBackupSettings.getState().hydrate();
    registerBackupTask().catch(() => {}); // background task unavailable in some envs (e.g. Expo Go) - non-fatal
    // The user's upload queue survives a relaunch: restore it (and re-pump it)
    // FIRST, then clear orphaned upload-* temp copies from a prior killed
    // upload - sparing the staged files the restored queue still points at.
    // hydrateUploadQueue never rejects; the sweep is best-effort either way.
    startUploadQueuePersistence();
    hydrateUploadQueue()
      .then((keep) => sweepUploadCache(keep))
      .catch(() => {});
    void hydrateUploadBlock(); // restore a persisted fatal-pause (e.g. storage limit) so the Backup tab shows Paused after a restart
    startStatusBridge(); // mirror engine state to the iOS widget + Live Activity (no-op without the native module)
    startBackupAlerts(); // local notifications when a (background) backup pauses or fails
    startPosterOnUpload(); // a video uploaded from this phone gets its poster from the local file
    startAnalytics(); // usage data, only after the person agrees (src/analytics); reads the stored answer, sends nothing yet
    // Server pushes: show them in the foreground, route a tap to the thing
    // it is about (src/notifications/remote.ts). Installed at launch, before
    // any session, so a tap on a cold start is caught.
    startRemotePushRouting();
    // Stop delivery to this phone as the first step of a sign-out, while the
    // session the request needs is still live.
    const offSignOut = onBeforeSignOut(unregisterForPush);
    return () => { stopQueryPersistence(); offSignOut(); };
  }, [hydrate]);

  // Personas background reading: which OS windows to ask for, planned again on
  // every app state change and whenever the read mode, the reader or the
  // signed-in user changes (src/personas/device/schedule.ts). On Android the
  // foreground service can only start from here, while the app is in front.
  useEffect(() => watchPersonasSchedule(), []);

  // Auto-backup triggers live for the whole signed-in session (see
  // startAutoBackupTriggers). Scoped to signedIn so a signed-out process never
  // holds a media-library listener.
  useEffect(() => {
    if (status !== "signedIn") return;
    // Anything the launch restored has been waiting for a session to send it
    // under (see upload/persist.ts).
    resumeUploadQueue();
    // Results iOS delivered while the app was not running: those uploads
    // finished without us, and nothing else in the process asks for them.
    // Also returns any row whose job did not survive the relaunch to pending.
    // Here rather than in the launch effect above because registering them
    // needs the session that effect is still restoring - `status` is only
    // "signedIn" once the token is back.
    void settleBackgroundUploads().catch(() => {});
    // Register this phone for push under the session that just started. The
    // OS prompt shows once per install; after that this is silent and only
    // re-points an existing token at the current account. Until this ran here
    // the only registration path was the settings switch, and production had
    // no phone registered at all (2026-09-27).
    void syncPushRegistration("prompt-once").catch(() => {});
    // A tap that launched the app from cold: routed now that there is a
    // session to route under.
    void routeColdStartNotification();
    const dispose = startAutoBackupTriggers();
    return () => dispose();
  }, [status]);

  // On sign-out, purge EVERYTHING account-scoped - query cache, active
  // workspace, upload queue/pause, backup ledger/history/settings, contacts
  // state, this account's onboarding progress - so a different account never
  // inherits the previous user's data. The user object is already null by
  // the time status flips, so the id is captured from the last signed-in
  // render rather than read here.
  const lastAccountId = useRef<string | null>(null);
  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (user?.id) lastAccountId.current = user.id;
  }, [user]);

  // Crash reports carry the opaque account id (never the email - see
  // src/telemetry/sentry.ts) so a report can be matched to a support ticket.
  // Keyed on the id so a profile refresh does not re-set it; null on sign-out
  // so the next account's crashes are not filed under the previous one.
  const userId = user?.id ?? null;
  useEffect(() => {
    setSentryUser(userId);
  }, [userId]);

  // Screen-change breadcrumbs for crash reports. expo-router's container ref
  // is null until the root navigator mounts, hence the guard.
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    if (navigationRef) navigationIntegration.registerNavigationContainer(navigationRef);
  }, [navigationRef]);

  useEffect(() => {
    if (status !== "signedOut") return;
    // Only when we KNOW the account is gone. Reaching signedOut does not prove
    // it: hydrate() also lands here when it could not read the token store at
    // all (a locked iOS keychain during a background launch), and that session
    // is still on disk and still live. Purging there wipes the backup ledger
    // and resets backup settings for a session that comes straight back.
    if (!shouldPurgeOnSignOut(getLastSessionDropReason())) return;
    void purgeAccountData(lastAccountId.current);
    lastAccountId.current = null;
  }, [status]);

  // The other half of what the sign-out purge used to guarantee: a DIFFERENT
  // account signing in purges the one it replaced, so no account ever inherits
  // another's cached files, workspaces or backup ledger. This also covers what
  // the sign-out hook never could - the app killed while signed in, so no
  // transition was ever observed.
  useEffect(() => {
    if (!user?.id) return;
    const previous = takeAccountSwitch();
    if (previous) void purgeAccountData(previous);
  }, [user]);

  // The iOS Files app location (targets/files-provider). Keyed on the account
  // id, not the user object, so a profile refresh does not re-run it. A no-op
  // on Android and on iOS 15; never blocks anything if the mint fails.
  const signedInUserId = status === "signedIn" ? user?.id ?? null : null;
  // Offline files belong to one account: its session begins once we know who
  // is signed in (an offline launch included - the stored profile names them),
  // and its triggers run for as long as they stay signed in.
  // A purge still removing the previous account's offline files (sign-out,
  // then a quick sign-in; or an account switch, whose purge the effect above
  // has just started) ends whatever session is running when it gets there, so
  // the next account's session begins only once that part is done. With no
  // purge pending it begins at once, so an offline cold start reads its saved
  // files on the first render.
  useEffect(() => {
    if (!signedInUserId) return;
    const pending = pendingOfflinePurge();
    if (!pending) return startOfflineForAccount(signedInUserId);
    let live = true;
    let stop: (() => void) | null = null;
    void pending.then(() => {
      if (live) stop = startOfflineForAccount(signedInUserId);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [signedInUserId]);
  useEffect(() => {
    if (!signedInUserId) return;
    void linkFilesProvider(signedInUserId);
    // The extension wipes its own session once the server rejects its refresh
    // and tells the user to open the app. Opening the app is a foreground, not
    // a mount, so this is the moment the extension gets a new session.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void linkFilesProvider(signedInUserId);
    });
    return () => sub.remove();
  }, [signedInUserId]);

  // Which screen is in front, for usage analytics: the route's template
  // (segments carry "[id]", never the id), and nothing unless the person has
  // agreed. Keyed on the joined template so a param change is not a new view.
  const screenKey = segments.join("/");
  useEffect(() => {
    if (status === "loading") return;
    trackScreen(screenKey.split("/"));
  }, [screenKey, status]);

  useEffect(() => {
    if (status === "loading") return;
    const inAuth = segments[0] === "(auth)";
    // Legal pages must be reachable BEFORE signing in - the login/signup
    // footers link to them, and the guard would otherwise bounce the push
    // back to /login before the screen ever paints.
    const inLegal = segments[0] === "terms" || segments[0] === "privacy";
    // The OAuth deep link (dosya://auth/callback?code=…) lands here while still
    // signed out and needs to finish the exchange. Bouncing it to /login would
    // discard the one-time code - which is exactly what "Unmatched Route" then
    // looked like to the user. Note `auth` (real path) is NOT `(auth)` (group).
    const inOAuthCallback = segments[0] === "auth";
    // The Vault diagnostics screen (dosya://vault-diagnostics, Maestro's
    // phase-2 device gate) uses no account, no network and no user data, so a
    // signed-out phone may open it; bouncing it to the deck would make the
    // gate impossible on a fresh install.
    // The Personas reader parity screen (dosya://personas-parity) is the same
    // kind of device gate: bundled photos, no account, no user data.
    const inDiagnostics = segments[0] === "vault-diagnostics" || segments[0] === "personas-parity";
    if (status === "signedOut") {
      if (inOAuthCallback) return;
      if (pending2fa) router.replace("/(auth)/2fa");
      else if (pendingVerification) router.replace("/(auth)/verify");
      else if (!inAuth && !inLegal && !inDiagnostics) {
        // Value before signup on a device that has never seen the deck. Null
        // means the check has not resolved yet - bouncing now would land on
        // login and burn the one chance to show it.
        if (welcomeSeen === null) return;
        router.replace(welcomeSeen ? "/(auth)/login" : "/(auth)/welcome");
      }
    } else if (status === "signedIn" && inAuth) {
      router.replace("/");
    }
  }, [status, pending2fa, pendingVerification, segments, router, welcomeSeen]);

  if (!fontsLoaded || status === "loading" || !i18nReady) {
    return (
      <View testID="app-loading" className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  // The mobile platform switch is off (see src/api/client.ts): every gated
  // request answers 503 surface_disabled, and the client records it here
  // regardless of which screen made the call. Takes over BOTH branches below -
  // signed in or out, this is the whole app's answer until the surface comes
  // back (MaintenanceScreen clears the store itself once a retry succeeds).
  if (maintenance) {
    return <MaintenanceScreen />;
  }
  if (status === "signedIn") {
    return (
      <AppLockGate>
        <AppearanceSync />
        <OnboardingGate>
          <WorkspaceGate>
          <View className="flex-1">
            {/* `minimal` = back arrow with no label. The default spells out the previous
                route's name beside it, which for anything pushed from a tab reads
                literally "(tabs)". Set here so no screen has to remember it. */}
            {/* Native stack headers don't see nativewind's CSS vars, so every
                pushed screen that opts into `headerShown: true` must get the
                active THEME's colors from here - otherwise headers stay
                system-white/black no matter which theme is selected. */}
            <Stack
              screenOptions={{
                headerShown: false,
                headerBackButtonDisplayMode: "minimal",
                headerStyle: { backgroundColor: tokens.card },
                headerTintColor: tokens.primary,
                headerTitleStyle: { color: tokens.foreground, fontFamily: fonts.medium },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: tokens.background },
              }}
            >
              {/* MUST stay first. React Navigation's StackRouter falls back to
                  `routeNames[0]` whenever it builds initial state, and expo-router
                  orders explicitly declared screens ahead of the file-system ones
                  (getSortedChildren, expo-router/build/useScreens.js). While
                  `player` was the only declared screen it WAS routeNames[0], so a
                  sign-in - where the gates below leave the navigator unmounted for
                  a beat, losing the redirect - landed on the full-screen player
                  ("Nothing playing.") as the stack's root, with system back
                  quitting the app. Declaring (tabs) first makes the Files tab the
                  fallback. Nothing else about this screen is customised. */}
              <Stack.Screen name="(tabs)" />
              {/* Static options: presentation must be set before first mount.
                  Setting it dynamically from inside the screen leaves the header
                  unrendered and re-applies native options on every re-render,
                  which reads as the whole screen "refreshing" on control taps. */}
              <Stack.Screen name="player" options={{ headerShown: false, presentation: "modal" }} />
              <Stack.Screen name="vault-diagnostics" options={{ headerShown: true, title: "Vault diagnostics" }} />
              <Stack.Screen name="personas-parity" options={{ headerShown: true, title: "Personas parity" }} />
              <Stack.Screen name="report-problem" options={{ headerShown: true, title: t("common.heading.reportAProblem") }} />
              <Stack.Screen name="language" options={{ headerShown: true, title: t("appearance.label.language") }} />
              <Stack.Screen name="support-chat" options={{ headerShown: true, title: t("common.action.liveChat") }} />
              <Stack.Screen name="upgrade" options={{ headerShown: true, title: t("upgrade.heading.upgrade"), presentation: "modal" }} />
            </Stack>
            {/* After the Stack: its effect fires in the same commit that
                remounts this tree after an ErrorBoundary reset, and the
                navigator is not ready for router.push() until a tick later
                (see PendingReportRedirect). */}
            <PendingReportRedirect />
            {/* Same placement for the same reason: the picker for a file opened
                from another app can only be pushed once this Stack exists. */}
            <ShareIntentRedirect />
            {/* Personas' face reader: a zero-size WebView, mounted only while
                photos are being read (src/personas/device/ReaderHost). Here so
                reading started from any screen has it. */}
            <ReaderHost />
          </View>
          </WorkspaceGate>
        </OnboardingGate>
      </AppLockGate>
    );
  }
  // Signed-out stack: same themed native-header treatment as the signed-in
  // one, so the legal pages (which opt into headerShown) render correctly.
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: tokens.card },
          headerTintColor: tokens.primary,
          headerTitleStyle: { color: tokens.foreground, fontFamily: fonts.medium },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: tokens.background },
        }}
      />
    </>
  );
}

function RootLayout() {
  // The language is read (and its messages loaded) before the first real
  // frame, so a Turkish phone never flashes English. Never rejects, and the
  // keychain read inside is capped at 1.5 s. Auth and the launch effects start
  // meanwhile; only what is painted waits.
  const [boot, setBoot] = useState<BootResult | null>(null);
  const [reopenNotice, setReopenNotice] = useState(false);
  useEffect(() => {
    // After the provider has applied the boot language, so the notice is in it.
    if (boot && reopenNotice) toast(translate("appearance.description.reopenToFinishLanguageChange"));
  }, [boot, reopenNotice]);
  useEffect(() => {
    let alive = true;
    let waitForActive: { remove(): void } | null = null;
    // The native layout direction must equal the language's before anything
    // real paints. When it does not (first launch on an Arabic phone) the
    // flags are set and the app reloads once; the loading screen stays up
    // through it. A refused or failed reload paints in place.
    const settle = (b: BootResult) => {
      const rtl = localeDir(b.locale) === "rtl";
      syncNativeDirection(rtl);
      if (!needsReload(rtl)) {
        setBoot(b);
        return;
      }
      void reloadForDirection("direction", rtl).then((r) => {
        if (!alive || r === "reloading") return;
        // The language paints in a layout of the other direction; a cold
        // start fixes it, so say so once it is on screen.
        setBoot(b);
        setReopenNotice(true);
      });
    };
    void bootI18n().then((b) => {
      if (!alive) return;
      if (AppState.currentState !== "background") {
        settle(b);
        return;
      }
      // An iOS background launch (backup task, CarPlay, silent push) mounts
      // this tree too. A reload there would kill the background work, and a
      // keychain still locked before the first unlock reads the wrong choice.
      // Nothing is painted in the background, so the direction waits for the
      // first foreground, with the choice read again.
      waitForActive = AppState.addEventListener("change", (state) => {
        if (state !== "active" || !alive || waitForActive === null) return;
        waitForActive.remove();
        waitForActive = null;
        void bootI18n().then((again) => {
          if (alive) settle(again);
        });
      });
    });
    return () => {
      alive = false;
      waitForActive?.remove();
    };
  }, []);
  return (
    <Providers>
      <I18nProvider initial={boot}>
        <ErrorBoundary>
          <AuthGate i18nReady={boot !== null} />
        </ErrorBoundary>
      </I18nProvider>
    </Providers>
  );
}

// Sentry.wrap adds the touch-event breadcrumb boundary and the root profiler
// around the whole tree; it renders RootLayout unchanged otherwise.
export default Sentry.wrap(RootLayout);
