// The iOS Files extension holds a LINKED session: a child of the app's session
// that the server kills together with its parent. These tests pin the two
// moments the store must tell the extension about, so a dead child never
// survives into the next sign-in (Files then shows "authentication required"
// until the user signs out and back in by hand).
const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));
jest.mock("./api", () => ({
  mobileLogin: jest.fn(),
  mobile2fa: jest.fn(),
  mobileRefresh: jest.fn(),
  mobileLogout: jest.fn(),
  fetchMe: jest.fn(),
}));
let capturedRefresh: (() => Promise<boolean>) | null;
jest.mock("@/api", () => ({
  setTokenProvider: jest.fn(),
  setRefreshHandler: (fn: () => Promise<boolean>) => { capturedRefresh = fn; },
  ApiError: jest.requireActual("../api/errors").ApiError,
}));
jest.mock("@/filesProvider/link", () => ({
  linkFilesProvider: jest.fn(async () => {}),
  relinkFilesProvider: jest.fn(async () => {}),
  unlinkFilesProvider: jest.fn(async () => {}),
}));

import { useAuthStore } from "./authStore";
import * as authApi from "./api";
import { ApiError } from "../api/errors";
import { relinkFilesProvider, unlinkFilesProvider } from "@/filesProvider/link";

const USER = { id: "u", email: "a@b.com", name: "A", created_at: 1 };

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  useAuthStore.setState({ status: "loading", user: null, pending2fa: null, error: null });
  jest.clearAllMocks();
});

async function signIn() {
  (authApi.mobileLogin as jest.Mock).mockResolvedValue({ kind: "tokens", access: "dosm_a", refresh: "dosr_b", user: USER });
  await useAuthStore.getState().signIn("a@b.com", "pw");
  expect(useAuthStore.getState().status).toBe("signedIn");
}

describe("authStore <-> iOS Files extension", () => {
  it("a fresh sign-in re-mints the extension's session for that account", async () => {
    await signIn();
    expect(relinkFilesProvider).toHaveBeenCalledWith("u");
  });

  it("a server-rejected refresh unlinks the extension, like an explicit sign-out does", async () => {
    await signIn();
    (authApi.mobileRefresh as jest.Mock).mockRejectedValue(new ApiError("Invalid or expired refresh token", 401));
    await expect(capturedRefresh!()).resolves.toBe("rejected");
    expect(useAuthStore.getState().status).toBe("signedOut");
    expect(unlinkFilesProvider).toHaveBeenCalledWith(null);
  });

  it("a routine token rotation does not touch the extension", async () => {
    await signIn();
    (authApi.mobileRefresh as jest.Mock).mockResolvedValue({ access: "dosm_c", refresh: "dosr_d" });
    await capturedRefresh!();
    expect(relinkFilesProvider).toHaveBeenCalledTimes(1);
    expect(unlinkFilesProvider).not.toHaveBeenCalled();
  });
});
