import { isSafeExternalUrl } from "./safeUrl";

describe("isSafeExternalUrl", () => {
  it("allows https links", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("rejects the PoC payloads from the Strix report", () => {
    expect(isSafeExternalUrl("myapp://settings")).toBe(false);
    expect(isSafeExternalUrl("javascript:location='https://evil.test'")).toBe(false);
  });

  it("rejects other non-https schemes", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(false);
    expect(isSafeExternalUrl("mailto:a@b.com")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects scheme-less and malformed input", () => {
    expect(isSafeExternalUrl("example.com")).toBe(false);
    expect(isSafeExternalUrl("//example.com")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});
