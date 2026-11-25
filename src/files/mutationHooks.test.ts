describe("removeWithTwin", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("removeWithTwin deletes the still then its twin", async () => {
    const deleteFile = jest.fn(async (_id: string) => {});
    jest.doMock("./mutations", () => ({ deleteFile }));
    const { removeWithTwin } = require("./mutationHooks");
    const outcome = await removeWithTwin({ id: "s", live_video_id: "v" }, true);
    expect(deleteFile.mock.calls.map((c) => c[0])).toEqual(["s", "v"]);
    expect(outcome).toEqual({ twinDeleted: true });
    const outcome2 = await removeWithTwin({ id: "s", live_video_id: "v" }, false);
    expect(deleteFile).toHaveBeenLastCalledWith("s");
    expect(outcome2).toEqual({ twinDeleted: null });
  });

  it("withTwin false never touches the twin and reports twinDeleted: null", async () => {
    const deleteFile = jest.fn(async (_id: string) => {});
    jest.doMock("./mutations", () => ({ deleteFile }));
    const { removeWithTwin } = require("./mutationHooks");
    const outcome = await removeWithTwin({ id: "s", live_video_id: "v" }, false);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("s");
    expect(outcome).toEqual({ twinDeleted: null });
  });

  it("a still delete that throws rejects and never reaches the twin", async () => {
    const deleteFile = jest.fn(async (id: string) => {
      if (id === "s") throw new Error("still gone");
    });
    jest.doMock("./mutations", () => ({ deleteFile }));
    const { removeWithTwin } = require("./mutationHooks");
    await expect(removeWithTwin({ id: "s", live_video_id: "v" }, true)).rejects.toThrow("still gone");
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("s");
  });

  it("a twin delete that throws still deletes the still and reports twinDeleted: false", async () => {
    const deleteFile = jest.fn(async (id: string) => {
      if (id === "v") throw new Error("twin gone");
    });
    jest.doMock("./mutations", () => ({ deleteFile }));
    const { removeWithTwin } = require("./mutationHooks");
    const outcome = await removeWithTwin({ id: "s", live_video_id: "v" }, true);
    expect(deleteFile.mock.calls.map((c) => c[0])).toEqual(["s", "v"]);
    expect(outcome).toEqual({ twinDeleted: false });
  });
});
