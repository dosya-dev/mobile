import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { OrbitTabBar } from "./OrbitTabBar";
import { useUploadTarget } from "./uploadTargetStore";
import { useTabBarHolds } from "./tabBarHold";
import { useDownloadStore } from "@/files/downloadStore";
import { useUploadStore } from "@/upload/store";
import { usePlayerStore } from "@/player/playerStore";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/files/downloadControl", () => ({ cancelDownload: jest.fn(async () => {}) }));
jest.mock("@/upload/controller", () => ({ retryItem: jest.fn(), startUploads: jest.fn() }));
jest.mock("@/upload/startFromPicker", () => ({ startFromPicker: jest.fn(async () => {}) }));
jest.mock("@/player/controller", () => ({
  togglePlay: jest.fn(async () => {}),
  next: jest.fn(async () => {}),
  stopAndClear: jest.fn(async () => {}),
}));

const ROUTES = [
  { key: "files-1", name: "(files)", params: undefined },
  { key: "backup-1", name: "backup", params: undefined },
  { key: "settings-1", name: "settings", params: undefined },
];

const navigate = jest.fn();
const emit = jest.fn(() => ({ defaultPrevented: false }));

function props(over: { index?: number; filesTabBarStyle?: unknown } = {}): BottomTabBarProps {
  const index = over.index ?? 0;
  const descriptors = Object.fromEntries(
    ROUTES.map((r, i) => [
      r.key,
      {
        options: {
          title: r.name === "(files)" ? "Files" : r.name === "backup" ? "Backup" : "Settings",
          // A recognisable stand-in for the real glyph: the bar's job is to
          // render whatever the screen declared, not to know what it is.
          tabBarIcon: () => <Text testID={`icon-${r.name}`}>icon</Text>,
          ...(r.name === "(files)" && over.filesTabBarStyle !== undefined
            ? { tabBarStyle: over.filesTabBarStyle }
            : {}),
        },
        route: r,
        navigation: { navigate, emit },
      },
    ]),
  );
  return {
    state: { index, routes: ROUTES, key: "tabs", routeNames: ROUTES.map((r) => r.name) },
    descriptors,
    navigation: { navigate, emit },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as BottomTabBarProps;
}

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.getState().clearAll();
  useUploadStore.setState({ items: [] });
  usePlayerStore.setState({ queue: [], index: -1, playing: false });
  useUploadTarget.setState({
    workspaceId: "w1", folderId: null, folderName: null, workspaceName: "Workspace 1", canAdd: true,
  });
});
afterEach(() => useDownloadStore.getState().clearAll());

