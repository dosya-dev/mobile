jest.mock("@/share-intent/incoming", () => ({
  routeIncomingUrl: jest.fn(async (path: string) => path),
}));

import { Platform } from "react-native";
import { routeIncomingUrl } from "@/share-intent/incoming";
import { redirectSystemPath } from "./+native-intent";

/**
 * app/+native-intent.ts is the only hook expo-router offers for seeing a URL
 * before it becomes a route. It stays a thin adapter so the real behaviour is
 * tested once, in src/share-intent/incoming.test.ts, without Platform mocking.
 */
describe("redirectSystemPath", () => {
  beforeEach(() => jest.clearAllMocks());

  it("hands every URL to the share-intent router for the current platform", async () => {
    await redirectSystemPath({ path: "file:///x/Documents/Inbox/a.pdf", initial: true });
    expect(routeIncomingUrl).toHaveBeenCalledWith("file:///x/Documents/Inbox/a.pdf", Platform.OS);
  });

  it("returns whatever the router decided", async () => {
    (routeIncomingUrl as jest.Mock).mockResolvedValueOnce(null);
    expect(await redirectSystemPath({ path: "file:///x/a.pdf", initial: false })).toBeNull();
    (routeIncomingUrl as jest.Mock).mockResolvedValueOnce("dosya://s/abc");
    expect(await redirectSystemPath({ path: "dosya://s/abc", initial: false })).toBe("dosya://s/abc");
  });

  it("falls back to the untouched path if the router throws", async () => {
    // expo-router warns that a throw here can take the app down. A deep link
    // must never be lost to a bug in the file-open path.
    (routeIncomingUrl as jest.Mock).mockRejectedValueOnce(new Error("boom"));
    expect(await redirectSystemPath({ path: "dosya://auth/callback?code=1", initial: false })).toBe(
      "dosya://auth/callback?code=1",
    );
  });
});
