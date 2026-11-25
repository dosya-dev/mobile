const mockBuildReclaimPlan = jest.fn(async (..._a: unknown[]) => ({ ids: [] as string[], bytes: 0, unverifiable: 0 }));
const mockRunReclaim = jest.fn(async (..._a: unknown[]) => 0);
jest.mock("@/backup/reclaim", () => ({
  buildReclaimPlan: (...a: unknown[]) => mockBuildReclaimPlan(...a),
  runReclaim: (...a: unknown[]) => mockRunReclaim(...a),
}));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));

import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import BackupFreeSpace from "./backup-free-space";
import { useWorkspaceStore } from "@/files/workspaceStore";

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildReclaimPlan.mockResolvedValue({ ids: [], bytes: 0, unverifiable: 0 });
  mockRunReclaim.mockResolvedValue(0);
  useWorkspaceStore.setState({ activeId: "w1" } as never);
});

describe("BackupFreeSpace", () => {
  it("shows what can be reclaimed", async () => {
    mockBuildReclaimPlan.mockResolvedValue({ ids: ["a", "b"], bytes: 4_509_715_660, unverifiable: 0 });
    render(<BackupFreeSpace />);
    expect(await screen.findByText("4.2 GB")).toBeTruthy();
    expect(screen.getByText("2 photos and videos")).toBeTruthy();
  });

  it("always states that there is no way back", async () => {
    mockBuildReclaimPlan.mockResolvedValue({ ids: ["a"], bytes: 100, unverifiable: 0 });
    render(<BackupFreeSpace />);
    // Deliberate: restore is out of scope for this wave, so the consequence
    // belongs on the screen rather than in a release note.
    expect(await screen.findByTestId("no-restore-notice")).toBeTruthy();
  });

  it("reports items held back because the server could not confirm them", async () => {
    mockBuildReclaimPlan.mockResolvedValue({ ids: ["a"], bytes: 100, unverifiable: 6 });
    render(<BackupFreeSpace />);
    expect(await screen.findByTestId("kept-unverifiable")).toHaveTextContent("6");
  });

  it("removes the planned originals in one go", async () => {
    const plan = { ids: ["a", "b"], bytes: 100, unverifiable: 0 };
    mockBuildReclaimPlan.mockResolvedValue(plan);
    mockRunReclaim.mockResolvedValue(2);
    render(<BackupFreeSpace />);
    fireEvent.press(await screen.findByTestId("reclaim"));
    await waitFor(() => expect(mockRunReclaim).toHaveBeenCalledWith(plan));
  });

  it("offers no action when there is nothing safe to remove", async () => {
    mockBuildReclaimPlan.mockResolvedValue({ ids: [], bytes: 0, unverifiable: 3 });
    render(<BackupFreeSpace />);
    expect(await screen.findByTestId("nothing-to-reclaim")).toBeTruthy();
    expect(screen.queryByTestId("reclaim")).toBeNull();
  });
});
