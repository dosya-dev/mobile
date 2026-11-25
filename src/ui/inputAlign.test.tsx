import { Platform, StyleSheet } from "react-native";
import { screen } from "@testing-library/react-native";
import { renderInLocale } from "../../test-utils/i18n-sweep";
import { __setLayoutRtlForTests, inputStartAlign } from "@/lib/direction";
import { LockGate } from "@/viewer/stages/LockGate";
import { stagePalette } from "@/viewer/stageTheme";

// Raw TextInputs outside TextField: iOS resolves an unset alignment from the
// app bundle's localization (no RTL language there), so they started on the
// left in Arabic. TextInput alignment is physical on iOS, so "right" is start.
const align = (id: string) => (StyleSheet.flatten(screen.getByTestId(id).props.style) as { textAlign?: string }).textAlign;

describe("inputStartAlign", () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });

  it("is the physical right on iOS in a right-to-left layout", () => {
    Platform.OS = "ios";
    __setLayoutRtlForTests(true);
    expect(inputStartAlign()).toEqual({ textAlign: "right" });
  });

  it("is nothing left to right, and nothing on Android", () => {
    Platform.OS = "ios";
    __setLayoutRtlForTests(false);
    expect(inputStartAlign()).toBeUndefined();
    Platform.OS = "android";
    __setLayoutRtlForTests(true);
    expect(inputStartAlign()).toBeUndefined();
  });
});

describe("a raw TextInput (the lock gate's password field)", () => {
  const gate = <LockGate busy={false} error={null} onSubmit={() => {}} palette={stagePalette("light")} />;
  afterAll(async () => {
    await renderInLocale(<></>, "en");
  });

  it("starts at the start edge in ar", async () => {
    __setLayoutRtlForTests(true);
    await renderInLocale(gate, "ar");
    expect(align("unlock-password")).toBe("right");
  });

  it("adds nothing in en", async () => {
    __setLayoutRtlForTests(false);
    await renderInLocale(gate, "en");
    expect(align("unlock-password")).toBeUndefined();
  });
});
