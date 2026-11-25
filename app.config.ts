import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";

// CarPlay + Siri are opt-in per build: DOSYA_CARPLAY=1 in the environment of
// `eas build` / `expo prebuild` adds the two plugins below. Both add
// entitlements (com.apple.developer.carplay-audio, com.apple.developer.siri)
// that the App Store provisioning profile must carry, or Xcode refuses to sign
// before compiling anything - EAS build 15 (2026-09-04) died exactly there.
// CarPlay is a restricted entitlement Apple grants per app on request and EAS
// cannot enable it on the App ID (it is not in eas-cli's capability list), so
// until Apple approves it a store build with these plugins can never succeed.
// Siri rides on the same flag: the voice search exists for CarPlay, and even
// alone it needs an interactive Apple login for the capability sync that a
// --non-interactive build never runs.
//
// To ship CarPlay: get the entitlement approved at developer.apple.com/contact/carplay,
// enable CarPlay Audio + SiriKit on the dev.dosya.app App ID, regenerate the
// profile (`eas credentials`), then build with DOSYA_CARPLAY=1 (eas.json env).
const carPlayEnabled = process.env.DOSYA_CARPLAY === "1";

// How this binary reached the user, baked in at build time.
//
// "direct"  - the APK downloaded from dosya.dev/mobile (eas.json's
//             "production-apk" profile sets DOSYA_DIST_CHANNEL=direct).
// "play"    - everything else, including the Play AAB and every local build.
//
// This drives one thing: whether the in-app update check runs. It MUST
// default to "play" rather than "direct", because the failure modes are not
// symmetric. A sideloaded build that never self-updates is stale but works.
// A Play build that thinks it is sideloaded would show "update available" and
// hand the user an APK that Android REFUSES to install over it - Play App
// Signing re-signs the store build with a key we do not hold, so the two
// carry different signatures and installing one over the other fails with
// INSTALL_FAILED_UPDATE_INCOMPATIBLE. An unset or misspelled env var must
// land on the harmless side of that.
const distributionChannel =
  process.env.DOSYA_DIST_CHANNEL === "direct" ? "direct" : "play";

// Firebase Cloud Messaging config for Android push.
//
// Expo's push service delivers to Android through FCM, and FCM needs two
// things this repo does not hold: this file (from the Firebase console, project
// settings > your apps > dev.dosya) baked into the build, and the FCM V1
// service-account key uploaded to EAS (`eas credentials -p android` > Google
// Service Account > FCM V1). Without the file getExpoPushTokenAsync throws on
// every Android device ("Default FirebaseApp is not initialized"), so the app
// cannot register for push there at all - which is where things stood on
// 2026-09-27: no Android (or iOS) row had ever reached push_subscriptions.
//
// Two ways in, checked in this order:
//   GOOGLE_SERVICES_JSON - the path EAS writes a *file* environment variable
//                          to. The recommended route: the file never touches
//                          git, and EAS archives the project via git, so a
//                          gitignored local copy would not reach the build.
//   ./google-services.json - a local copy, for `expo prebuild` / `expo run`.
// Absent both, the key is left out and Android builds without push. The build
// must not fail on it: iOS is unaffected and every other feature still ships.
const apnsMode =
  process.env.EAS_BUILD_PROFILE && process.env.EAS_BUILD_PROFILE !== "development"
    ? "production"
    : "development";

const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON
  ?? (existsSync(join(__dirname, "google-services.json")) ? "./google-services.json" : undefined);

// iOS purpose strings (Info.plist NS*UsageDescription). Written to App
// Review's standard: what the app does with the resource plus a concrete
// example. Defined once and referenced from both infoPlist and every plugin
// that can write the same key, so there is exactly one text per key.
const PHOTO_LIBRARY_PURPOSE =
  "dosya.dev needs access to your photo library to back up the photos and videos you pick to your dosya.dev storage. For example, when you turn on Automatic backup in Backup settings, new photos you take are uploaded on their own, and when you tap Upload you can choose photos from your library to send to a folder.";
