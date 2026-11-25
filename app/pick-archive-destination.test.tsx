import { render, screen, fireEvent, act, waitFor } from "@testing-library/react-native";
import PickArchiveDestination from "./pick-archive-destination";
import { useArchiveSaveStore, type ArchiveSaveJob } from "@/archive/archiveSaveStore";
import { planFolderSave, type SavePlan } from "@/archive/archiveSave";
import { buildArchiveTree } from "@/archive/archiveTree";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: (...a: unknown[]) => mockBack(...a) }),
  Stack: { Screen: () => null },
}));

const mockApiRequest = jest.fn();
jest.mock("@/api/client", () => ({ apiRequest: (...a: unknown[]) => mockApiRequest(...a) }));

jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: "ws_1" }),
}));

const folders = [{ id: "fld_dest", name: "Dest", created_at: 1, lock_mode: "none", file_count: 0 }];
jest.mock("@/files/hooks", () => ({
  useWorkspaces: () => ({ data: [{ id: "ws_1", name: "Personal" }] }),
  useFileList: (_ws: string | null, folderId: string | null) => ({
    data: { pages: [{ folders: folderId === null ? folders : [] }] },
  }),
}));

const mockToast = jest.fn();
jest.mock("@/ui/toast", () => ({ toast: (...a: unknown[]) => mockToast(...a) }));

const entry = (i: number, name: string) => ({ i, name, size: 1, csize: 1, method: 8, dir: false, encrypted: false, mtime: null });
const TREE = buildArchiveTree([entry(4, "assets/hero.png"), entry(7, "README.md")]);
const assets = TREE.find((n) => n.name === "assets")!;

function park(job: ArchiveSaveJob) {
  useArchiveSaveStore.getState().park(job);
}
const batchAnswer = (body: { folders: { name: string; parent_id: string | null }[] }) => ({
  ok: true,
  folders: body.folders.map((f) => ({ name: f.name, parent_id: f.parent_id, id: `fld_${f.name}`, created: true })),
});

beforeEach(() => {
  jest.clearAllMocks();
  useArchiveSaveStore.getState().take();
});

it("saves a parked entry into the chosen folder with its cleaned name, then goes back", async () => {
  park({ fileId: "f1", archiveName: "bundle.zip", kind: "entry", index: 7, name: "README.md" });
  mockApiRequest.mockResolvedValue({ ok: true, file_id: "file_9", name: "README (2).md", size_bytes: 30 });
  render(<PickArchiveDestination />);
  await waitFor(() => screen.getByText("Dest"));

  fireEvent.press(screen.getByText("Dest"));
  fireEvent.press(screen.getByTestId("archive-save-here"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockApiRequest).toHaveBeenCalledWith("/api/files/f1/archive/save", {
    method: "POST", body: { i: 7, folder_id: "fld_dest", name: "README.md" },
  });
  expect(mockToast).toHaveBeenCalledWith("Saved README (2).md to dosya");
});

it("saves a parked folder plan: creates the folder through /api/folders/batch, then its files, and summarises", async () => {
  const plan = planFolderSave(assets.children, "assets") as SavePlan;
  park({ fileId: "f1", archiveName: "bundle.zip", kind: "folder", plan });
  mockApiRequest.mockImplementation(async (path: string, opts: { body: { folders: { name: string; parent_id: string | null }[] } }) =>
    path === "/api/folders/batch" ? batchAnswer(opts.body) : { ok: true, file_id: "file_x", name: "hero.png", size_bytes: 1 });
  render(<PickArchiveDestination />);
  await waitFor(() => screen.getByTestId("archive-save-here"));

  fireEvent.press(screen.getByTestId("archive-save-here"));

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockApiRequest.mock.calls[0]).toEqual(["/api/folders/batch", {
    method: "POST", body: { workspace_id: "ws_1", folders: [{ name: "assets", parent_id: null }] },
  }]);
  expect(mockApiRequest.mock.calls[1]).toEqual(["/api/files/f1/archive/save", {
    method: "POST", body: { i: 4, folder_id: "fld_assets", name: "hero.png" },
  }]);
  expect(mockToast).toHaveBeenCalledWith("Saved 1 file into assets");
});

it("shows progress with a Cancel control while a folder save runs, and stops after the current file", async () => {
  const plan = planFolderSave(TREE, "bundle") as SavePlan; // two files
  park({ fileId: "f1", archiveName: "bundle.zip", kind: "folder", plan });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  mockApiRequest.mockImplementation(async (path: string, opts: { body: { folders: { name: string; parent_id: string | null }[] } }) => {
    if (path === "/api/folders/batch") return batchAnswer(opts.body);
    await gate;
    return { ok: true, file_id: "file_x", name: "x", size_bytes: 1 };
  });
  render(<PickArchiveDestination />);
  await waitFor(() => screen.getByTestId("archive-save-here"));

  fireEvent.press(screen.getByTestId("archive-save-here"));

  await waitFor(() => expect(screen.getByTestId("archive-save-progress")).toBeTruthy());
  expect(screen.getByText(/Saving 0 of 2/)).toBeTruthy();
  fireEvent.press(screen.getByTestId("archive-save-cancel"));
  await act(async () => { release(); });

  await waitFor(() => expect(mockBack).toHaveBeenCalled());
  expect(mockToast).toHaveBeenCalledWith("Saved 1 file into bundle, cancelled");
});

it("reports a failure in the summary and does not pretend the file landed", async () => {
  park({ fileId: "f1", archiveName: "bundle.zip", kind: "entry", index: 7, name: "README.md" });
  const { ApiError } = require("@/api/errors");
  mockApiRequest.mockRejectedValue(new ApiError("You don't have upload permission in this workspace", 403));
  render(<PickArchiveDestination />);
  await waitFor(() => screen.getByTestId("archive-save-here"));

  fireEvent.press(screen.getByTestId("archive-save-here"));

  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("You don't have upload permission in this workspace", "error"));
  expect(mockBack).not.toHaveBeenCalled();
});

it("explains itself when nothing was parked", () => {
  render(<PickArchiveDestination />);
  expect(screen.getByText(/Nothing to save/)).toBeTruthy();
});
