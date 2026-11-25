import { shouldHideTabBar } from "./tabBarVisibility";

describe("shouldHideTabBar", () => {
  it("hides the bar for the full-screen viewer", () => {
    expect(shouldHideTabBar("file/[id]")).toBe(true);
  });

  it("keeps the bar for browsing", () => {
    expect(shouldHideTabBar("index")).toBe(false);
    expect(shouldHideTabBar("folder/[id]")).toBe(false);
  });

  // The viewer's sub-routes are ordinary pushed screens with their own headers.
  it("keeps the bar for the viewer's sub-routes", () => {
    expect(shouldHideTabBar("file/[id]/share")).toBe(false);
    expect(shouldHideTabBar("file/[id]/versions")).toBe(false);
    expect(shouldHideTabBar("file/[id]/contacts")).toBe(false);
  });

  // getFocusedRouteNameFromRoute returns undefined until the nested navigator
  // has laid out. Treating that as "hide" flickers the bar away on cold start.
  it("shows the bar when the focused route is not known yet", () => {
    expect(shouldHideTabBar(undefined)).toBe(false);
    expect(shouldHideTabBar("")).toBe(false);
  });
});
