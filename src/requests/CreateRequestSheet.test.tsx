import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { CreateRequestSheet } from "./CreateRequestSheet";

/** A three-button Android navigation bar - the case that hid the submit button. */
const NAV_BAR = 48;

const noop = () => {};

function renderSheet() {
  return render(
    <SafeAreaInsetsContext.Provider value={{ top: 24, bottom: NAV_BAR, left: 0, right: 0 }}>
      <CreateRequestSheet visible busy={false} resultUrl={null} onSubmit={noop} onClose={noop} onCopyResult={noop} />
    </SafeAreaInsetsContext.Provider>
  );
}

// The sheet is a Modal, which renders in its own window OUTSIDE the screen's
// SafeAreaView - so it must ask for the bottom inset itself. With a fixed pb-8
// (32dp) the Create button's lower half sat behind the ~48dp three-button bar.
it("keeps the submit button clear of the system navigation bar", () => {
  renderSheet();
  expect(screen.getByTestId("create-submit")).toBeTruthy();
  const style = StyleSheet.flatten(screen.getByTestId("create-sheet-panel").props.style);
  expect(style.paddingBottom).toBeGreaterThan(NAV_BAR);
});
