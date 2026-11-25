const mockApiRequest = jest.fn(async () => ({ ok: true, months: [], next_cursor: null }));
jest.mock("@/api", () => ({ apiRequest: (...a: unknown[]) => mockApiRequest(...(a as [])) }));

import { listLibrary } from "./api";

describe("listLibrary", () => {
  afterEach(() => jest.restoreAllMocks());

  it("tells the server the device's UTC offset so months are grouped in local time", async () => {
    // Istanbul in September: UTC+3. getTimezoneOffset reports minutes WEST of
    // UTC, so the sign flips (Contract 4: minutes EAST of UTC).
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-180);
    await listLibrary({ workspaceId: "w1", kind: "photos" });
    const [path] = mockApiRequest.mock.calls[0] as unknown as [string];
    const qs = new URL(`https://x${path}`).searchParams;
    expect(qs.get("tz_offset")).toBe("180");
    expect(qs.get("workspace_id")).toBe("w1");
    expect(qs.get("kind")).toBe("photos");
  });

  it("sends a negative offset west of UTC", async () => {
    jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(240); // New York in September
    await listLibrary({ workspaceId: "w1", kind: "videos" });
    const [path] = mockApiRequest.mock.calls[mockApiRequest.mock.calls.length - 1] as unknown as [string];
    expect(new URL(`https://x${path}`).searchParams.get("tz_offset")).toBe("-240");
  });
});
