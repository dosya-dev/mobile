import { Alert, I18nManager } from "react-native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { reloadAppAsync } from "expo";
import { LOCALES, LOCALE_LABELS } from "@/i18n/locales";
import { I18nProvider, __resetI18nForTests, bootI18n, confirmDirectionSwitch, currentLocale, t } from "@/lib/i18n";
import { renderInLocale } from "../test-utils/i18n-sweep";
import LanguageScreen from "./language";

jest.mock("expo-router", () => require("../test-utils/i18n-sweep").routerMockWithTitles());

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
jest.mock("@/lib/keychain", () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItem: (...a: unknown[]) => mockSetItem(...a),
}));
const mockGetLocales = jest.fn(() => [{ languageTag: "en-US" }]);
jest.mock("expo-localization", () => ({ getLocales: () => mockGetLocales() }));

// The real confirmDirectionSwitch, watched.
jest.mock("@/lib/i18n", () => {
  const actual = jest.requireActual("@/lib/i18n");
  return { ...actual, confirmDirectionSwitch: jest.fn((p: unknown) => actual.confirmDirectionSwitch(p)) };
});

beforeEach(() => {
  __resetI18nForTests();
  mockGetItem.mockReset().mockResolvedValue(null);
  mockSetItem.mockReset().mockResolvedValue(undefined);
  mockGetLocales.mockReturnValue([{ languageTag: "en-US" }]);
});

const rowLabels = () =>
  screen
    .getAllByRole("button")
    .map((b) => within(b).getAllByText(/./)[0].props.children as string);

describe("language picker", () => {
  it("lists Device language, then every shipped language in its own name", async () => {
    await renderInLocale(<LanguageScreen />, "en");
    expect(rowLabels()).toEqual(["Device language", ...LOCALES.map((l) => LOCALE_LABELS[l])]);
  });

  it("lists Arabic, Hebrew and Persian in their own names", async () => {
    await renderInLocale(<LanguageScreen />, "en");
    for (const l of ["ar", "he", "fa"]) expect(screen.getByTestId(`language-${l}`)).toBeTruthy();
    expect(screen.getByText("العربية")).toBeTruthy();
    expect(screen.getByText("עברית")).toBeTruthy();
    expect(screen.getByText("فارسی")).toBeTruthy();
    expect(screen.queryByTestId("language-ur")).toBeNull();
  });

  it("marks the current choice as selected", async () => {
    // renderInLocale starts with an explicit choice equal to the locale.
    await renderInLocale(<LanguageScreen />, "en");
    expect(screen.getByTestId("language-en").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("language-device").props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId("language-de").props.accessibilityState.selected).toBe(false);
  });

  it("marks Device language when the choice is device", async () => {
    const boot = await bootI18n();
    render(
      <I18nProvider initial={boot}>
        <LanguageScreen />
      </I18nProvider>,
    );
    expect(screen.getByTestId("language-device").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("language-en").props.accessibilityState.selected).toBe(false);
  });

  it("switches in place when Deutsch is pressed", async () => {
    await renderInLocale(<LanguageScreen />, "en");
    expect(screen.getByTestId("screen-title").props.children).toBe("Language");
    await act(async () => {
      fireEvent.press(screen.getByTestId("language-de"));
    });
    expect(currentLocale()).toBe("de");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "de");
    expect(screen.getByTestId("screen-title").props.children).toBe("Sprache");
    expect(screen.getByTestId("language-de").props.accessibilityState.selected).toBe(true);
    expect(screen.getByText("Gerätesprache")).toBeTruthy();
  });

  it("pressing Device language stores device", async () => {
    await renderInLocale(<LanguageScreen />, "tr");
    await act(async () => {
      fireEvent.press(screen.getByTestId("language-device"));
    });
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "device");
  });

  it("has no English left over in Turkish", async () => {
    const view = await renderInLocale(<LanguageScreen />, "tr");
    expect(view.leftover()).toEqual([]);
  });
});

