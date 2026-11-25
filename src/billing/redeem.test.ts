import { redeem, type RedeemDeps } from "./redeem";
import type { CouponCheck } from "./api";

const check = (over: Partial<CouponCheck> = {}): CouponCheck => ({
  ok: true,
  platforms: ["ios", "google"],
  store_code: "STORE1",
  store_terms: "1 TB for 3 months",
  ...over,
});

function deps(over: Partial<RedeemDeps> & { res?: CouponCheck } = {}) {
  const { res = check(), ...rest } = over;
  const d: RedeemDeps = {
    validateCode: jest.fn(async () => res),
    platform: "ios",
    androidMode: "none",
    setClipboard: jest.fn(async () => {}),
    invalidMessage: "We don't recognise that code.",
    ...rest,
  };
  return d;
}

it("reports an invalid code with the API's message", async () => {
  expect(await redeem("X", deps({ res: check({ ok: false, error: "Code expired" }) }))).toEqual({ kind: "invalid", message: "Code expired" });
});

it("falls back to the generic invalid message", async () => {
  expect(await redeem("X", deps({ res: check({ ok: false }) }))).toEqual({ kind: "invalid", message: "We don't recognise that code." });
});

it("treats a failed lookup as invalid", async () => {
  const d = deps();
  (d.validateCode as jest.Mock).mockRejectedValue(new Error("offline"));
  expect(await redeem("X", d)).toEqual({ kind: "invalid", message: "We don't recognise that code." });
});

it.each(["ios", "android"] as const)("no store counterpart on %s is web_only", async (platform) => {
  const d = deps({ platform, androidMode: "deep_link", res: check({ store_code: null, store_terms: null }) });
  expect(await redeem("X", d)).toEqual({ kind: "web_only" });
  expect(d.setClipboard).not.toHaveBeenCalled();
});

it("iOS copies the store code and returns the terms", async () => {
  const d = deps();
  expect(await redeem(" web-code ", d)).toEqual({ kind: "ios_sheet", terms: "1 TB for 3 months" });
  expect(d.setClipboard).toHaveBeenCalledWith("STORE1");
  expect(d.validateCode).toHaveBeenCalledWith("web-code");
});

it("iOS passes null terms through", async () => {
  expect(await redeem("X", deps({ res: check({ store_terms: null }) }))).toEqual({ kind: "ios_sheet", terms: null });
});

it("Android deep_link returns the Play redeem URL", async () => {
  const d = deps({ platform: "android", androidMode: "deep_link" });
  expect(await redeem("X", d)).toEqual({ kind: "android_link", url: "https://play.google.com/redeem?code=STORE1", terms: "1 TB for 3 months" });
  expect(d.setClipboard).not.toHaveBeenCalled();
});

it("Android play_sheet returns an empty url (start the normal purchase)", async () => {
  expect(await redeem("X", deps({ platform: "android", androidMode: "play_sheet" }))).toEqual({ kind: "android_link", url: "", terms: "1 TB for 3 months" });
});

it("Android with mode none and a Google counterpart is web_ios_only", async () => {
  expect(await redeem("X", deps({ platform: "android", androidMode: "none" }))).toEqual({ kind: "web_ios_only" });
});
