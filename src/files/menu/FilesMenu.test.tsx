import type { ReactElement } from "react";
import { BackHandler } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSharedValue } from "react-native-reanimated";
import { FilesMenu } from "./FilesMenu";
import { FilesMenuProgressContext } from "./menuMotion";
import { useFilesMenu } from "./menuStore";
import { useFilesView } from "../filesViewStore";
import { useWorkspaceStore } from "../workspaceStore";
import { getFavourites } from "../api";
import { getGroups } from "@/groups/api";
import { usePersonasEntry } from "@/personas/hooks";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("../hooks", () => ({
  useWorkspaces: () => ({
    data: [
      { id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, role_id: "role_owner", joined_at: 1 },
      { id: "w2", name: "Beta", slug: "beta", icon_initials: "BE", icon_color: "#2f6fd0", icon_image_url: null, role_id: "role_member", joined_at: 1 },
    ],
    isLoading: false,
  }),
}));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getFavourites: jest.fn() }));
jest.mock("@/groups/api", () => ({ getGroups: jest.fn() }));
jest.mock("@/personas/hooks", () => ({ usePersonasEntry: jest.fn() }));

const mockFavourites = getFavourites as jest.Mock;
const mockGroups = getGroups as jest.Mock;
const mockPersonas = usePersonasEntry as jest.Mock;

function Harness() {
  const progress = useSharedValue(0);
  return (
    <FilesMenuProgressContext.Provider value={progress}>
      <FilesMenu />
    </FilesMenuProgressContext.Provider>
  );
}

let qc: QueryClient;
function renderMenu(ui: ReactElement = <Harness />) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
afterEach(() => qc?.clear());

const file = (id: string, name: string) => ({ id, name, size_bytes: 1, mime_type: "image/jpeg", extension: "jpg", created_at: 1 });
const folder = (id: string, name: string) => ({ id, name, created_at: 1 });

beforeEach(() => {
  mockPush.mockReset();
  mockFavourites.mockReset().mockResolvedValue({ files: [], folders: [] });
  mockGroups.mockReset().mockResolvedValue([]);
  mockPersonas.mockReset().mockReturnValue({ visible: true });
  useFilesMenu.setState({ open: false, dragging: false });
  useFilesView.setState({ view: "all" });
  useWorkspaceStore.setState({ activeId: "w1" });
});

function openMenu() {
  act(() => useFilesMenu.getState().openMenu());
}

