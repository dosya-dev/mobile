import { AppState, Text } from "react-native";
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import { Stack, Tabs } from "expo-router";
import { __setLayoutRtlForTests } from "./direction";
import { ActionSheet } from "@/ui/ActionSheet";
import {
  I18nProvider,
  __resetI18nForTests,
  bootI18n,
  currentLocale,
  ensureI18n,
  confirmDirectionSwitch,
  loadMessages,
  onLocaleChange,
  requestPreference,
  rtlLine,
  stripBidi,
  t,
  useLocale,
  useT,
} from "./i18n";

jest.mock("expo-router", () => require("../../test-utils/i18n-sweep").routerMockWithTitles());

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock("@/lib/keychain", () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItem: (...a: unknown[]) => mockSetItem(...a),
}));

// Lets a test hold a language load open (or fail it); other languages load for real.
const mockLoaderOverrides: Record<string, () => Promise<unknown>> = {};
jest.mock("@/i18n/loaders", () => {
  const actual = jest.requireActual("@/i18n/loaders");
  return {
    ...actual,
    LOADERS: new Proxy(actual.LOADERS, { get: (target, key: string) => mockLoaderOverrides[key] ?? target[key] }),
  };
});

const mockGetLocales = jest.fn();
jest.mock("expo-localization", () => ({ getLocales: () => mockGetLocales() }));

const device = (...tags: string[]) => mockGetLocales.mockReturnValue(tags.map((languageTag) => ({ languageTag })));

beforeEach(() => {
  for (const k of Object.keys(mockLoaderOverrides)) delete mockLoaderOverrides[k];
  __resetI18nForTests();
  mockGetItem.mockReset().mockResolvedValue(null);
  mockSetItem.mockReset().mockResolvedValue(undefined);
  mockGetLocales.mockReset();
  device("en-US");
});

describe("boot", () => {
  it("follows the device when the choice is device", async () => {
    mockGetItem.mockResolvedValue("device");
    device("tr-TR");
    const b = await bootI18n();
    expect(b.locale).toBe("tr");
    expect(b.preference).toBe("device");
    expect(b.messages["common.cancel"]).toBe("İptal");
  });

  it("starts in a stored language whatever the device says", async () => {
    mockGetItem.mockResolvedValue("de");
    device("tr-TR");
    const b = await bootI18n();
    expect(b.locale).toBe("de");
    expect(b.preference).toBe("de");
  });

  it("falls back to the device match for a stored language that is not shipped", async () => {
    mockGetItem.mockResolvedValue("ur");
    device("tr-TR");
    const b = await bootI18n();
    expect(b.locale).toBe("tr");
    expect(b.preference).toBe("device");
  });

  it("an Arabic device starts in Arabic; an unsupported RTL device (ur) in English", async () => {
    device("ur-PK");
    expect((await bootI18n()).locale).toBe("en");
    device("ar-SA");
    expect((await bootI18n()).locale).toBe("ar");
  });

  it("never rejects, even when the phone's language list throws", async () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error("native");
    });
    await expect(bootI18n()).resolves.toMatchObject({ locale: "en", preference: "device" });
  });

  it("the provider applies the boot result before its children render", async () => {
    mockGetItem.mockResolvedValue("tr");
    const boot = await bootI18n();
    const seen: string[] = [];
    function Probe() {
      const tt = useT();
      seen.push(tt("common.cancel"));
      return <Text>{tt("common.cancel")}</Text>;
    }
    render(
      <I18nProvider initial={boot}>
        <Probe />
      </I18nProvider>,
    );
    expect(seen).toEqual(["İptal"]);
  });
});

