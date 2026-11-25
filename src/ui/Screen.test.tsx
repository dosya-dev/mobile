import { render } from "@testing-library/react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/ui/Text";
import { Screen } from "./Screen";

function renderedEdges(ui: React.ReactElement): readonly string[] {
  const { UNSAFE_getByType } = render(ui);
  return UNSAFE_getByType(SafeAreaView).props.edges;
}

it("keeps every inset by default - stack screens reach the physical screen edges", () => {
  const edges = renderedEdges(
    <Screen title="Profile">
      <Text>body</Text>
    </Screen>,
  );
  expect(edges).toEqual(expect.arrayContaining(["top", "left", "right", "bottom"]));
});

it("drops only the top inset under a native stack header", () => {
  const edges = renderedEdges(
    <Screen underNativeHeader>
      <Text>body</Text>
    </Screen>,
  );
  expect(edges).not.toContain("top");
  expect(edges).toEqual(expect.arrayContaining(["left", "right", "bottom"]));
});

it("drops only the bottom inset above the tab bar", () => {
  const edges = renderedEdges(
    <Screen title="Settings" aboveTabBar>
      <Text>body</Text>
    </Screen>,
  );
  expect(edges).not.toContain("bottom");
  expect(edges).toEqual(expect.arrayContaining(["top", "left", "right"]));
});