describe("FilesMenu", () => {
  it("renders nothing while closed", () => {
    renderMenu();
    expect(screen.queryByTestId("files-menu")).toBeNull();
  });

  it("shows when openMenu() is called and closes on the scrim", async () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId("files-menu")).toBeTruthy();
    expect(screen.getByTestId("files-menu-view-all").props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId("files-menu-scrim"));
    expect(useFilesMenu.getState().open).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("files-menu")).toBeNull());
  });

  it("picking a view sets it and closes the menu", () => {
    renderMenu();
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-view-images"));
    expect(useFilesView.getState().view).toBe("images");
    expect(useFilesMenu.getState().open).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("places close the menu and push their screen", () => {
    renderMenu();
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-deleted"));
    expect(useFilesMenu.getState().open).toBe(false);
    expect(mockPush).toHaveBeenCalledWith("/trash");

    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-shared"));
    expect(mockPush).toHaveBeenLastCalledWith("/shares");
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-file-requests"));
    expect(mockPush).toHaveBeenLastCalledWith("/file-requests");
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-map"));
    expect(mockPush).toHaveBeenLastCalledWith("/map");
  });

  it("Offline opens the Offline screen", () => {
    renderMenu();
    openMenu();
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId("files-menu-offline"));
    expect(useFilesMenu.getState().open).toBe(false);
    expect(mockPush).toHaveBeenLastCalledWith("/offline");
  });

  it("opens workspace settings from the gear", () => {
    renderMenu();
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-workspace-settings"));
    expect(useFilesMenu.getState().open).toBe(false);
    expect(mockPush).toHaveBeenCalledWith("/workspace-settings");
  });

  it("shows Personas only when its entry is visible, and pushes /personas", () => {
    mockPersonas.mockReturnValue({ visible: false });
    const { unmount } = renderMenu();
    openMenu();
    expect(screen.queryByTestId("files-menu-personas")).toBeNull();
    unmount();

    mockPersonas.mockReturnValue({ visible: true });
    useFilesMenu.setState({ open: false });
    renderMenu();
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-personas"));
    expect(mockPush).toHaveBeenCalledWith("/personas");
    expect(useFilesMenu.getState().open).toBe(false);
  });

  it("Android back closes the menu while open and reports it handled", () => {
    const listeners: (() => boolean | null | undefined)[] = [];
    const spy = jest.spyOn(BackHandler, "addEventListener").mockImplementation((_e, fn) => {
      listeners.push(fn);
      return { remove: () => listeners.splice(listeners.indexOf(fn), 1) };
    });
    renderMenu();
    expect(listeners).toHaveLength(0);
    openMenu();
    expect(listeners).toHaveLength(1);
    let handled: boolean | null | undefined;
    act(() => { handled = listeners[0](); });
    expect(handled).toBe(true);
    expect(useFilesMenu.getState().open).toBe(false);
    expect(listeners).toHaveLength(0);
    spy.mockRestore();
  });

  it("lists at most 8 favourites with See all, opening folders and files", async () => {
    mockFavourites.mockResolvedValue({
      folders: [folder("d1", "Invoices"), folder("d2", "Trips")],
      files: Array.from({ length: 9 }, (_, i) => file(`f${i}`, `photo-${i}.jpg`)),
    });
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId("files-menu-favourites")).toBeTruthy());
    expect(mockFavourites).toHaveBeenCalledWith("w1");
    expect(screen.getAllByTestId(/^files-menu-favourite-/)).toHaveLength(8);

    fireEvent.press(screen.getByTestId("files-menu-favourite-folder-d1"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/folder/[id]", params: { id: "d1", name: "Invoices" } });
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-favourite-file-f0"));
    expect(mockPush).toHaveBeenLastCalledWith("/file/f0");
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-favourites-all"));
    expect(mockPush).toHaveBeenLastCalledWith("/favourites");
  });

  it("hides the favourites section when there are none", async () => {
    renderMenu();
    openMenu();
    await waitFor(() => expect(mockFavourites).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("files-menu-groups-empty")).toBeTruthy());
    expect(screen.queryByTestId("files-menu-favourites")).toBeNull();
  });

  it("shows groups, the empty line, and opens /groups", async () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId("files-menu-groups")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("files-menu-groups-empty")).toBeTruthy());
    expect(mockGroups).toHaveBeenCalledWith("w1");
    fireEvent.press(screen.getByTestId("files-menu-groups-add"));
    expect(mockPush).toHaveBeenLastCalledWith("/groups");
  });

  it("lists groups and a group row opens /groups", async () => {
    mockGroups.mockResolvedValue([{ id: "g1", name: "Design", color: "#f00" }]);
    renderMenu();
    openMenu();
    await waitFor(() => expect(screen.getByTestId("files-menu-group-g1")).toBeTruthy());
    expect(screen.queryByTestId("files-menu-groups-empty")).toBeNull();
    fireEvent.press(screen.getByTestId("files-menu-group-g1"));
    expect(mockPush).toHaveBeenLastCalledWith("/groups");
    expect(useFilesMenu.getState().open).toBe(false);
  });

  it("the workspace card opens the workspace picker sheet", () => {
    renderMenu();
    openMenu();
    expect(screen.getByTestId("files-menu-workspace")).toHaveTextContent(/Acme/);
    fireEvent.press(screen.getByTestId("files-menu-workspace"));
    expect(screen.getByTestId("ws-sheet")).toBeTruthy();
    expect(screen.getByTestId("ws-item-w2")).toBeTruthy();
    expect(useFilesMenu.getState().open).toBe(true);
  });

  it("switching workspace from the menu keeps the current view", async () => {
    const setActive = jest.fn(async () => {});
    useWorkspaceStore.setState({ activeId: "w1", setActive } as never);
    useFilesView.setState({ view: "videos" });
    renderMenu();
    openMenu();
    fireEvent.press(screen.getByTestId("files-menu-workspace"));
    fireEvent.press(screen.getByTestId("ws-item-w2"));
    await waitFor(() => expect(setActive).toHaveBeenCalledWith("w2"));
    expect(useFilesView.getState().view).toBe("videos");
  });

  it("dragging the panel past 35% closes it; a short drag springs back open", () => {
    const drag = (dx: number) =>
      act(() => {
        fireGestureHandler(getByGestureTestId("files-menu-pan"), [
          { state: State.BEGAN, translationX: 0, velocityX: 0 },
          { state: State.ACTIVE, translationX: dx / 2, velocityX: 0 },
          { state: State.END, translationX: dx, velocityX: 0 },
        ]);
      });
    renderMenu();
    openMenu();
    drag(-40);
    expect(useFilesMenu.getState().open).toBe(true);
    drag(-200);
    expect(useFilesMenu.getState().open).toBe(false);
  });
});