describe("switch in place", () => {
  function Probe() {
    const tt = useT();
    const { setPreference } = useLocale();
    probe.setPreference = setPreference;
    return (
      <>
        <Stack.Screen options={{ title: tt("appearance.label.language") }} />
        <Tabs.Screen options={{ tabBarLabel: tt("common.label.system") }} />
        <ActionSheet visible onClose={() => {}} actions={[{ label: tt("common.cancel"), onPress: () => {} }]} />
      </>
    );
  }
  const probe: { setPreference: (p: "device" | "tr") => Promise<void> } = { setPreference: async () => {} };

  it("changes header title, tab label and an open sheet without remounting", async () => {
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getAllByTestId("screen-title").map((n) => n.props.children)).toEqual(["Language", "System"]);
    expect(screen.getByText("Cancel")).toBeTruthy();

    const heard: string[] = [];
    const off = onLocaleChange((l) => heard.push(l));
    await act(async () => {
      await probe.setPreference("tr");
    });
    expect(screen.getAllByTestId("screen-title").map((n) => n.props.children)).toEqual(["Dil", "Sistem"]);
    expect(screen.getByText("İptal")).toBeTruthy();
    expect(screen.queryByText("Cancel")).toBeNull();
    expect(heard).toEqual(["tr"]);
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "tr");
    off();
  });

  it("does not report a locale change when only the preference changed", async () => {
    device("tr-TR");
    mockGetItem.mockResolvedValue("tr");
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <Probe />
      </I18nProvider>,
    );
    const heard: string[] = [];
    onLocaleChange((l) => heard.push(l));
    await act(async () => {
      await probe.setPreference("device");
    });
    expect(heard).toEqual([]);
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "device");
  });

  it("ignores a value that is not a shipped language", async () => {
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <Probe />
      </I18nProvider>,
    );
    await act(async () => {
      await (probe.setPreference as (p: string) => Promise<void>)("xx");
    });
    expect(currentLocale()).toBe("en");
    expect(mockSetItem).not.toHaveBeenCalled();
  });
});

describe("ensureI18n", () => {
  it("makes the module t speak the stored language with no provider mounted", async () => {
    mockGetItem.mockResolvedValue("tr");
    expect(t("common.cancel")).toBe("Cancel");
    await ensureI18n();
    expect(t("common.cancel")).toBe("İptal");
    expect(currentLocale()).toBe("tr");
  });

  it("reads the keychain once however often it is called", async () => {
    mockGetItem.mockResolvedValue("tr");
    await Promise.all([ensureI18n(), ensureI18n()]);
    await ensureI18n();
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });

  it("ends in the device match when the keychain throws", async () => {
    mockGetItem.mockRejectedValue(new Error("User interaction is not allowed"));
    device("tr-TR");
    await ensureI18n();
    expect(t("common.cancel")).toBe("İptal");
  });

  it("ends in English when the device language cannot be read either", async () => {
    mockGetItem.mockRejectedValue(new Error("locked"));
    mockGetLocales.mockImplementation(() => {
      throw new Error("native");
    });
    await expect(ensureI18n()).resolves.toBeUndefined();
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("does nothing once a provider has booted the language", async () => {
    mockGetItem.mockResolvedValue("de");
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <Text>x</Text>
      </I18nProvider>,
    );
    mockGetItem.mockClear();
    await ensureI18n();
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(currentLocale()).toBe("de");
  });
});

describe("device follows on foreground", () => {
  let handler: ((s: string) => void) | undefined;
  let removed = 0;
  beforeEach(() => {
    handler = undefined;
    removed = 0;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove: () => removed++ };
    }) as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("switches to the new device language while the choice is device", async () => {
    device("de-DE");
    const boot = await bootI18n();
    const view = render(
      <I18nProvider initial={boot}>
        <Text>x</Text>
      </I18nProvider>,
    );
    expect(currentLocale()).toBe("de");
    device("tr-TR");
    await act(async () => {
      handler?.("active");
    });
    await waitFor(() => expect(currentLocale()).toBe("tr"));
    view.unmount();
    expect(removed).toBe(1);
  });

  it("stays German when the choice is German", async () => {
    mockGetItem.mockResolvedValue("de");
    device("de-DE");
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <Text>x</Text>
      </I18nProvider>,
    );
    device("tr-TR");
    await act(async () => {
      handler?.("active");
    });
    expect(currentLocale()).toBe("de");
  });

  it("ignores background and inactive changes", async () => {
    device("de-DE");
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <Text>x</Text>
      </I18nProvider>,
    );
    device("tr-TR");
    await act(async () => {
      handler?.("background");
      handler?.("inactive");
    });
    expect(currentLocale()).toBe("de");
  });
});

