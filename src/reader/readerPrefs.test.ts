import * as SecureStore from "expo-secure-store";
import { useReaderPrefs, FONT_MIN, FONT_MAX } from "./readerPrefs";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}));
const store = SecureStore as jest.Mocked<typeof SecureStore>;

beforeEach(() => {
  jest.clearAllMocks();
  useReaderPrefs.setState({ fontSizePct: 100, themeId: "light", hydrated: false });
});

it("hydrates saved prefs", async () => {
  store.getItemAsync.mockResolvedValue(JSON.stringify({ fontSizePct: 130, themeId: "ocean" }));
  await useReaderPrefs.getState().hydrate();
  expect(useReaderPrefs.getState().fontSizePct).toBe(130);
  expect(useReaderPrefs.getState().themeId).toBe("ocean");
  expect(useReaderPrefs.getState().hydrated).toBe(true);
});

it("falls back to light on an unknown themeId, but still hydrates", async () => {
  store.getItemAsync.mockResolvedValue(JSON.stringify({ fontSizePct: 100, themeId: "not-a-real-theme" }));
  await useReaderPrefs.getState().hydrate();
  expect(useReaderPrefs.getState().themeId).toBe("light");
  expect(useReaderPrefs.getState().hydrated).toBe(true);
});

it("hydrates a value stored under the old shape ({theme}) without throwing", async () => {
  store.getItemAsync.mockResolvedValue(JSON.stringify({ theme: "sepia" }));
  await expect(useReaderPrefs.getState().hydrate()).resolves.not.toThrow();
  expect(useReaderPrefs.getState().themeId).toBe("light");
  expect(useReaderPrefs.getState().hydrated).toBe(true);
});

it("hydrates defaults on corrupt payload", async () => {
  store.getItemAsync.mockResolvedValue("{nope");
  await useReaderPrefs.getState().hydrate();
  expect(useReaderPrefs.getState().fontSizePct).toBe(100);
  expect(useReaderPrefs.getState().hydrated).toBe(true);
});

it("persists and clamps font size", async () => {
  await useReaderPrefs.getState().setFontSizePct(FONT_MAX + 50);
  expect(useReaderPrefs.getState().fontSizePct).toBe(FONT_MAX);
  await useReaderPrefs.getState().setFontSizePct(FONT_MIN - 50);
  expect(useReaderPrefs.getState().fontSizePct).toBe(FONT_MIN);
  expect(store.setItemAsync).toHaveBeenCalledWith(
    "dosya.reader.prefs",
    JSON.stringify({ fontSizePct: FONT_MIN, themeId: "light" }),
  );
});

it("setThemeId persists", async () => {
  await useReaderPrefs.getState().setThemeId("dark");
  expect(useReaderPrefs.getState().themeId).toBe("dark");
  expect(store.setItemAsync).toHaveBeenCalledWith(
    "dosya.reader.prefs",
    JSON.stringify({ fontSizePct: 100, themeId: "dark" }),
  );
});
