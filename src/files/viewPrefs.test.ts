const store: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
  getItemAsync: jest.fn(async (k: string) => (k in store ? store[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
}));

import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "./viewPrefs";

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  useViewPrefs.setState({ viewMode: "list", libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT }, hydrated: false });
});

it("defaults to list", () => {
  expect(useViewPrefs.getState().viewMode).toBe("list");
});

it("defaults the per-kind library layout to photos/videos grid, documents list", () => {
  expect(useViewPrefs.getState().libraryLayout).toEqual({ photos: "grid", videos: "grid", documents: "list" });
});

it("setViewMode updates and persists", async () => {
  await useViewPrefs.getState().setViewMode("grid");
  expect(useViewPrefs.getState().viewMode).toBe("grid");
  expect(store["dosya.files.viewMode"]).toBe("grid");
});

it("hydrate reads the persisted value", async () => {
  store["dosya.files.viewMode"] = "grid";
  await useViewPrefs.getState().hydrate();
  expect(useViewPrefs.getState().viewMode).toBe("grid");
  expect(useViewPrefs.getState().hydrated).toBe(true);
});

it("hydrate falls back to list when nothing is stored", async () => {
  await useViewPrefs.getState().hydrate();
  expect(useViewPrefs.getState().viewMode).toBe("list");
});

describe("setLibraryLayout", () => {
  it("updates the given kind, persists the whole record as JSON, and leaves the other kinds untouched", async () => {
    await useViewPrefs.getState().setLibraryLayout("documents", "grid");
    expect(useViewPrefs.getState().libraryLayout).toEqual({ photos: "grid", videos: "grid", documents: "grid" });
    expect(JSON.parse(store["dosya.files.libraryLayout"])).toEqual({ photos: "grid", videos: "grid", documents: "grid" });
  });

  it("changing one kind does not disturb another", async () => {
    await useViewPrefs.getState().setLibraryLayout("photos", "list");
    expect(useViewPrefs.getState().libraryLayout).toEqual({ photos: "list", videos: "grid", documents: "list" });
  });
});

describe("hydrate for libraryLayout", () => {
  it("parses a saved record", async () => {
    store["dosya.files.libraryLayout"] = JSON.stringify({ photos: "list", videos: "grid", documents: "grid" });
    await useViewPrefs.getState().hydrate();
    expect(useViewPrefs.getState().libraryLayout).toEqual({ photos: "list", videos: "grid", documents: "grid" });
  });

  it("ignores unknown kinds and merges over the defaults", async () => {
    store["dosya.files.libraryLayout"] = JSON.stringify({ photos: "list", spreadsheets: "grid" });
    await useViewPrefs.getState().hydrate();
    expect(useViewPrefs.getState().libraryLayout).toEqual({ photos: "list", videos: "grid", documents: "list" });
  });

  it("falls back to the defaults on invalid JSON", async () => {
    store["dosya.files.libraryLayout"] = "{not json";
    await useViewPrefs.getState().hydrate();
    expect(useViewPrefs.getState().libraryLayout).toEqual(DEFAULT_LIBRARY_LAYOUT);
  });

  it("falls back to the defaults on a non-object value", async () => {
    store["dosya.files.libraryLayout"] = JSON.stringify("grid");
    await useViewPrefs.getState().hydrate();
    expect(useViewPrefs.getState().libraryLayout).toEqual(DEFAULT_LIBRARY_LAYOUT);
  });

  it("ignores an invalid mode for a known kind, keeping that kind's default", async () => {
    store["dosya.files.libraryLayout"] = JSON.stringify({ photos: "carousel" });
    await useViewPrefs.getState().hydrate();
    expect(useViewPrefs.getState().libraryLayout).toEqual(DEFAULT_LIBRARY_LAYOUT);
  });

  it("falls back to the defaults when nothing is stored", async () => {
    await useViewPrefs.getState().hydrate();
    expect(useViewPrefs.getState().libraryLayout).toEqual(DEFAULT_LIBRARY_LAYOUT);
  });
});