describe("racing switches", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };
  const real = (l: "tr" | "de") => ({ default: jest.requireActual(`@/i18n/messages/${l}.json`) });

  function mountProbe() {
    let api!: ReturnType<typeof useLocale>;
    function Probe() {
      api = useLocale();
      return null;
    }
    return bootI18n().then((boot) => {
      render(
        <I18nProvider initial={boot}>
          <Probe />
        </I18nProvider>,
      );
      return () => api;
    });
  }

  it("ends on de when a slower tr load resolves after de, and stays de", async () => {
    const tr = deferred<unknown>();
    mockLoaderOverrides.tr = () => tr.promise;
    const get = await mountProbe();
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = get().setPreference("tr");
      second = get().setPreference("de");
      await second;
    });
    expect(currentLocale()).toBe("de");
    await act(async () => {
      tr.resolve(real("tr"));
      await first;
    });
    expect(currentLocale()).toBe("de");
    expect(t("common.cancel")).toBe(jest.requireActual("@/i18n/messages/de.json")["common.cancel"]);
    expect(get().preference).toBe("de");
    // Only the winner is remembered; the stale tr never wrote.
    expect(mockSetItem.mock.calls.map((c) => c[1])).toEqual(["de"]);
  });

  it("keeps the previous language, stores nothing and does not throw when a load rejects", async () => {
    mockLoaderOverrides.tr = () => Promise.reject(new Error("chunk missing"));
    const get = await mountProbe();
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      await expect(get().setPreference("tr")).resolves.toBeUndefined();
    });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
    expect(currentLocale()).toBe("en");
    expect(get().preference).toBe("device");
    expect(mockSetItem).not.toHaveBeenCalled();
    // The failed request no longer blocks a later one.
    delete mockLoaderOverrides.tr;
    await act(async () => {
      await get().setPreference("tr");
    });
    expect(currentLocale()).toBe("tr");
  });

  it("an explicit pick beats a foreground re-resolve that is still loading", async () => {
    let handler: ((s: string) => void) | undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove: () => {} };
    }) as never);
    device("en-US");
    const tr = deferred<unknown>();
    mockLoaderOverrides.tr = () => tr.promise;
    const get = await mountProbe();
    expect(currentLocale()).toBe("en");

    device("tr-TR");
    await act(async () => {
      handler?.("active"); // follows the device to tr, load held open
    });
    await act(async () => {
      await get().setPreference("de"); // explicit pick lands meanwhile
    });
    expect(currentLocale()).toBe("de");
    await act(async () => {
      tr.resolve(real("tr"));
      await Promise.resolve();
    });
    expect(currentLocale()).toBe("de");
    expect(get().preference).toBe("de");
    jest.restoreAllMocks();
  });
});

const FSI = "\u2068";
const PDI = "\u2069";
const HAS_ERRORS = "report-problem.label.haserrorsSelectTrueFailedFailedHasSkippedSelectTrueSkippedSkippedOtherOtherSkippedSkipped";
const ENTRY_PLURAL = "archive.label.entrycountPluralOneEntryOtherEntries";
const FOLDER_COUNT = "archive.label.foldernameCountPluralOneFileOtherFiles";
const ON_BEHALF = "activity.label.onBehalfOfName";

