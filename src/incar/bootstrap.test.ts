import { hydrateForCarPlay } from "./bootstrap";
import { useAuthStore } from "@/auth/authStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import * as i18n from "@/lib/i18n";

jest.mock("@/auth/authStore", () => ({
  useAuthStore: { getState: jest.fn() },
}));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: { getState: jest.fn() },
}));

describe("hydrateForCarPlay", () => {
  it("hydrates auth and workspace stores and reports signed-in", async () => {
    const authHydrate = jest.fn(async () => {});
    const wsHydrate = jest.fn(async () => {});
    (useAuthStore.getState as jest.Mock).mockReturnValue({ hydrate: authHydrate, status: "signedIn" });
    (useWorkspaceStore.getState as jest.Mock).mockReturnValue({ hydrate: wsHydrate, hydrated: false });
    expect(await hydrateForCarPlay()).toBe("signed-in");
    expect(authHydrate).toHaveBeenCalled();
    expect(wsHydrate).toHaveBeenCalled();
  });

  it("skips workspace hydration when it's already hydrated", async () => {
    const wsHydrate = jest.fn(async () => {});
    (useAuthStore.getState as jest.Mock).mockReturnValue({ hydrate: jest.fn(async () => {}), status: "signedIn" });
    (useWorkspaceStore.getState as jest.Mock).mockReturnValue({ hydrate: wsHydrate, hydrated: true });
    await hydrateForCarPlay();
    expect(wsHydrate).not.toHaveBeenCalled();
  });

  it("reports signed-out without touching the workspace store when auth fails to hydrate a session", async () => {
    const wsHydrate = jest.fn(async () => {});
    (useAuthStore.getState as jest.Mock).mockReturnValue({ hydrate: jest.fn(async () => {}), status: "signedOut" });
    (useWorkspaceStore.getState as jest.Mock).mockReturnValue({ hydrate: wsHydrate, hydrated: false });
    expect(await hydrateForCarPlay()).toBe("signed-out");
    expect(wsHydrate).not.toHaveBeenCalled();
  });
});

describe("hydrateForCarPlay language", () => {
  it("boots the language before restoring the session", async () => {
    const authHydrate = jest.fn(async () => {});
    (useAuthStore.getState as jest.Mock).mockReturnValue({ hydrate: authHydrate, status: "signedOut" });
    const ensure = jest.spyOn(i18n, "ensureI18n");
    await hydrateForCarPlay();
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(authHydrate.mock.invocationCallOrder[0]);
    ensure.mockRestore();
  });
});