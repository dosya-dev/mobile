import { checkFingerprints, recordFingerprint } from "./api";
jest.mock("@/api", () => ({ apiRequest: jest.fn() }));
import { apiRequest } from "@/api";

describe("backup api", () => {
  afterEach(() => jest.clearAllMocks());
  it("checks fingerprints and returns the existing map", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true, existing: { fp1: "file1" } });
    const map = await checkFingerprints("w1", ["fp1", "fp2"]);
    expect(map).toEqual({ fp1: "file1" });
    expect(apiRequest).toHaveBeenCalledWith("/api/backup/check", expect.objectContaining({ method: "POST", body: { workspace_id: "w1", fingerprints: ["fp1", "fp2"] } }));
  });
  it("records a fingerprint", async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ ok: true });
    await recordFingerprint("w1", "fp1", "file1");
    expect(apiRequest).toHaveBeenCalledWith("/api/backup/record", expect.objectContaining({ method: "POST", body: { workspace_id: "w1", fingerprint: "fp1", file_id: "file1" } }));
  });
});