/** Starts the store in `locale` through the provider, as the root layout does. */
async function startIn(locale: "en" | "de" | "ar" | "he" | "fa", overrides?: Record<string, string | undefined>) {
  const messages = { ...(await loadMessages(locale)) } as Record<string, string>;
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (v === undefined) delete messages[k];
    else messages[k] = v;
  }
  __setLayoutRtlForTests(locale === "ar" || locale === "he" || locale === "fa");
  render(<I18nProvider initial={{ locale, preference: locale, messages }}>{null}</I18nProvider>);
}

describe("direction", () => {
  const reload = reloadAppAsync as jest.Mock;
  const keychain = (stored: string | null) =>
    mockGetItem.mockImplementation(async (key: string) => (key === "dosya.locale" ? stored : null));

  beforeEach(() => {
    reload.mockClear().mockResolvedValue(undefined);
    mockGetItem.mockImplementation(async () => null);
  });

  it("ensureI18n with a stored Persian choice never reloads and never touches the native flags", async () => {
    const allow = jest.spyOn(I18nManager, "allowRTL");
    const force = jest.spyOn(I18nManager, "forceRTL");
    keychain("fa");
    await ensureI18n();
    expect(currentLocale()).toBe("fa");
    expect(reload).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
    expect(force).not.toHaveBeenCalled();
    allow.mockRestore();
    force.mockRestore();
  });

  it("requestPreference into the other direction applies and stores nothing", async () => {
    await startIn("de");
    await expect(requestPreference("he")).resolves.toEqual({ kind: "restart", locale: "he" });
    expect(currentLocale()).toBe("de");
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("requestPreference within the direction switches in place", async () => {
    await startIn("de");
    await expect(requestPreference("tr")).resolves.toEqual({ kind: "applied" });
    expect(currentLocale()).toBe("tr");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "tr");
  });

  it("requestPreference between two RTL languages is instant", async () => {
    await startIn("ar");
    await expect(requestPreference("he")).resolves.toEqual({ kind: "applied" });
    expect(currentLocale()).toBe("he");
  });

  it("device language on a Persian phone, from English, asks first", async () => {
    await startIn("en");
    device("fa-IR");
    await expect(requestPreference("device")).resolves.toEqual({ kind: "restart", locale: "fa" });
    expect(currentLocale()).toBe("en");
  });

  it("an unchanged or unknown pick does nothing", async () => {
    await startIn("de");
    await expect(requestPreference("de")).resolves.toEqual({ kind: "unchanged" });
    await expect(requestPreference("xx" as never)).resolves.toEqual({ kind: "unchanged" });
  });

  it("followDevice from de to ar keeps de; to the same direction it switches", async () => {
    device("ar-SA");
    let handler!: (s: string) => void;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, h: (s: string) => void) => {
      handler = h;
      return { remove: () => {} };
    }) as never);
    render(<I18nProvider initial={{ locale: "de", preference: "device", messages: await loadMessages("de") }}>{null}</I18nProvider>);
    await act(async () => handler("active"));
    expect(currentLocale()).toBe("de");
    device("tr-TR");
    await act(async () => handler("active"));
    await waitFor(() => expect(currentLocale()).toBe("tr"));
    jest.restoreAllMocks();
  });

  it("confirmDirectionSwitch stores the choice, sets the flags, reloads and leaves the text alone", async () => {
    await startIn("de");
    const force = jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});
    jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {});
    jest.spyOn(I18nManager, "swapLeftAndRightInRTL").mockImplementation(() => {});
    await expect(confirmDirectionSwitch("he")).resolves.toBe("reloading");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "he");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.directionReloadAt", expect.stringMatching(/^\d+:1$/));
    expect(force).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(currentLocale()).toBe("de");
    jest.restoreAllMocks();
  });

  it("a failed reload applies Hebrew in place", async () => {
    await startIn("de");
    jest.spyOn(console, "error").mockImplementation(() => {});
    reload.mockRejectedValue(new Error("no reload"));
    await expect(confirmDirectionSwitch("he")).resolves.toBe("applied-in-place");
    expect(currentLocale()).toBe("he");
    jest.restoreAllMocks();
  });

  it("a guarded reload applies the language in place too", async () => {
    await startIn("de");
    jest.spyOn(console, "error").mockImplementation(() => {});
    // A stamp from a second ago: one made at read time can land a millisecond
    // after the guard's own clock read, which the guard rightly ignores.
    mockGetItem.mockImplementation(async (key: string) => (key === "dosya.directionReloadAt" ? `${Date.now() - 1000}:1` : null));
    await expect(confirmDirectionSwitch("ar")).resolves.toBe("applied-in-place");
    expect(reload).not.toHaveBeenCalled();
    expect(currentLocale()).toBe("ar");
    jest.restoreAllMocks();
  });
});

