import "@testing-library/react-native/extend-expect";

// react-native-safe-area-context withholds rendering its children in the
// jest environment until it has measured insets, which jsdom/node never
// provides. The library ships an official jest mock (SafeAreaProvider with
// fixed initialMetrics) - use it so components wrapped in SafeAreaProvider
// actually render their children under test.
jest.mock("react-native-safe-area-context", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-safe-area-context/jest/mock").default ??
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("react-native-safe-area-context/jest/mock"),
);

// expo-video wires up its NativeVideoModule.VideoPlayer.prototype at module-eval
// time (outside any component/hook), and that native module doesn't exist under
// jest - importing it unmocked throws immediately. Jest-expo ships no mock for
// this module, so provide a minimal one: a no-op player object and an inert
// VideoView, enough for screens to render without exercising real playback.
jest.mock("expo-video", () => ({
  useVideoPlayer: () => ({}),
  VideoView: () => null,
}));

// Video posters (src/files/posterCache.ts) grab a frame and shrink it through
// two native modules jest does not have. Inert by default - a grab that never
// resolves leaves a card on its glyph - and posterCache.test.ts drives them.
jest.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: jest.fn(() => new Promise(() => {})),
}));
jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

// expo-localization reads the device locale list from a native module that
// jest does not have. Default to US English; tests override per case.
jest.mock("expo-localization", () => ({
  getLocales: () => [
    { languageTag: "en-US", languageCode: "en", regionCode: "US", languageScriptCode: null },
  ],
}));

// react-native-webview's native view isn't registered under jest either; stub
// it out as an inert component so screens that render a WebView don't crash.
jest.mock("react-native-webview", () => ({
  WebView: () => null,
}));

// expo-image is mocked via the manual mock at __mocks__/expo-image.js (auto-applied
// for this node_modules package). It renders its Image as an inert host element so
// thumbnail components mount and are queryable without a native image module. The
// mock lives in a file (not an inline jest.mock factory here) because nativewind's
// babel transform injects an out-of-scope reference when it rewrites element
// creation inside a jest.mock factory.

// react-native-gesture-handler's official jest setup: the handler components
// render as plain views and gestures can be driven with its jest-utils.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("react-native-gesture-handler/jestSetup");

// expo-haptics talks to a native module; under jest a haptic is a no-op.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

// react-native-reanimated's native worklet runtime doesn't exist under jest.
// The library ships an official inert mock; spread it and stub the couple of
// helpers the mock has historically omitted so components render as plain views.
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require("react-native-reanimated/mock");
  return {
    ...mock,
    default: mock.default ?? mock,
    withDelay: mock.withDelay ?? ((_delay: number, v: unknown) => v),
    cancelAnimation: mock.cancelAnimation ?? (() => {}),
    useReducedMotion: mock.useReducedMotion ?? (() => false),
  };
});

// reloadAppAsync restarts the native JS runtime; under jest it must be inert.
// Everything else in "expo" is the real module, loaded only when first read:
// jest.requireActual("expo") up front would pull expo-asset and the native
// module registry into tests that mock expo-modules-core themselves.
jest.mock("expo", () => {
  const reloadAppAsync = jest.fn(async () => {});
  let actual: Record<string | symbol, unknown> | undefined;
  const real = (): Record<string | symbol, unknown> => (actual ??= jest.requireActual("expo") as Record<string | symbol, unknown>);
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (_t, key) => (key === "reloadAppAsync" ? reloadAppAsync : real()[key]),
    has: (_t, key) => key === "reloadAppAsync" || key in real(),
    ownKeys: () => [...new Set([...Reflect.ownKeys(real()), "reloadAppAsync"])],
    getOwnPropertyDescriptor: (_t, key) => ({
      configurable: true,
      enumerable: true,
      value: key === "reloadAppAsync" ? reloadAppAsync : real()[key],
    }),
  });
});

// The layout-direction seam never leaks from one test into the next.
afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("./src/lib/direction-seam").setLayoutOverride(null);
});

// No test may reach the network. API_BASE_URL falls back to the live
// https://api.dosya.dev when EXPO_PUBLIC_API_BASE_URL is unset - which is the
// case in CI - so any component that fetches during a test was hitting
// production for real, and the keep-alive TLS sockets it left behind (visible
// as TLSWRAP in --detectOpenHandles) kept the jest worker alive until the step
// was killed. Failing the way the app's own network-error path expects keeps
// those components on the branch they already handle. Tests that need a
// response assign their own globalThis.fetch, which still wins.
beforeEach(() => {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
    throw new TypeError("Network request failed");
  });
});
