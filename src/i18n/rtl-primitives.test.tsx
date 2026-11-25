import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react-native";
import { ListPager, usePager } from "../ui/ListPager";
import { SettingsRow } from "../ui/SettingsRow";
import { renderInLocale, unflippedIcons } from "../../test-utils/i18n-sweep";

function Pager() {
  const pager = usePager(30);
  return <ListPager pager={pager} testID="pg" what="items" />;
}

describe("shared primitives in RTL", () => {
  it("ListPager mirrors its chevrons", async () => {
    await renderInLocale(<Pager />, "ar");
    expect(screen.getByTestId("pg")).toBeTruthy();
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
  });

  it("SettingsRow mirrors its chevron", async () => {
    await renderInLocale(<SettingsRow testID="row" label="x" onPress={() => {}} />, "ar");
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
  });
});

describe("src/ui source gate", () => {
  it("lists nothing unmarked", () => {
    const root = join(__dirname, "../..");
    const files = readdirSync(join(root, "src/ui"))
      .filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f))
      .map((f) => join("src/ui", f));
    expect(() => execFileSync("node", ["scripts/rtl-gate.mjs", "--check", ...files], { cwd: root, encoding: "utf8" })).not.toThrow();
  });
});
