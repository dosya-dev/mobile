jest.mock("expo-file-system/legacy", () => require("./testing/memoryFs").fsModule);

import {
  beginSession, cancelTasksFor, currentSession, endSession, fence, registerTask, withCommit,
  OFFLINE_ROOT, __resetSessionForTests,
} from "./session";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const task = () => ({ cancelAsync: jest.fn(async () => {}) });

beforeEach(() => __resetSessionForTests());

describe("offline session", () => {
  it("withCommit runs serially in FIFO order", async () => {
    const s = beginSession("acct");
    const log: string[] = [];
    const gate = deferred();
    const a = withCommit(s, async () => { log.push("a:start"); await gate.promise; log.push("a:end"); return "a"; });
    const b = withCommit(s, async () => { log.push("b"); return "b"; });
    const c = withCommit(s, async () => { log.push("c"); return "c"; });
    await Promise.resolve();
    expect(log).toEqual(["a:start"]);
    gate.resolve();
    expect(await Promise.all([a, b, c])).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a:start", "a:end", "b", "c"]);
  });

  it("a failing commit does not wedge the lock", async () => {
    const s = beginSession("acct");
    await expect(withCommit(s, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await withCommit(s, async () => 1)).toBe(1);
  });

  it("withCommit returns null and runs nothing when endSession happened while it waited", async () => {
    const s = beginSession("acct");
    const gate = deferred();
    const first = withCommit(s, async () => { await gate.promise; });
    const ran = jest.fn(async () => "wrote");
    const waiting = withCommit(s, ran);
    const ended = endSession();
    gate.resolve();
    await first;
    expect(await waiting).toBeNull();
    expect(ran).not.toHaveBeenCalled();
    await ended;
  });

  it("endSession resolves only after a running commit finishes", async () => {
    const s = beginSession("acct");
    const gate = deferred();
    const log: string[] = [];
    const running = withCommit(s, async () => { await gate.promise; log.push("commit done"); });
    await Promise.resolve();
    const ended = endSession().then(() => log.push("session ended"));
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual([]);
    gate.resolve();
    await Promise.all([running, ended]);
    expect(log).toEqual(["commit done", "session ended"]);
    expect(currentSession()).toBeNull();
  });

  it("a session from before endSession is fenced, even when the same account begins again", async () => {
    const old = beginSession("acct");
    await endSession();
    const again = beginSession("acct");
    expect(fence(old)).toBe(false);
    expect(fence(again)).toBe(true);
    expect(await withCommit(old, async () => "stale")).toBeNull();
  });

  it("beginSession for the account already running returns that session", () => {
    const s = beginSession("acct");
    expect(beginSession("acct")).toBe(s);
  });

  it("beginSession for another account fences the old one", () => {
    const a = beginSession("a");
    const b = beginSession("b");
    expect(fence(a)).toBe(false);
    expect(fence(b)).toBe(true);
    expect(b.root).toBe(`${OFFLINE_ROOT}b/`);
  });

  it("cancelTasksFor cancels only those files", async () => {
    beginSession("acct");
    const t1 = task();
    const t2 = task();
    const t3 = task();
    registerTask("f1", t1);
    registerTask("f2", t2);
    registerTask("f3", t3);
    await cancelTasksFor(["f1", "f3"]);
    expect(t1.cancelAsync).toHaveBeenCalled();
    expect(t3.cancelAsync).toHaveBeenCalled();
    expect(t2.cancelAsync).not.toHaveBeenCalled();
  });

  it("a task registered for an ended session is cancelled at once", async () => {
    const s = beginSession("acct");
    await endSession();
    const t1 = task();
    registerTask("f1", t1, s);
    expect(t1.cancelAsync).toHaveBeenCalled();
  });

  it("an unregistered task is not cancelled later", async () => {
    beginSession("acct");
    const t1 = task();
    const off = registerTask("f1", t1);
    off();
    await cancelTasksFor(["f1"]);
    expect(t1.cancelAsync).not.toHaveBeenCalled();
  });

  it("endSession cancels every running task", async () => {
    beginSession("acct");
    const t1 = task();
    const t2 = task();
    registerTask("f1", t1);
    registerTask("f2", t2);
    await endSession();
    expect(t1.cancelAsync).toHaveBeenCalled();
    expect(t2.cancelAsync).toHaveBeenCalled();
  });

  it("an account id cannot climb out of the offline root", () => {
    const s = beginSession("../../etc");
    expect(s.root.startsWith(OFFLINE_ROOT)).toBe(true);
    expect(s.root.slice(OFFLINE_ROOT.length)).not.toContain("..");
  });
});
