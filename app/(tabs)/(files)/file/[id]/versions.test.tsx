import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import VersionsScreen from "./versions";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "f1" }), Stack: { Screen: () => null } }));
jest.mock("@/files/api", () => ({ getVersions: jest.fn(async () => ({ current: 2, versions: [
  { id: "v2", version_number: 2, size_bytes: 20, uploader_name: "A", created_at: 1700000000 },
  { id: "v1", version_number: 1, size_bytes: 10, uploader_name: "A", created_at: 1699990000 },
] })) }));
const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0}, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>;

describe("VersionsScreen", () => {
  it("lists versions with the current one marked", async () => {
    render(wrap(<VersionsScreen />));
    await waitFor(() => expect(screen.getByText(/Version 2/)).toBeTruthy());
    expect(screen.getByText(/Current/)).toBeTruthy();
    expect(screen.getByText(/Version 1/)).toBeTruthy();
  });
});
