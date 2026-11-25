import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import FolderScreen from "./[id]";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "fld1", name: "Photos" }),
  useRouter: () => ({ push: jest.fn() }),
  Stack: { Screen: () => null },
}));
jest.mock("@/files/FileBrowser", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return { FileBrowser: () => <View testID="file-browser" /> };
});

/** A device with a real bottom inset - 3-button nav, ~48dp. */
const renderOnDevice = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 24, bottom: 48, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 320, height: 640 },
      }}
    >
      <FolderScreen />
    </SafeAreaProvider>,
  );

describe("FolderScreen safe-area", () => {
  /**
   * This screen renders INSIDE the Files tab, and @react-navigation's
   * BottomTabBar already pads itself by insets.bottom (BottomTabBar.tsx). A
   * screen that consumes the same inset applies it a second time, and because
   * the screen sits above the bar its copy shows up as an empty band between
   * the file list and the tab bar - 48dp of dead space on a 3-button device.
   *
   * The screen used to live on the ROOT stack, where consuming the bottom inset
   * was right because no tab bar sat under it. Commit 36e8edd0 moved the file
   * into the tab's nested stack as a pure move, without revisiting its edges.
   *
   * Asserted on the `edges` prop rather than on rendered padding on purpose:
   * SafeAreaView applies insets NATIVELY, so the padding never appears in the
   * JS style tree and a padding assertion would pass against the bug.
   * "additive" means "add this inset"; "off" means "leave it to the tab bar".
   */
  const insetEdges = (): Record<string, string>[] =>
    screen.UNSAFE_root
      .findAllByType("RNCSafeAreaView" as unknown as React.ComponentType)
      .map((n: { props: { edges: Record<string, string> } }) => n.props.edges);

  it("does not consume the bottom inset - the tab bar already does", () => {
    renderOnDevice();
    // The screen must actually have rendered, or the edge check below would
    // pass simply because nothing is on screen to consume an inset.
    expect(screen.getByTestId("file-browser")).toBeTruthy();
    // Passes whether the screen drops SafeAreaView entirely or keeps it with
    // the bottom edge off; what must never come back is a second additive
    // inset stacked on top of the tab bar's own.
    for (const edges of insetEdges()) expect(edges.bottom).toBe("off");
  });

  it("leaves the top inset to the native stack header", () => {
    renderOnDevice();
    expect(screen.getByTestId("file-browser")).toBeTruthy();
    for (const edges of insetEdges()) expect(edges.top).toBe("off");
  });
});
