// Manual mock for @sentry/react-native, auto-applied under jest for every
// test (node_modules packages with a mock here need no jest.mock call - same
// mechanism as __mocks__/expo-image.js). The real SDK touches native modules
// at init and patches the global Promise, neither of which belongs in a unit
// test. Every entry point the app uses is an inert jest.fn so tests can assert
// on the WIRING (what gets reported, with what user) without a network.
const registerNavigationContainer = jest.fn();

module.exports = {
  init: jest.fn(),
  wrap: jest.fn((Component) => Component),
  captureException: jest.fn(() => "evt_mock"),
  captureMessage: jest.fn(),
  setUser: jest.fn(),
  setTag: jest.fn(),
  addBreadcrumb: jest.fn(),
  reactNavigationIntegration: jest.fn(() => ({ name: "ReactNavigation", registerNavigationContainer })),
  mobileReplayIntegration: jest.fn(() => ({ name: "MobileReplay" })),
};
