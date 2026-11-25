import { StyleSheet, Text } from "react-native";
import { screen } from "@testing-library/react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { OrbitTabBar } from "@/orbit/OrbitTabBar";
import { renderInLocale } from "../../test-utils/i18n-sweep";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/files/downloadControl", () => ({ cancelDownload: jest.fn(async () => {}) }));
jest.mock("@/upload/controller", () => ({ retryItem: jest.fn(), startUploads: jest.fn() }));
jest.mock("@/upload/startFromPicker", () => ({ startFromPicker: jest.fn(async () => {}) }));
jest.mock("@/player/controller", () => ({
  togglePlay: jest.fn(async () => {}),
  next: jest.fn(async () => {}),
  stopAndClear: jest.fn(async () => {}),
}));

const ROUTES = [
  { key: "files-1", name: "(files)", params: undefined },
  { key: "settings-1", name: "settings", params: undefined },
];

function props(): BottomTabBarProps {
  const navigation = { navigate: jest.fn(), emit: jest.fn(() => ({ defaultPrevented: false })) };
  return {
    state: { index: 0, routes: ROUTES, key: "tabs", routeNames: ROUTES.map((r) => r.name) },
    descriptors: Object.fromEntries(
      ROUTES.map((r) => [r.key, { options: { title: r.name, tabBarIcon: () => <Text>icon</Text> }, route: r, navigation }]),
    ),
    navigation,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as BottomTabBarProps;
}

// The orbit button sits in the MIDDLE of the bar, so it needs no side at all:
// the row mirrors with the native direction and the button stays put. A
// physical left or right on its wrapper would pin it off-centre in one of them.
it.each(["he", "en"] as const)("centres the orbit button with no physical side in %s", async (locale) => {
  await renderInLocale(<OrbitTabBar {...props()} />, locale);
  const ids = screen.getByTestId("orbit-bar").props.children.flat().map((c: { props: { testID: string } }) => c.props.testID);
  expect(ids).toEqual(["orbit-tab-(files)", "orbit-button-slot", "orbit-tab-settings"]);
  const style = StyleSheet.flatten(screen.getByTestId("orbit-button-slot").props.style) as Record<string, unknown>;
  expect(style).not.toHaveProperty("right");
  expect(style).not.toHaveProperty("left");
});