const PHOTO_LIBRARY_ADD_PURPOSE =
  "dosya.dev saves to your photo library when you restore a backed-up photo or video to this device, for example after you download a photo from one of your dosya.dev folders. If you turn on Delete originals after backup in Backup settings, dosya.dev also removes originals from this library once they are safely backed up.";
const CAMERA_PURPOSE =
  "dosya.dev uses the camera to take a photo and upload it straight to the dosya.dev folder you are in, for example when you tap Upload and choose Take photo. Photos are uploaded only after you confirm them.";
const FACE_ID_PURPOSE =
  "dosya.dev uses Face ID to unlock the app without typing your password, for example when you reopen the app after turning on Unlock with biometrics in Security settings.";
// Read by the Google Cast SDK when the "Cast to" sheet first looks for TVs.
// Discovery is off until then (the plugin options below), so this is asked
// the first time someone casts, never at launch.
const LOCAL_NETWORK_PURPOSE =
  "dosya.dev uses your local network to find Chromecast and Google TV devices on your Wi-Fi, for example when you open a video or photo, tap the three dots and choose Cast to TV. dosya.dev only looks for TVs while that list is open.";
const CONTACTS_PURPOSE =
  "dosya.dev needs access to your contacts to back them up to your dosya.dev storage as a single .vcf file and to restore them to this device, for example when you tap Back up contacts now or Restore from latest backup on the Contacts screen.";

