/**
 * What NativeWind 4.2 compiles the logical classes to on native, and why
 * border-s/e are banned. NativeWind rem is 14, so spacing steps are 3.5 per unit
 * (ms-2 is 7, not 8); arbitrary px values are exact. The test name ends with the class under test
 * (renderCurrentTest reads it from there).
 */
import { renderCurrentTest } from "nativewind/test";

// nativewind/test loads @tailwindcss/container-queries, which is not a dependency of this app and is
// not used by any class below; an inert plugin keeps the helper loadable.
jest.mock("@tailwindcss/container-queries", () => ({ handler: () => {} }), { virtual: true });

describe("logical classes", () => {
  test("ms-2", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({ marginStart: 7 });
  });
  test("pe-3", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({ paddingEnd: 10.5 });
  });
  test("start-1", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({ insetInlineStart: 3.5 });
  });
  test("end-0", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({ insetInlineEnd: 0 });
  });
  test("ms-auto", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({ marginStart: "auto" });
  });
  test("-end-1", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({ insetInlineEnd: -3.5 });
  });
  test("rounded-s-[4px]", async () => {
    expect((await renderCurrentTest()).props.style).toEqual({
      borderStartStartRadius: 4,
      borderEndStartRadius: 4,
    });
  });
  test("border-s-2", async () => {
    // Banned: compiled to the physical left width, so it would not mirror.
    expect((await renderCurrentTest()).props.style).toEqual({ borderLeftWidth: 2 });
  });
});
