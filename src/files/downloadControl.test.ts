jest.mock("./transferNotice", () => ({
  clearTransferNotification: jest.fn(async () => {}),
}));

import { cancelDownload, forgetTask, registerTask } from "./downloadControl";
import { useDownloadStore } from "./downloadStore";
import { clearTransferNotification } from "./transferNotice";

const task = () => ({ cancelAsync: jest.fn(async () => {}) });

beforeEach(() => {
  jest.clearAllMocks();
  useDownloadStore.getState().clearAll();
  forgetTask("f1");
});

// The registry exists so a transfer can be stopped from the dock or the list,
// not only from the viewer that happened to start it.
it("stops the native download, not just the row that reports it", async () => {
  const t = task();
  useDownloadStore.getState().start("f1", "match.mp4", 0);
  registerTask("f1", t);
  await cancelDownload("f1");
  expect(t.cancelAsync).toHaveBeenCalled();
});

it("takes the transfer off screen and out of the tray", async () => {
  useDownloadStore.getState().start("f1", "match.mp4", 0);
  registerTask("f1", task());
  await cancelDownload("f1");
  expect(useDownloadStore.getState().entries["f1"]).toBeUndefined();
  expect(clearTransferNotification).toHaveBeenCalledWith("f1");
});

// The entry outlives the native task - a failed transfer has no task left but
// still has a row the user may want gone.
it("still clears the row when the native task has already gone", async () => {
  useDownloadStore.getState().start("f1", "match.mp4", 0);
  await expect(cancelDownload("f1")).resolves.toBeUndefined();
  expect(useDownloadStore.getState().entries["f1"]).toBeUndefined();
});

it("survives a native cancel that rejects, rather than stranding the row", async () => {
  useDownloadStore.getState().start("f1", "match.mp4", 0);
  registerTask("f1", { cancelAsync: jest.fn(async () => { throw new Error("already gone"); }) });
  await expect(cancelDownload("f1")).resolves.toBeUndefined();
  expect(useDownloadStore.getState().entries["f1"]).toBeUndefined();
});

it("does not cancel a different file's transfer", async () => {
  const t = task();
  registerTask("f1", t);
  await cancelDownload("f2");
  expect(t.cancelAsync).not.toHaveBeenCalled();
});

it("drops the handle once the transfer is over, so it cannot be reused", async () => {
  const t = task();
  registerTask("f1", t);
  forgetTask("f1");
  await cancelDownload("f1");
  expect(t.cancelAsync).not.toHaveBeenCalled();
});
