import { View } from "react-native";
import { screen } from "@testing-library/react-native";
import { Icon } from "../ui/Icon";
import { __setLayoutRtlForTests } from "../lib/direction";
import { renderInLocale, ltrIslands, unflippedIcons } from "../../test-utils/i18n-sweep";

describe("unflippedIcons", () => {
  it("finds a bare chevron-forward under the RTL seam", async () => {
    // Icon flips itself in RTL, so render left to right (no flip) and only then switch the seam.
    await renderInLocale(<Icon name="chevron-forward" size={16} color="#000" />, "en");
    __setLayoutRtlForTests(true);
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual(["chevron-forward"]);
  });

  it("accepts it inside an ltr island, with mirror={false}, or when flipped", async () => {
    await renderInLocale(
      <>
        <View style={{ direction: "ltr" }}>
          <Icon name="chevron-forward" size={16} color="#000" />
        </View>
        <Icon name="chevron-back" size={16} color="#000" {...({ mirror: false } as object)} />
        <Icon name="log-out-outline" size={16} color="#000" style={{ transform: [{ scaleX: -1 }] }} />
        <Icon name="share-outline" size={16} color="#000" />
      </>,
      "ar",
    );
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
  });

  it("reports nothing under the LTR seam", async () => {
    await renderInLocale(<Icon name="chevron-forward" size={16} color="#000" />, "en");
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
  });
});

describe("ltrIslands", () => {
  it("returns the hosts whose flattened style has direction ltr", async () => {
    await renderInLocale(
      <View testID="outer">
        <View testID="island" style={[{ flex: 1 }, { direction: "ltr" }]} />
        <View testID="plain" />
      </View>,
      "ar",
    );
    expect(ltrIslands(screen.UNSAFE_root).map((n) => n.props.testID)).toEqual(["island"]);
  });
});
