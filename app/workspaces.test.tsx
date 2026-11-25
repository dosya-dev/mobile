import { render, screen } from "@testing-library/react-native";
import WorkspacesScreen from "./workspaces";
import { useWorkspaces } from "@/files/hooks";

jest.mock("@/files/hooks", () => ({ useWorkspaces: jest.fn() }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) }));

const mockUseWorkspaces = useWorkspaces as jest.Mock;

it("lists workspaces with their role badge", () => {
  mockUseWorkspaces.mockReturnValue({
    data: [
      { id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, role_id: "role_owner", joined_at: 1700000000 },
    ],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  });
  render(<WorkspacesScreen />);
  expect(screen.getByText("Acme")).toBeTruthy();
  expect(screen.getByText("Owner")).toBeTruthy();
});

it("shows the empty state", () => {
  mockUseWorkspaces.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: jest.fn() });
  render(<WorkspacesScreen />);
  expect(screen.getByText("No workspaces")).toBeTruthy();
});