describe("switching to the other direction", () => {
  type Button = { text?: string; style?: string; onPress?: () => void };
  const reload = reloadAppAsync as jest.Mock;
  const confirm = confirmDirectionSwitch as jest.Mock;
  let alert: jest.SpyInstance;
  const FSI = "\u2068";
  const PDI = "\u2069";

  beforeEach(() => {
    reload.mockReset().mockResolvedValue(undefined);
    confirm.mockClear();
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => {});
    jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => {});
    jest.spyOn(I18nManager, "swapLeftAndRightInRTL").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const call = (i: number) => {
    const [title, message, buttons] = alert.mock.calls[i] as [string, string, Button[] | undefined];
    return { title, message, buttons: buttons ?? [] };
  };
  const press = async (id: string) => {
    await act(async () => {
      fireEvent.press(screen.getByTestId(id));
    });
  };
  const pressButton = async (i: number, label: string) => {
    const b = call(i).buttons.find((x) => x.text === label);
    if (!b) throw new Error(`no ${label} button`);
    await act(async () => {
      b.onPress?.();
    });
  };
  const storedLocale = () => mockSetItem.mock.calls.filter(([k]) => k === "dosya.locale");

  it("Deutsch to Türkçe switches in place with no prompt", async () => {
    await renderInLocale(<LanguageScreen />, "de");
    await press("language-tr");
    expect(alert).not.toHaveBeenCalled();
    expect(currentLocale()).toBe("tr");
  });

  it("Deutsch to עברית asks first, in German, and changes nothing yet", async () => {
    await renderInLocale(<LanguageScreen />, "de");
    await press("language-he");
    expect(alert).toHaveBeenCalledTimes(1);
    const { title, message, buttons } = call(0);
    expect(title).toBe(t("appearance.heading.restartToChangeLanguage"));
    expect(title).not.toBe("Restart dosya.dev?");
    expect(message).toContain("עברית");
    expect(message).toContain("von rechts nach links");
    expect(buttons.map((b) => b.text)).toEqual([t("common.cancel"), t("appearance.action.restart")]);
    expect(currentLocale()).toBe("de");
    expect(storedLocale()).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("in English the body says right to left", async () => {
    await renderInLocale(<LanguageScreen />, "en");
    await press("language-he");
    expect(call(0).message).toBe("\u2068עברית\u2069 is written right to left. dosya.dev restarts to change the layout.");
  });

  it("Restart confirms the switch to Hebrew and reloads", async () => {
    await renderInLocale(<LanguageScreen />, "de");
    await press("language-he");
    await pressButton(0, t("appearance.action.restart"));
    expect(confirm).toHaveBeenCalledWith("he");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "he");
    expect(reload).toHaveBeenCalledTimes(1);
    // The reload takes the text with it; nothing is applied here.
    expect(currentLocale()).toBe("de");
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("Cancel keeps Deutsch", async () => {
    await renderInLocale(<LanguageScreen />, "de");
    await press("language-he");
    await pressButton(0, t("common.cancel"));
    expect(currentLocale()).toBe("de");
    expect(confirm).not.toHaveBeenCalled();
    expect(storedLocale()).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("Device language on a Persian phone, from English, asks first", async () => {
    mockGetLocales.mockReturnValue([{ languageTag: "fa-IR" }]);
    await renderInLocale(<LanguageScreen />, "en");
    await press("language-device");
    expect(alert).toHaveBeenCalledTimes(1);
    expect(call(0).message).toBe("\u2068فارسی\u2069 is written right to left. dosya.dev restarts to change the layout.");
    expect(currentLocale()).toBe("en");
    expect(storedLocale()).toEqual([]);
    await pressButton(0, "Restart");
    expect(confirm).toHaveBeenCalledWith("device");
    expect(mockSetItem).toHaveBeenCalledWith("dosya.locale", "device");
  });

  it("in Arabic, English selects the left to right branch (the selector is not isolated)", async () => {
    await renderInLocale(<LanguageScreen />, "ar");
    await press("language-en");
    const { title, message } = call(0);
    expect(title).toBe(t("appearance.heading.restartToChangeLanguage"));
    expect(message).toContain(`${FSI}English${PDI}`);
    expect(message).toContain("من اليسار إلى اليمين");
    expect(message).not.toContain("من اليمين إلى اليسار");
  });

  it("a reload that cannot happen applies Hebrew in place and says to reopen the app", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    reload.mockRejectedValue(new Error("no reload"));
    await renderInLocale(<LanguageScreen />, "de");
    await press("language-he");
    await pressButton(0, t("appearance.action.restart"));
    expect(currentLocale()).toBe("he");
    expect(alert).toHaveBeenCalledTimes(2);
    const reopen = t("appearance.description.reopenToFinishLanguageChange");
    expect(reopen).not.toBe("Close and reopen dosya.dev to finish changing the language.");
    expect(call(1).message).toBe(reopen);
  });
});