const config: ExpoConfig = {
  name: "dosya.dev",
  slug: "dosya-mobile",
  scheme: "dosya",
  // The MARKETING version, and the only version number this repo owns.
  //
  // It becomes CFBundleShortVersionString on iOS and versionName on Android,
  // and it is what Settings shows the user. Bump it here and nowhere else:
  // app.config.test.ts asserts package.json agrees, so the two cannot drift.
  //
  // The BUILD numbers (CFBundleVersion / versionCode) are NOT here on purpose:
  // eas.json sets appVersionSource "remote", so EAS assigns them server-side
  // per build and injects them into the native project. See the notes where
  // they would otherwise sit, under ios and android below.
  version: "1.2.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  // The app draws edge-to-edge and the tab bar paints the page colour down
  // under the system buttons itself. Android's contrast scrim would lay a
  // white band over that on three-button navigation.
  androidNavigationBar: { enforceContrast: false },
  newArchEnabled: true,
  web: { favicon: "./assets/favicon.png" },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "dev.dosya.app",
    // DOSYA PTY LTD. Confirmed against the Developer Portal 2026-09-23: App ID
    // dev.dosya.app carries prefix 53HFF44WQ8, and every certificate and
    // provisioning profile EAS holds is issued under that team. The previous
    // value (2X2BHWMV24) never broke a store build because EAS overrides
    // DEVELOPMENT_TEAM from the credentials it fetches, so it only ever
    // mis-signed a local `expo prebuild`.
    appleTeamId: "53HFF44WQ8",
    // NO buildNumber / CFBundleVersion here, deliberately. eas.json sets
    // appVersionSource "remote", so EAS owns it: it is assigned server-side per
    // build and injected into the native project, and eas-cli prints a warning
    // recommending its removal if the key is present. Nothing in the app reads
    // it either - Settings and the sideload update check both go through
    // expo-application (src/lib/appVersion.ts, src/update/runtime.ts), because
    // a literal here would report build 1 forever.
    // Universal links: the dosya TV app's QR code is
    // https://app.dosya.dev/tv?code=..., and with this entitlement iOS opens it
    // here (app/tv.tsx) instead of Safari. iOS honours it only once
    // https://app.dosya.dev/.well-known/apple-app-site-association
    // (apps/web/public) lists this app, and only for the paths that file
    // names (/tv), so every other app.dosya.dev link still opens in Safari.
    //
    // webcredentials is what lets this app use passkeys for app.dosya.dev, the
    // RP ID. iOS checks the same file for this App ID; until it lists it, the
    // passkey sheet refuses with a configuration error.
    associatedDomains: ["applinks:app.dosya.dev", "webcredentials:app.dosya.dev"],
    entitlements: {
      // Shared with the BackupWidget target (widget + Live Activity read the
      // engine snapshot from this group).
      "com.apple.security.application-groups": ["group.dev.dosya.app"],
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSSupportsLiveActivities: true,
      // "fetch" and "processing" are what expo-background-task needs for the
      // hourly backup task. Listing them explicitly means a change in plugin
      // merge order cannot silently strip background execution - a failure that
      // looks like "auto-backup just never runs".
      UIBackgroundModes: ["audio", "fetch", "processing"],
      // BGTaskScheduler identifiers. expo-background-task appends its own
      // (backup) to this array at prebuild; it is listed here too so a plugin
      // change cannot drop it. The Personas reader adds its processing task
      // and the iOS 26 continued task (concrete ids are the prefix plus a
      // UUID; modules/dosya-personas-background). A continued task's wildcard
      // must start with the bundle ID, hence dev.dosya.app. No continued-processing GPU
      // entitlement: the reader runs on the CPU only.
      BGTaskSchedulerPermittedIdentifiers: [
        "com.expo.modules.backgroundtask.processing",
        "dev.dosya.personas.read",
        "dev.dosya.app.personas.continue.*",
      ],
      // Purpose strings. App Review rejected 1.0.2 under 5.1.1(ii): each
      // string must say what the app does with the resource AND give a
      // concrete example ("App needs microphone access" is their canonical
      // fail). Keep the plugin options below (expo-media-library,
      // expo-image-picker, expo-local-authentication, expo-contacts) IDENTICAL
      // to these - a plugin option with a string wins over infoPlist at
      // prebuild, so a mismatch here silently ships the plugin's text.
      NSPhotoLibraryUsageDescription: PHOTO_LIBRARY_PURPOSE,
      NSPhotoLibraryAddUsageDescription: PHOTO_LIBRARY_ADD_PURPOSE,
      NSCameraUsageDescription: CAMERA_PURPOSE,
      NSFaceIDUsageDescription: FACE_ID_PURPOSE,
      NSContactsUsageDescription: CONTACTS_PURPOSE,
      NSLocalNetworkUsageDescription: LOCAL_NETWORK_PURPOSE,
      // What puts dosya.dev in iOS's share sheet and in Files' "Share" for
      // documents ("Copy to dosya.dev"). iOS lists an app there ONLY if its
      // Info.plist claims the document's type; without this entry the app is
      // absent from every share sheet on every iPhone, and nothing in a build
      // or a test says so - the exact report of 2026-09-04 (PDFs, spreadsheets).
      //
      // public.data + public.content is the "any file" pair: a PDF, a .xlsx and
      // a .zip all conform to public.data. public.item is deliberately NOT
      // claimed - it would also list the app for folders and packages, which
      // the receiver cannot upload.
      //
      // Alternate rank: never displace Preview/Books as the default opener.
      // LSSupportsOpeningDocumentsInPlace is false, so iOS copies the file into
      // Documents/Inbox and hands the app a plain file:// URL it owns. It has to
      // be written out, not left to that default: App Store Connect flags any
      // build that declares CFBundleDocumentTypes without it (ITMS-90737, build
      // 17 on 2026-09-15).
      // The in-place alternative is a security-scoped handle that dies with the
      // access grant - the same hazard as Android's content:// URIs.
      //
      // The URL reaches JS through app/+native-intent.ts (expo-router), which
      // parks it for app/save-to.tsx. Nothing native is needed on iOS: unlike
      // Android's EXTRA_STREAM, the file lives in the URL itself.
      LSSupportsOpeningDocumentsInPlace: false,
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: "Document",
          CFBundleTypeRole: "Viewer",
          LSHandlerRank: "Alternate",
          LSItemContentTypes: ["public.data", "public.content"],
        },
      ],
    },
  },
  android: {
    // Must stay "dev.dosya": the Google Play listing was bound to this package
    // on its first upload and Play will not accept any other id. Deliberately
    // different from the iOS bundle id (dev.dosya.app) - do not "align" them.
    package: "dev.dosya",
    ...(googleServicesFile ? { googleServicesFile } : {}),
    // NO versionCode here either, for the same reason as iOS above - EAS
    // assigns it remotely. Worth knowing: the remote counter is shared across
    // BOTH Android profiles, so the Play AAB and the direct-download APK draw
    // from one sequence (Play saw 14, the site APK took 15 and 16). That is
    // monotonic and therefore perfectly valid for Play; it just means Play's
    // versionCode skips numbers. Expected, not a bug to "fix".
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    // What puts dosya.dev in Android's "Open with" chooser and share sheet.
    // Android lists an app there ONLY if its manifest declares a matching
    // filter - `scheme: "dosya"` above registers dosya:// links and nothing
    // else, which is why OAuth callbacks resolved while files never did.
    //
    // These MUST live here rather than in android/app/src/main/AndroidManifest.xml:
    // android/ is gitignored and regenerated by prebuild, so a hand-edited
    // manifest works locally and is silently discarded by the next EAS build.
    //
    // VIEW and SEND are separate entries because Android delivers them
    // differently - VIEW puts the URI in the intent's data, SEND puts it in the
    // EXTRA_STREAM extra. modules/dosya-share-intent normalises both.
    // Actions and categories are SHORT names ("VIEW", not
    // "android.intent.action.VIEW"). Expo's prebuild prepends the
    // android.intent.action. / android.intent.category. prefix itself, so a
    // fully-qualified name here is emitted doubled -
    // "android.intent.action.android.intent.action.VIEW" - which is a valid
    // manifest that matches no intent Android will ever send. It builds, it
    // installs, it runs, and the app simply never appears in the chooser.
    // Verify with: npx expo prebuild -p android && grep -A 30 MainActivity
    // android/app/src/main/AndroidManifest.xml
    intentFilters: [
      {
        action: "VIEW",
        category: ["DEFAULT"],
        // scheme "content" is required, not decorative: the Storage Access
        // Framework hands every file manager a content:// URI, never a file://
        // one, so a filter without it matches nothing in practice. "file" is
        // kept as well for the pre-SAF and OEM file managers that still fire
        // ACTION_VIEW with a file:// URI; the receiver accepts both schemes.
        data: [
          { scheme: "content", mimeType: "*/*" },
          { scheme: "file", mimeType: "*/*" },
        ],
      },
      // The dosya TV app's QR code (https://app.dosya.dev/tv?code=...) opens
      // app/tv.tsx. /tv only, so no other app.dosya.dev link is captured.
      // autoVerify needs https://app.dosya.dev/.well-known/assetlinks.json
      // carrying the Play app-signing certificate's SHA-256; until that is
      // served, Android 12+ opens the link in the browser (the web /tv page),
      // which works the same.
      {
        action: "VIEW",
        autoVerify: true,
        category: ["DEFAULT", "BROWSABLE"],
        data: [{ scheme: "https", host: "app.dosya.dev", pathPrefix: "/tv" }],
      },
      { action: "SEND", category: ["DEFAULT"], data: [{ mimeType: "*/*" }] },
      { action: "SEND_MULTIPLE", category: ["DEFAULT"], data: [{ mimeType: "*/*" }] },
    ],
  },
  plugins: [
    "expo-apple-authentication",
    "@bacons/apple-targets",
    "expo-router",
    "expo-asset",
    "expo-font",
    "expo-secure-store",
    // After expo-secure-store: keeps offline files (src/offline) out of Android
    // Auto Backup by extending that plugin's rule files.
    "./plugins/withOfflineBackupRules",
    "expo-video",
    // Chromecast (src/cast). Google's Default Media Receiver, so no receiver
    // app of our own to host. Discovery is off at launch and runs only while
    // the "Cast to" sheet is open (CastSheet.tsx), which is also what lets iOS
    // ask for local-network access at that moment rather than on first open.
    // The Android framework version is pinned: the plugin's default is "+",
    // which would let any build pick up whatever Google shipped that day.
    ["react-native-google-cast", {
      iosDisableDiscoveryAutostart: true,
      iosStartDiscoveryAfterFirstTapOnCastButton: false,
      expandedController: true,
      androidPlayServicesCastFrameworkVersion: "22.1.0",
    }],
    "expo-sqlite",
    // Vault: libsodium over JSI (Argon2id, XChaCha20-Poly1305, Ed25519,
    // randomness). New Architecture only, which this app already enables.
    // Patched (patches/react-native-libsodium+1.7.0.patch) so the AEAD accepts
    // binary associated data; see src/vault/backend.ts.
    ["react-native-libsodium", {}],
    ["expo-media-library", {
      photosPermission: PHOTO_LIBRARY_PURPOSE,
      savePhotosPermission: PHOTO_LIBRARY_ADD_PURPOSE,
      isAccessMediaLocationEnabled: true,
    }],
    // Android's status-bar icon for every notification: a white-on-transparent
    // silhouette, which the monochrome adaptive icon already is; the OS tints
    // it with `color`. Without an icon Android shows a blank square.
    ["expo-notifications", {
      icon: "./assets/android-icon-monochrome.png",
      color: "#22c55e",
      // The APNs environment written into the iOS entitlements. The plugin
      // defaults to "development", which is the sandbox gateway: a token
      // minted there is unknown to production APNs, and Expo's push service
      // answers every send to it with DeviceNotRegistered. Any EAS build
      // other than the development client signs with a profile that expects
      // production; a local prebuild keeps the sandbox.
      mode: apnsMode,
    }],
    "expo-background-task",
    ["expo-contacts", { contactsPermission: CONTACTS_PURPOSE }],
    // Both are autolinked, so without an entry here each would inject Apple's
    // own "would not pass review" template ("Allow $(PRODUCT_NAME) to use
    // Face ID", "... to access your microphone"). The picker only captures
    // still images (src/upload/pickers.ts, mediaTypes: ["images"]), so the
    // microphone string is dropped - and with it Android's RECORD_AUDIO.
    ["expo-image-picker", {
      photosPermission: PHOTO_LIBRARY_PURPOSE,
      cameraPermission: CAMERA_PURPOSE,
      microphonePermission: false,
    }],
    ["expo-local-authentication", { faceIDPermission: FACE_ID_PURPOSE }],
    ["expo-splash-screen", {
      image: "./assets/splash-icon.png",
      imageWidth: 200,
      resizeMode: "contain",
      backgroundColor: "#f3faff",
      dark: { backgroundColor: "#02080e" },
    }],
    // Gated - see carPlayEnabled at the top of this file.
    ...(carPlayEnabled ? ["./plugins/withCarPlay", "./plugins/withSiriPlayIntent"] : []),
    // Crash reporting (src/telemetry/sentry.ts). This plugin wires the native
    // SDKs and uploads source maps + debug symbols during the EAS build. The
    // org lives in Sentry's EU region (the DSN ingests at ingest.de.sentry.io),
    // so the CLI must talk to de.sentry.io, not sentry.io - the default would
    // 404 on the org. The upload needs SENTRY_AUTH_TOKEN in the build env (an
    // EAS secret, never in this file); without it the build still succeeds and
    // only symbolication is lost.
    ["@sentry/react-native/expo", {
      organization: "dosya-pty-ltd",
      project: "react-native",
      url: "https://de.sentry.io/",
    }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    distributionChannel,
    // RevenueCat public SDK keys, supplied as EAS environment variables. An
    // empty key means store billing is unavailable in this build.
    revenueCat: { ios: process.env.RC_IOS_KEY ?? "", android: process.env.RC_ANDROID_KEY ?? "" },
    eas: {
      projectId: "7052941c-3eb9-4cda-905a-7a1ba1118c7a",
      // EAS credential sync only reads the MAIN target's entitlements from
      // ios.entitlements - extension targets must be declared here or their
      // provisioning profiles get generated without the App Group capability
      // (the widget build then fails signing).
      build: {
        experimental: {
          ios: {
            appExtensions: [
              {
                targetName: "BackupWidget",
                bundleIdentifier: "dev.dosya.app.widget",
                entitlements: {
                  "com.apple.security.application-groups": ["group.dev.dosya.app"],
                },
              },
              {
                // The Files app location (targets/files-provider). The App Group
                // is also its keychain access group: the app writes the linked
                // session there and only this extension reads it.
                targetName: "FilesProvider",
                bundleIdentifier: "dev.dosya.app.files-provider",
                entitlements: {
                  "com.apple.security.application-groups": ["group.dev.dosya.app"],
                },
              },
            ],
          },
        },
      },
    },
  },
};

export default config;
