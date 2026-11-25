/**
 * The CarPlay and Siri config plugins add entitlements
 * (com.apple.developer.carplay-audio, com.apple.developer.siri) that a
 * provisioning profile must carry, or Xcode refuses to sign. CarPlay is a
 * restricted entitlement Apple grants per app on request - EAS cannot enable it
 * on the App ID (it is absent from eas-cli's capability list), so until Apple
 * approves it every store build fails at signing before compiling a single
 * file. That is exactly how EAS build 15 died on 2026-09-04.
 *
 * Both plugins therefore stay out of the config unless DOSYA_CARPLAY=1 is set
 * for the build. Siri rides on the same flag: the voice search was built for
 * CarPlay, and enabling it alone still needs an interactive Apple login for the
 * capability sync that a --non-interactive build never performs.
 */
const CARPLAY_PLUGINS = ["./plugins/withCarPlay", "./plugins/withSiriPlayIntent"];

function loadConfig(carPlay: string | undefined, distChannel?: string | undefined) {
  const previous = process.env.DOSYA_CARPLAY;
  const previousChannel = process.env.DOSYA_DIST_CHANNEL;
  if (carPlay === undefined) delete process.env.DOSYA_CARPLAY;
  else process.env.DOSYA_CARPLAY = carPlay;
  if (distChannel === undefined) delete process.env.DOSYA_DIST_CHANNEL;
  else process.env.DOSYA_DIST_CHANNEL = distChannel;
  try {
    let config: { plugins?: unknown[]; extra?: { distributionChannel?: string } } = {};
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh evaluation per env
      config = require("./app.config").default;
    });
    return config;
  } finally {
    if (previous === undefined) delete process.env.DOSYA_CARPLAY;
    else process.env.DOSYA_CARPLAY = previous;
    if (previousChannel === undefined) delete process.env.DOSYA_DIST_CHANNEL;
    else process.env.DOSYA_DIST_CHANNEL = previousChannel;
  }
}

function pluginNames(config: { plugins?: unknown[] }): string[] {
  return (config.plugins ?? []).map((p) => (Array.isArray(p) ? String(p[0]) : String(p)));
}

describe("CarPlay + Siri plugin gate", () => {
  it("leaves both plugins out of a build by default", () => {
    const names = pluginNames(loadConfig(undefined));
    for (const plugin of CARPLAY_PLUGINS) expect(names).not.toContain(plugin);
  });

  it("treats anything other than exactly '1' as off", () => {
    // A stray "true"/"yes" in an env file must not re-introduce entitlements
    // that break signing; the flag is a deliberate, exact switch.
    for (const value of ["0", "", "true", "yes"]) {
      const names = pluginNames(loadConfig(value));
      for (const plugin of CARPLAY_PLUGINS) expect(names).not.toContain(plugin);
    }
  });

  it("includes both plugins when DOSYA_CARPLAY=1", () => {
    const names = pluginNames(loadConfig("1"));
    for (const plugin of CARPLAY_PLUGINS) expect(names).toContain(plugin);
  });

  it("always carries the Sentry plugin, pointed at the EU-region org", () => {
    // Source maps and debug symbols upload at build time through this plugin.
    // The org is EU-hosted (the DSN ingests at ingest.de.sentry.io); the
    // default sentry.io URL would make sentry-cli 404 on the org and the
    // build would ship without symbolication.
    for (const value of [undefined, "1"]) {
      const config = loadConfig(value);
      const entry = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === "@sentry/react-native/expo");
      expect(entry).toBeDefined();
      expect((entry as unknown[])[1]).toEqual({
        organization: "dosya-pty-ltd",
        project: "react-native",
        url: "https://de.sentry.io/",
      });
    }
  });

  it("keeps every other plugin regardless of the flag", () => {
    // The gate must be additive. Losing expo-router or the widget target
    // plugin would be a far worse regression than the one being avoided.
    for (const value of [undefined, "1"]) {
      const names = pluginNames(loadConfig(value));
      expect(names).toEqual(expect.arrayContaining(["expo-router", "@bacons/apple-targets", "expo-splash-screen"]));
    }
  });
});

/**
 * The failure modes here are not symmetric, which is why the default matters
 * more than the feature. A sideloaded build stuck on "play" just never offers
 * an update. A STORE build stuck on "direct" offers the user an APK that
 * Android refuses to install over it (Play App Signing re-signs the store
 * build with a key we do not hold, so the signatures differ), leaving a
 * permanent notice they cannot act on.
 */
