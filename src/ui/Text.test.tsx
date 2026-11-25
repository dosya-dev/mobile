import { Platform, StyleSheet } from "react-native";
import { screen } from "@testing-library/react-native";
import { Text } from "./Text";
import { renderInLocale } from "../../test-utils/i18n-sweep";

function styleOf(): unknown {
  return screen.getByTestId("t").props.style;
}

describe("Text letter spacing", () => {
  it.each(["ar", "fa"] as const)("appends letterSpacing: 0 last in %s", async (locale) => {
    await renderInLocale(<Text testID="t" style={{ letterSpacing: 2 }}>x</Text>, locale);
    const style = styleOf() as unknown[];
    expect(style[style.length - 1]).toEqual({ letterSpacing: 0 });
    expect((StyleSheet.flatten(style as never) as { letterSpacing?: number }).letterSpacing).toBe(0);
  });

  it.each(["he", "en", "de"] as const)("leaves tracking alone in %s", async (locale) => {
    await renderInLocale(<Text testID="t" style={{ letterSpacing: 2 }}>x</Text>, locale);
    expect((StyleSheet.flatten(styleOf() as never) as { letterSpacing?: number }).letterSpacing).toBe(2);
  });

  it("keeps English props exactly as before", async () => {
    const style = { color: "red" };
    await renderInLocale(<Text testID="t" style={style}>x</Text>, "en");
    const s = styleOf() as unknown[];
    expect(s).toHaveLength(2);
    expect(s[1]).toBe(style);
  });
});

describe("Text alignment in a right-to-left layout (iOS)", () => {
  // UIKit resolves "natural" alignment from the app bundle's own localization,
  // not the layout, so unaligned Arabic sat on the LEFT on the simulator. An
  // explicit "left" is turned into the start side (right) by React Native in RTL.
  const flat = () => StyleSheet.flatten(styleOf() as never) as { textAlign?: string };

  it.each(["ar", "he", "fa"] as const)("starts unaligned text at the start edge in %s", async (locale) => {
    await renderInLocale(<Text testID="t">x</Text>, locale);
    expect(flat().textAlign).toBe("left");
  });

  it("keeps an explicit style alignment", async () => {
    await renderInLocale(<Text testID="t" style={{ textAlign: "center" }}>x</Text>, "ar");
    expect(flat().textAlign).toBe("center");
  });

  it("keeps an alignment class", async () => {
    await renderInLocale(<Text testID="t" className="text-center">x</Text>, "he");
    expect(flat().textAlign).not.toBe("left");
  });

  it.each(["en", "de"] as const)("adds nothing in %s", async (locale) => {
    await renderInLocale(<Text testID="t">x</Text>, locale);
    expect(flat().textAlign).toBeUndefined();
  });

  it("adds nothing on Android, whose text already starts at the layout's start", async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, "OS", { get: () => "android", configurable: true });
    try {
      await renderInLocale(<Text testID="t">x</Text>, "ar");
      expect(flat().textAlign).toBeUndefined();
    } finally {
      Object.defineProperty(Platform, "OS", { get: () => os, configurable: true });
    }
  });
});
