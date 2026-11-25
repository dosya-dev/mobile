import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useSheetBottomPad } from "./sheetInsets";

/** A three-button Android navigation bar, which is the case that broke. */
const NAV_BAR = 48;

function Probe({ base }: { base?: number }) {
  const pad = useSheetBottomPad(base);
  return <View testID="probe" style={{ paddingBottom: pad }} />;
}

function withInset(bottom: number, children: ReactNode) {
  return (
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom, left: 0, right: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

const padOf = () => screen.getByTestId("probe").props.style.paddingBottom;

describe("useSheetBottomPad", () => {
  it("adds the system bar inset to the sheet's own padding", () => {
    render(withInset(NAV_BAR, <Probe />));
    expect(padOf()).toBe(NAV_BAR + 16);
  });

  it("lets a sheet choose its own base padding", () => {
    render(withInset(NAV_BAR, <Probe base={0} />));
    expect(padOf()).toBe(NAV_BAR);
  });

  // The whole point. A fixed `pb-6` is 24dp, which is LESS than a three-button
  // navigation bar - so the sheet's last row, the one nearest the thumb, sat
  // behind the back and home buttons.
  it("clears a three-button navigation bar, which pb-6 did not", () => {
    render(withInset(NAV_BAR, <Probe />));
    expect(padOf()).toBeGreaterThan(NAV_BAR);
    expect(24).toBeLessThan(NAV_BAR);
  });

  // Gesture navigation reserves only a thin hint, which is why this bug is
  // easy to miss on a device that is not set to three-button mode.
  it("stays tight when the device reserves almost nothing", () => {
    render(withInset(0, <Probe />));
    expect(padOf()).toBe(16);
  });
});