describe("isolation", () => {
  it("wraps a plain string value in an RTL language", async () => {
    await startIn("ar");
    expect(t("archive.action.saveNameToDosya", { name: "report (1).pdf" })).toContain(`${FSI}report (1).pdf${PDI}`);
  });

  it("never wraps the value that selects a branch, and wraps the plain ones around it", async () => {
    await startIn("ar");
    const out = t(HAS_ERRORS, { hasErrors: "true", failed: "a.txt", hasSkipped: "true", skipped: "b.txt" });
    expect(out).toContain(`${FSI}a.txt${PDI}`);
    expect(out).toContain(`${FSI}b.txt${PDI}`);
    // The true branch ("تعذر") rendered, not the "other" one ("تم تخطي" alone).
    expect(out.startsWith("تعذر")).toBe(true);
    const other = t(HAS_ERRORS, { hasErrors: "false", failed: "a.txt", hasSkipped: "false", skipped: "b.txt" });
    expect(other.startsWith("تم تخطي")).toBe(true);
  });

  it("renders the right plural category and leaves numbers alone", async () => {
    await startIn("ar");
    expect(t(ENTRY_PLURAL, { entryCount: 2 })).toBe("عنصران");
    expect(t(ENTRY_PLURAL, { entryCount: 3 })).toBe("3 عناصر");
    expect(t(FOLDER_COUNT, { folderName: "x", count: 1 })).toContain(`${FSI}x${PDI}`);
    expect(t(FOLDER_COUNT, { folderName: "x", count: 1 })).not.toContain(`${FSI}1${PDI}`);
  });

  it("does not wrap empty strings or the no-values call, and does not double wrap", async () => {
    await startIn("ar");
    expect(t("archive.action.saveNameToDosya", { name: "" })).not.toContain(FSI);
    expect(t("archive.action.saveNameToDosya", { name: `${FSI}a${PDI}` })).toContain(`${FSI}a${PDI}`);
    expect(t("archive.action.saveNameToDosya", { name: `${FSI}a${PDI}` }).split(FSI).length).toBe(2);
  });

  it("Hebrew and Persian isolate the same way", async () => {
    await startIn("he");
    expect(t("archive.action.saveNameToDosya", { name: "a.txt" })).toContain(`${FSI}a.txt${PDI}`);
    await startIn("fa");
    expect(t("archive.action.saveNameToDosya", { name: "a.txt" })).toContain(`${FSI}a.txt${PDI}`);
  });

  it("left-to-right languages are character for character what they were", async () => {
    await startIn("en");
    expect(t("archive.action.saveNameToDosya", { name: "report (1).pdf" })).toBe("Save report (1).pdf to dosya");
    await startIn("de");
    expect(t("archive.action.saveNameToDosya", { name: "a.txt" })).not.toMatch(/[\u2066-\u2069]/);
  });

  it("a missing translation falls back to English and obeys the same rule", async () => {
    await startIn("ar", { [ON_BEHALF]: undefined, [HAS_ERRORS]: undefined });
    expect(t(ON_BEHALF, { name: "Sam" })).toBe(`\u200Fon behalf of ${FSI}Sam${PDI}`);
    const out = t(HAS_ERRORS, { hasErrors: "true", failed: "a.txt", hasSkipped: "false", skipped: "b" });
    expect(out).toContain(`${FSI}a.txt${PDI}`);
    expect(out).toContain("failed");
  });

  it("stripBidi removes marks, embeddings, overrides and isolates only", () => {
    expect(stripBidi(`${FSI}a${PDI}`)).toBe("a");
    expect(stripBidi("\u200Eb\u200F\u202Ac\u202Ed\u2066e\u2069")).toBe("bcde");
    expect(stripBidi("مرحبا report (1).pdf")).toBe("مرحبا report (1).pdf");
  });
});

