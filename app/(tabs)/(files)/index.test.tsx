import { render, screen } from "@testing-library/react-native";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { useSharedValue } from "react-native-reanimated";
import { FilesMenuProgressContext } from "@/files/menu/menuMotion";
import FilesScreen from "./index";

// The header now carries a data-fetching bell; this suite renders the real
// header and has no QueryClient, so stub just the bell.
jest.mock("@/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
jest.mock("@/account/DeletionBanner", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return { DeletionBanner: () => <Text testID="deletion-banner">banner</Text> };
});
jest.mock("@/files/hooks", () => ({ useWorkspaces: () => ({ data: [] }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/files/FileBrowser", () => {
  const { Text } = require("react-native");
  return {
    FileBrowser: ({ folderId, header, banner }: { folderId: string | null; header?: (tools: unknown) => unknown; banner?: unknown }) => (
      <><Text>FileBrowser:{String(folderId)}</Text>{header?.(null) as never}<Text testID="banner-slot">{banner as never}</Text></>
    ),
  };
});

// The tabs layout owns the menu's progress; the screen's edge swipe drives it.
function InTabs() {
  const progress = useSharedValue(0);
  return (
    <FilesMenuProgressContext.Provider value={progress}>
      <FilesScreen />
    </FilesMenuProgressContext.Provider>
  );
}

describe("FilesScreen", () => {
  it("renders the root file browser with the Files root header and the menu's edge swipe", () => {
    render(<InTabs />);
    expect(getByGestureTestId("files-menu-edge")).toBeTruthy();
    expect(screen.getByTestId("files-menu-open")).toBeTruthy();
    expect(screen.getByText("FileBrowser:null")).toBeTruthy();
    expect(screen.getByLabelText("Search")).toBeTruthy();
  });

  // The banner rides FileBrowser's banner slot, outside the selection header
  // swap, rather than inside the header the swap hides.
  it("hands the deletion banner to FileBrowser's banner slot, not the header", () => {
    render(<InTabs />);
    expect(screen.getAllByTestId("deletion-banner")).toHaveLength(1);
    expect(screen.getByTestId("banner-slot")).toContainElement(screen.getByTestId("deletion-banner"));
  });
});
