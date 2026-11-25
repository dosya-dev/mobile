import { isLiveStill, isLiveTwin, collapseLiveTwins, twinsUnderStills, liveTwinOf } from "./livePhotos";

const still = { id: "s1", live_video_id: "v1", live_photo_id: null };
const twin = { id: "v1", live_video_id: null, live_photo_id: "s1" };
const plain = { id: "p1", live_video_id: null, live_photo_id: null };
const legacy = { id: "l1" } as { id: string; live_video_id?: string | null; live_photo_id?: string | null };

describe("live-photos helpers", () => {
  it("classifies rows, treating missing fields as no pair", () => {
    expect(isLiveStill(still)).toBe(true);
    expect(isLiveTwin(twin)).toBe(true);
    expect(isLiveStill(plain)).toBe(false);
    expect(isLiveTwin(legacy)).toBe(false);
  });

  it("collapse removes twins and keeps order", () => {
    expect(collapseLiveTwins([twin, still, plain]).map((f) => f.id)).toEqual(["s1", "p1"]);
  });

  it("twinsUnderStills moves each twin directly after its still, whatever the sort", () => {
    expect(twinsUnderStills([twin, plain, still]).map((f) => f.id)).toEqual(["p1", "s1", "v1"]);
  });

  it("a twin whose still is not in the list stays where it is", () => {
    expect(twinsUnderStills([twin, plain]).map((f) => f.id)).toEqual(["v1", "p1"]);
    expect(collapseLiveTwins([twin, plain]).map((f) => f.id)).toEqual(["v1", "p1"]);
  });

  it("liveTwinOf finds the twin row when present", () => {
    expect(liveTwinOf([still, twin], still)?.id).toBe("v1");
    expect(liveTwinOf([still], still)).toBeNull();
    expect(liveTwinOf([still, twin], plain)).toBeNull();
    expect(liveTwinOf([still, twin], twin)).toBeNull();
  });
});