describe("the bar", () => {
  it("renders each screen's own icon, and the orbit button with them", () => {
    render(<OrbitTabBar {...props()} />);
    expect(screen.getByTestId("icon-(files)")).toBeTruthy();
    expect(screen.getByTestId("icon-backup")).toBeTruthy();
    expect(screen.getByTestId("icon-settings")).toBeTruthy();
    expect(screen.getByTestId("orbit-button")).toBeTruthy();
  });

  // An icon alone left the padlock and the cloud to be guessed at, so every
  // tab now carries its name under the glyph.
  it("shows every tab's name, and names it to a screen reader too", () => {
    render(<OrbitTabBar {...props()} />);
    for (const name of ["Files", "Backup", "Settings"]) {
      expect(screen.getByText(name, { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });

  // The button splits the row: the slot it rises over sits in the middle, the
  // extra tab of an odd count going first.
  it("puts the orbit button's slot in the middle of the row", () => {
    render(<OrbitTabBar {...props()} />);
    const ids = screen.getByTestId("orbit-bar").props.children.flat().map((c: { props: { testID: string } }) => c.props.testID);
    expect(ids).toEqual(["orbit-tab-(files)", "orbit-tab-backup", "orbit-button-slot", "orbit-tab-settings"]);
  });

  // The strip the button rises into overlaps the screen instead of taking
  // space from it; painted, it read as an extra band above the bar.
  it("overlaps the screen by the strip it rises into, and leaves that strip clear", () => {
    render(<OrbitTabBar {...props()} />);
    const root = screen.getByTestId("orbit-tab-bar");
    const style = StyleSheet.flatten(root.props.style);
    expect(style.marginTop).toBe(-(style.paddingTop as number));
    expect(style.backgroundColor).toBeUndefined();
    expect(root.props.pointerEvents).toBe("box-none");
  });

  it("marks only the focused tab's indicator", () => {
    render(<OrbitTabBar {...props({ index: 1 })} />);
    const bg = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor;
    expect(bg("orbit-tab-indicator-backup")).not.toBe("transparent");
    expect(bg("orbit-tab-indicator-(files)")).toBe("transparent");
    expect(bg("orbit-tab-indicator-settings")).toBe("transparent");
  });

  it("navigates on press, and marks the focused tab as selected", () => {
    render(<OrbitTabBar {...props()} />);
    fireEvent.press(screen.getByTestId("orbit-tab-backup"));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "tabPress", target: "backup-1" }));
    expect(navigate).toHaveBeenCalledWith("backup", undefined);
    expect(screen.getByTestId("orbit-tab-(files)").props.accessibilityState).toEqual({ selected: true });
  });

  it("does not re-navigate to the tab already focused", () => {
    render(<OrbitTabBar {...props()} />);
    fireEvent.press(screen.getByTestId("orbit-tab-(files)"));
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("the full-bleed viewer", () => {
  // The stock bar honours `tabBarStyle: { display: "none" }` for free. A custom
  // bar has to read it back off the focused descriptor, or the viewer - whose
  // whole point is that tapping the stage leaves nothing but the file - keeps
  // a bar and a disc sitting on top of it.
  it("disappears entirely when the focused screen hides the bar", () => {
    render(<OrbitTabBar {...props({ filesTabBarStyle: { display: "none" } })} />);
    expect(screen.queryByTestId("orbit-tab-bar")).toBeNull();
    expect(screen.queryByTestId("orbit-button")).toBeNull();
  });

  it("stays put when a DIFFERENT screen is the one hiding it", () => {
    render(<OrbitTabBar {...props({ index: 1, filesTabBarStyle: { display: "none" } })} />);
    expect(screen.getByTestId("orbit-tab-bar")).toBeTruthy();
  });

  // The Vault walkthrough is not a route of its own, so it cannot use the
  // tabBarStyle channel; it holds the bar instead.
  it("disappears while a screen holds it, and comes back on release", () => {
    useTabBarHolds.setState({ holds: ["vault-onboarding"] });
    const { rerender } = render(<OrbitTabBar {...props()} />);
    expect(screen.queryByTestId("orbit-tab-bar")).toBeNull();
    useTabBarHolds.setState({ holds: [] });
    rerender(<OrbitTabBar {...props()} />);
    expect(screen.getByTestId("orbit-tab-bar")).toBeTruthy();
  });

  it("stays put for a screen that sets no style at all", () => {
    render(<OrbitTabBar {...props()} />);
    expect(screen.getByTestId("orbit-tab-bar")).toBeTruthy();
  });
});

describe("the sheet", () => {
  it("opens on the orbit button and closes on the scrim", () => {
    render(<OrbitTabBar {...props()} />);
    expect(screen.queryByTestId("orbit-sheet-sources")).toBeNull();

    fireEvent.press(screen.getByTestId("orbit-button"));
    expect(screen.getByTestId("orbit-sheet-sources")).toBeTruthy();
    // The button says so too, rather than still offering to upload.
    expect(screen.getByTestId("orbit-core-close")).toBeTruthy();

    fireEvent.press(screen.getByTestId("orbit-sheet-scrim"));
    expect(screen.queryByTestId("orbit-sheet-sources")).toBeNull();
  });
});
