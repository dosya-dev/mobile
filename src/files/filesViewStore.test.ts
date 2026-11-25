import { useFilesView, FILES_VIEWS } from "./filesViewStore";

describe("useFilesView", () => {
  beforeEach(() => useFilesView.setState({ view: "all" }));

  it("defaults to all", () => {
    expect(useFilesView.getState().view).toBe("all");
  });

  it("setView changes the view", () => {
    useFilesView.getState().setView("images");
    expect(useFilesView.getState().view).toBe("images");
  });

  it("lists the views in menu order, without Personas", () => {
    expect(FILES_VIEWS.map((v) => v.key)).toEqual(["all", "documents", "videos", "images", "hidden"]);
  });
});
