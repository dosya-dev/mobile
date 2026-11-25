import { StyleSheet } from "react-native";
import { renderInLocale } from "../../test-utils/i18n-sweep";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { TextField } from "./TextField";

it("toggles password visibility when the eye is pressed", () => {
  render(<TextField label="Password" testID="pw" value="secret" onChangeText={() => {}} secureTextEntry />);
  expect(screen.getByTestId("pw").props.secureTextEntry).toBe(true);
  fireEvent.press(screen.getByTestId("pw-eye"));
  expect(screen.getByTestId("pw").props.secureTextEntry).toBe(false);
});

it("renders no eye toggle for a plain field", () => {
  render(<TextField label="Email" testID="email" value="" onChangeText={() => {}} />);
  expect(screen.queryByTestId("email-eye")).toBeNull();
});

describe("TextField alignment in a right-to-left layout (iOS)", () => {
  // Like Text: an unset alignment is "natural", which iOS resolves from the app
  // bundle's localization, so Arabic placeholders sat on the left of the field.
  // A TextInput's alignment is physical on iOS (not swapped in RTL): "right".
  const align = () => (StyleSheet.flatten(screen.getByTestId("f").props.style) as { textAlign?: string }).textAlign;
  afterAll(async () => { await renderInLocale(<></>, "en"); });

  it.each(["ar", "he", "fa"] as const)("starts the text at the start edge in %s", async (locale) => {
    await renderInLocale(<TextField testID="f" value="" onChangeText={() => {}} />, locale);
    expect(align()).toBe("right");
  });

  it("keeps a code field centred", async () => {
    await renderInLocale(<TextField testID="f" mono value="" onChangeText={() => {}} />, "ar");
    expect(align()).toBe("center");
  });

  it("puts the code field's tracking compensation on the physical left in ar too", async () => {
    // The digits run left to right in every language, so letterSpacing's trailing
    // gap is always on the right; the compensating padding is physical.
    await renderInLocale(<TextField testID="f" mono value="" onChangeText={() => {}} />, "ar");
    const st = StyleSheet.flatten(screen.getByTestId("f").props.style) as { paddingLeft?: number; paddingStart?: number };
    expect(st.paddingLeft).toBe(8);
    expect(st.paddingStart).toBeUndefined();
  });

  it("adds nothing in en", async () => {
    await renderInLocale(<TextField testID="f" value="" onChangeText={() => {}} />, "en");
    expect(align()).toBeUndefined();
  });
});
