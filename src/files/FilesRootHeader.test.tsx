import { fireEvent, render, screen } from "@testing-library/react-native";
import { FilesRootHeader } from "./FilesRootHeader";
import { useFilesView } from "./filesViewStore";
import { useFilesMenu } from "./menu/menuStore";
import { useWorkspaceStore } from "./workspaceStore";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
jest.mock("@/account/DeletionBanner", () => ({ DeletionBanner: () => null }));
jest.mock("./hooks", () => ({
  useWorkspaces: () => ({ data: [{ id: "w1", name: "Acme" }, { id: "w2", name: "Other" }] }),
}));

beforeEach(() => {
  useFilesView.setState({ view: "all" });
  useFilesMenu.setState({ open: false });
  useWorkspaceStore.setState({ activeId: "w1" });
});

describe("FilesRootHeader", () => {
  it("shows the current view as the title and the workspace as the subtitle", () => {
    useFilesView.setState({ view: "images" });
    render(<FilesRootHeader />);
    expect(screen.getByTestId("files-view-title")).toHaveTextContent("Images");
    expect(screen.getByTestId("files-workspace-name")).toHaveTextContent("Acme");
    expect(screen.getByTestId("open-search")).toBeTruthy();
    // The logo is decorative (the name is read out under the title), so it is hidden from screen readers.
    expect(screen.getByTestId("files-workspace-logo", { includeHiddenElements: true })).toBeTruthy();
  });

  it("opens the menu from the menu button", () => {
    render(<FilesRootHeader />);
    fireEvent.press(screen.getByTestId("files-menu-open"));
    expect(useFilesMenu.getState().open).toBe(true);
  });

  it("puts the view tools between search and notifications", () => {
    const { Text } = require("react-native");
    render(<FilesRootHeader tools={<Text testID="tool">t</Text>} />);
    expect(screen.getByTestId("files-header-tools")).toContainElement(screen.getByTestId("tool"));
  });
});