describe("right-to-left base for Latin-led lines", () => {
  const RLM = "\u200F";
  const WIFI = "backup.label.wiFiOnly"; // ar "Wi-Fi فقط", he "Wi-Fi בלבד"
  const STORAGE = "workspace-settings.label.usedOfTotalUsedPercent"; // ar "{used} من {total} مستخدم ({percent}%)"

  it("a message whose first strong letter is Latin starts with RLM in ar, he and fa", async () => {
    await startIn("ar");
    expect(t(WIFI)).toBe(`${RLM}Wi-Fi فقط`);
    await startIn("he");
    expect(t(WIFI).startsWith(RLM)).toBe(true);
  });

  it("a Latin value in front of Arabic words gets RLM too (iOS reads through isolates)", async () => {
    await startIn("ar");
    const out = t(STORAGE, { used: "194.0 MB", total: "1.0 TB", percent: "0" });
    expect(out.startsWith(RLM)).toBe(true);
    expect(stripBidi(out)).toBe("194.0 MB من 1.0 TB مستخدم (0%)");
  });

  it("an Arabic-led message is left alone", async () => {
    await startIn("ar");
    expect(t(ENTRY_PLURAL, { entryCount: 2 })).toBe("عنصران");
    expect(t("archive.action.saveNameToDosya", { name: "a.txt" }).startsWith(RLM)).toBe(false);
  });

  it("left-to-right languages get no mark", async () => {
    await startIn("en");
    expect(t(WIFI)).toBe("Wi-Fi only");
    expect(t(STORAGE, { used: "1 MB", total: "2 MB", percent: "50" })).toBe("1 MB of 2 MB used (50%)");
    await startIn("de");
    expect(t(WIFI)).not.toMatch(/\u200F/);
  });

  it("rtlLine marks composed Latin-led lines in RTL only", async () => {
    await startIn("ar");
    expect(rtlLine("193 B · 22 أكتوبر، 2026")).toBe(`${RLM}193 B${RLM} · ${RLM}22 أكتوبر، 2026`);
    expect(rtlLine("أكتوبر · 193 B")).toBe(`أكتوبر${RLM} · ${RLM}193 B`);
    expect(rtlLine("")).toBe("");
    expect(rtlLine(`${RLM}a`)).toBe(`${RLM}a`);
    await startIn("en");
    expect(rtlLine("193 B · Oct 22, 2026")).toBe("193 B · Oct 22, 2026");
  });

  // On device (iPhone 17, ar) "193 B · 22 أكتوبر، 2026" with only a leading
  // RLM read "193 22 · B أكتوبر": the 22 after "B ·" took the Latin direction
  // (a number after a Latin letter does, rule W7), so "B · 22" ran left to
  // right. An RLM on each side of every separator keeps each part in place.
  it("rtlLine keeps a number after a separator out of the Latin part before it", async () => {
    await startIn("he");
    expect(rtlLine("166 B · ZIP · 22 באוק׳ 2026")).toBe(`${RLM}166 B${RLM} · ${RLM}ZIP${RLM} · ${RLM}22 באוק׳ 2026`);
    await startIn("de");
    expect(rtlLine("166 B · ZIP · 22. Okt. 2026")).toBe("166 B · ZIP · 22. Okt. 2026");
  });
});
