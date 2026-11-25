import { StyleSheet } from "react-native";
import { screen } from "@testing-library/react-native";
import { Icon, DIRECTIONAL_ICONS, type IconName } from "./Icon";
import { renderInLocale } from "../../test-utils/i18n-sweep";

type Inst = { type: unknown; props: Record<string, unknown>; findAll(p: (n: Inst) => boolean): Inst[] };

/** The style the glyph under the first Icon was given. */
function glyphStyle(): Record<string, unknown> {
  const icon = (screen.UNSAFE_root as unknown as Inst).findAll((n) => n.type === Icon)[0];
  const glyph = icon.findAll((n) => n !== icon && n.props.style !== undefined)[0];
  return (StyleSheet.flatten(glyph?.props.style as never) ?? {}) as Record<string, unknown>;
}

function scaleX(): number | undefined {
  const t = glyphStyle().transform as { scaleX?: number }[] | undefined;
  return t?.find((x) => x.scaleX !== undefined)?.scaleX;
}

const props = { size: 16, color: "#000" };

describe("Icon direction", () => {
  it("lists exactly the seven directional names", () => {
    expect([...DIRECTIONAL_ICONS].sort()).toEqual(
      ["arrow-forward-outline", "arrow-undo", "arrow-undo-outline", "chevron-back", "chevron-forward", "log-out-outline", "send-outline"],
    );
  });

  it("mirrors a directional icon in an RTL layout", async () => {
    await renderInLocale(<Icon name="chevron-forward" {...props} />, "ar");
    expect(scaleX()).toBe(-1);
  });

  it.each(["play-skip-forward", "share-outline", "swap-horizontal", "checkmark"] as IconName[])(
    "never mirrors %s",
    async (name) => {
      await renderInLocale(<Icon name={name} {...props} />, "ar");
      expect(scaleX()).toBeUndefined();
    },
  );

  it("mirror={false} opts out", async () => {
    await renderInLocale(<Icon name="chevron-forward" mirror={false} {...props} />, "ar");
    expect(scaleX()).toBeUndefined();
  });

  it("keeps the caller style first", async () => {
    const style = { opacity: 0.5 };
    await renderInLocale(<Icon name="chevron-back" style={style} {...props} />, "he");
    const icon = (screen.UNSAFE_root as unknown as Inst).findAll((n) => n.type === Icon)[0];
    const glyph = icon.findAll((n) => n !== icon && Array.isArray(n.props.style))[0];
    expect((glyph.props.style as unknown[])[0]).toBe(style);
    expect(glyphStyle().opacity).toBe(0.5);
    expect(scaleX()).toBe(-1);
  });

  it("flips a wrapping View, never the Svg itself (react-native-svg would move the drawing out of its box)", async () => {
    await renderInLocale(<Icon name="chevron-back" style={{ marginTop: 2 }} {...props} />, "ar");
    const icon = (screen.UNSAFE_root as unknown as Inst).findAll((n) => n.type === Icon)[0];
    const svgs = icon.findAll((n) => typeof n.type !== "string" && n.type !== Icon && (n.props as { size?: unknown }).size === 16);
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      const t = (StyleSheet.flatten(svg.props.style as never) ?? {}) as { transform?: unknown };
      expect(t.transform).toBeUndefined();
    }
    expect(scaleX()).toBe(-1);
    expect(glyphStyle().marginTop).toBe(2);
  });

  it("adds no transform at all in a left-to-right layout", async () => {
    await renderInLocale(<Icon name="chevron-forward" {...props} />, "en");
    expect(glyphStyle().transform).toBeUndefined();
    const icon = (screen.UNSAFE_root as unknown as Inst).findAll((n) => n.type === Icon)[0];
    const glyph = icon.findAll((n) => n !== icon)[0];
    expect("style" in glyph.props).toBe(false);
  });
});