describe("distribution channel", () => {
  it("defaults to the store channel when the env var is unset", () => {
    expect(loadConfig(undefined, undefined).extra?.distributionChannel).toBe("play");
  });

  it("is 'direct' only for an exact match", () => {
    expect(loadConfig(undefined, "direct").extra?.distributionChannel).toBe("direct");
  });

  it("treats every near-miss as the store channel", () => {
    // A typo or a half-set env var must land on the harmless side.
    for (const value of ["", "Direct", "DIRECT", "apk", "true", "1", "sideload"]) {
      expect(loadConfig(undefined, value).extra?.distributionChannel).toBe("play");
    }
  });

  it("does not disturb the CarPlay gate", () => {
    const names = pluginNames(loadConfig("1", "direct"));
    for (const plugin of CARPLAY_PLUGINS) expect(names).toContain(plugin);
  });
});

/**
 * Android push needs Firebase's google-services.json in the build. It is not
 * committed (see .gitignore), so the config reads it from the path EAS writes a
 * file environment variable to, or from a local copy - and leaves the key out
 * entirely when neither exists, so a build without FCM still succeeds.
 */
describe("Android push (FCM) config", () => {
  function loadWith(googleServicesJson: string | undefined) {
    const previous = process.env.GOOGLE_SERVICES_JSON;
    if (googleServicesJson === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = googleServicesJson;
    try {
      let config: { android?: { googleServicesFile?: string }; plugins?: unknown[] } = {};
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh evaluation per env
        config = require("./app.config").default;
      });
      return config;
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
      else process.env.GOOGLE_SERVICES_JSON = previous;
    }
  }

  it("uses the EAS file variable when set", () => {
    expect(loadWith("/tmp/eas/google-services.json").android?.googleServicesFile)
      .toBe("/tmp/eas/google-services.json");
  });

  it("falls back to a local copy, and leaves the key out when there is none", () => {
    // The file is gitignored, so whether a checkout has one is up to the
    // machine: assert the rule, not one machine's state.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- same probe the config uses
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    const local = existsSync(`${__dirname}/google-services.json`);
    const android = loadWith(undefined).android ?? {};
    if (local) expect(android.googleServicesFile).toBe("./google-services.json");
    else expect("googleServicesFile" in android).toBe(false);
  });

  it("points store and preview builds at production APNs, and local prebuilds at the sandbox", () => {
    const modeFor = (profile: string | undefined) => {
      const previous = process.env.EAS_BUILD_PROFILE;
      if (profile === undefined) delete process.env.EAS_BUILD_PROFILE;
      else process.env.EAS_BUILD_PROFILE = profile;
      try {
        const entry = (loadWith(undefined).plugins ?? []).find(
          (p) => Array.isArray(p) && p[0] === "expo-notifications",
        ) as [string, { mode?: string }] | undefined;
        return entry?.[1].mode;
      } finally {
        if (previous === undefined) delete process.env.EAS_BUILD_PROFILE;
        else process.env.EAS_BUILD_PROFILE = previous;
      }
    };
    expect(modeFor("production")).toBe("production");
    expect(modeFor("production-apk")).toBe("production");
    expect(modeFor("preview")).toBe("production");
    expect(modeFor("development")).toBe("development");
    expect(modeFor(undefined)).toBe("development");
  });

  it("gives Android a status-bar icon for notifications", () => {
    const entry = (loadWith(undefined).plugins ?? []).find(
      (p) => Array.isArray(p) && p[0] === "expo-notifications",
    ) as [string, { icon?: string; color?: string }] | undefined;
    expect(entry?.[1].icon).toBe("./assets/android-icon-monochrome.png");
    expect(entry?.[1].color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

/**
 * The marketing version lives in exactly one place - app.config.ts - and every
 * other copy in the repo is a mirror that must agree with it. package.json sat
 * at "0.0.1" while the store shipped 1.0.0 for months, which is what made the
 * version state impossible to read at a glance.
 *
 * Build numbers are deliberately NOT asserted here: eas.json sets
 * appVersionSource "remote", so EAS owns them and the literals in app.config.ts
 * are inert. Pinning them to a value would imply they mean something.
 */
describe("version", () => {
  const config = loadConfig(undefined) as { version?: string };

  it("is a bare semver triple", () => {
    // iOS rejects a CFBundleShortVersionString that is not up to three
    // dot-separated integers, and Android's versionName is free text but is
    // compared as a string by the sideload update check.
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("matches package.json, so the two cannot drift", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reading our own manifest
    const pkg = require("./package.json") as { version: string };
    expect(pkg.version).toBe(config.version);
  });
});

/**
 * App Review rejected 1.0.2 under guideline 5.1.1(ii): a purpose string must
 * say what the app does with the resource AND give a concrete example. Their
 * published fail cases are the bare "App needs microphone access" shape, which
 * is exactly what every Expo permission plugin injects when left unconfigured
 * ("Allow $(PRODUCT_NAME) to use Face ID"). Several plugins can write the same
 * key and a plugin's string beats infoPlist at prebuild, so this checks every
 * writer, not only infoPlist.
 */
describe("iOS purpose strings (App Review 5.1.1(ii))", () => {
  type Writer = { key: string; text: unknown };
  function purposeStrings(): Writer[] {
    const config = loadConfig(undefined) as {
      ios?: { infoPlist?: Record<string, unknown> };
      plugins?: unknown[];
    };
    const out: Writer[] = [];
    for (const [key, text] of Object.entries(config.ios?.infoPlist ?? {})) {
      if (/^NS.*UsageDescription$/.test(key)) out.push({ key: `infoPlist.${key}`, text });
    }
    for (const p of config.plugins ?? []) {
      if (!Array.isArray(p) || typeof p[1] !== "object" || p[1] === null) continue;
      for (const [opt, text] of Object.entries(p[1] as Record<string, unknown>)) {
        if (/Permission$/.test(opt)) out.push({ key: `${String(p[0])}.${opt}`, text });
      }
    }
    return out;
  }

  it("covers every permission the app asks for", () => {
    const keys = purposeStrings().map((w) => w.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "infoPlist.NSPhotoLibraryUsageDescription",
        "infoPlist.NSPhotoLibraryAddUsageDescription",
        "infoPlist.NSCameraUsageDescription",
        "infoPlist.NSFaceIDUsageDescription",
        "infoPlist.NSContactsUsageDescription",
        "expo-media-library.photosPermission",
        "expo-media-library.savePhotosPermission",
        "expo-image-picker.photosPermission",
        "expo-image-picker.cameraPermission",
        "expo-local-authentication.faceIDPermission",
        "expo-contacts.contactsPermission",
      ]),
    );
  });

  it("explains the use and gives an example in every string, never Apple's template", () => {
    for (const { key, text } of purposeStrings()) {
      if (text === false) continue; // a permission the app deliberately drops
      expect(typeof text).toBe("string");
      const s = text as string;
      expect(s).not.toMatch(/\$\(PRODUCT_NAME\)|^Allow /);
      expect(s).toMatch(/for example/i);
      expect(s).toMatch(/dosya\.dev/);
      expect(s.length).toBeGreaterThan(80);
    }
  });

  it("gives each Info.plist key one text, whichever plugin writes it", () => {
    const byKey = new Map<string, Set<string>>();
    const alias: Record<string, string> = {
      "infoPlist.NSPhotoLibraryUsageDescription": "photos",
      "expo-media-library.photosPermission": "photos",
      "expo-image-picker.photosPermission": "photos",
      "infoPlist.NSPhotoLibraryAddUsageDescription": "add",
      "expo-media-library.savePhotosPermission": "add",
      "infoPlist.NSCameraUsageDescription": "camera",
      "expo-image-picker.cameraPermission": "camera",
      "infoPlist.NSFaceIDUsageDescription": "faceid",
      "expo-local-authentication.faceIDPermission": "faceid",
      "infoPlist.NSContactsUsageDescription": "contacts",
      "expo-contacts.contactsPermission": "contacts",
    };
    for (const { key, text } of purposeStrings()) {
      const group = alias[key];
      if (!group || typeof text !== "string") continue;
      if (!byKey.has(group)) byKey.set(group, new Set());
      byKey.get(group)!.add(text);
    }
    for (const [group, texts] of byKey) expect({ group, variants: texts.size }).toEqual({ group, variants: 1 });
  });

  it("drops the microphone string: the picker captures still images only", () => {
    const picker = purposeStrings().find((w) => w.key === "expo-image-picker.microphonePermission");
    expect(picker?.text).toBe(false);
  });
});

describe("iOS associated domains", () => {
  it("keeps the TV app link and adds passkeys for the RP ID", () => {
    const { ios } = loadConfig(undefined) as { ios?: { associatedDomains?: string[] } };
    expect(ios?.associatedDomains).toEqual(["applinks:app.dosya.dev", "webcredentials:app.dosya.dev"]);
  });
});
