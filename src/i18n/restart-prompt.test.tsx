import { Alert, View } from "react-native";
import { __resetI18nForTests } from "@/lib/i18n";
import { renderInLocale } from "../../test-utils/i18n-sweep";
import { showRestartPrompt } from "./restart-prompt";

jest.mock("@/lib/keychain", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));

type Button = { text?: string; style?: string; onPress?: () => void };

let alert: jest.SpyInstance;
beforeEach(() => {
  __resetI18nForTests();
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

const lastCall = () => {
  const [title, message, buttons] = alert.mock.calls[alert.mock.calls.length - 1] as [string, string, Button[]];
  return { title, message, buttons };
};

describe("showRestartPrompt", () => {
  it("asks in the current language, naming the target in its own name and its direction", async () => {
    await renderInLocale(<View />, "en");
    showRestartPrompt("he", () => {});
    const { title, message } = lastCall();
    expect(title).toBe("Restart dosya.dev?");
    // The name is isolated in every language: a Hebrew name first in an English
    // sentence otherwise makes the whole alert a right-to-left paragraph (seen on
    // the simulator in Turkish).
    expect(message).toBe("\u2068עברית\u2069 is written right to left. dosya.dev restarts to change the layout.");
  });

  it("selects the left to right branch for an LTR target", async () => {
    await renderInLocale(<View />, "en");
    showRestartPrompt("de", () => {});
    expect(lastCall().message).toBe("\u2068Deutsch\u2069 is written left to right. dosya.dev restarts to change the layout.");
  });

  it("isolates the name exactly once in a right-to-left language", async () => {
    await renderInLocale(<View />, "ar");
    showRestartPrompt("en", () => {});
    const m = lastCall().message;
    expect(m.match(/\u2068/g)).toHaveLength(1);
    expect(m).toContain("\u2068English\u2069");
  });

  it("puts Cancel first, then Restart in the default style", async () => {
    await renderInLocale(<View />, "en");
    showRestartPrompt("ar", () => {});
    const { buttons } = lastCall();
    expect(buttons.map((b) => b.text)).toEqual(["Cancel", "Restart"]);
    expect(buttons[0].style).toBe("cancel");
    expect(buttons[1].style).toBe("default");
  });

  it("only Restart confirms", async () => {
    await renderInLocale(<View />, "en");
    const onConfirm = jest.fn();
    showRestartPrompt("fa", onConfirm);
    const { buttons } = lastCall();
    buttons[0].onPress?.();
    expect(onConfirm).not.toHaveBeenCalled();
    buttons[1].onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
