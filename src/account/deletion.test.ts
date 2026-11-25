import {
  RESEND_COOLDOWN_SECONDS, cooldownRemaining, describeBlocker,
  formatScheduledDate, daysRemaining, classifyDeleteError,
} from "./deletion";
import { ApiError } from "@/api/errors";

describe("RESEND_COOLDOWN_SECONDS", () => {
  it("matches the server's 60s cooldown, or the countdown lies", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});

describe("cooldownRemaining", () => {
  it("is zero before a code has been sent, so Resend starts enabled", () => {
    expect(cooldownRemaining(null, 1_000_000)).toBe(0);
  });

  it("counts down from 60 and floors at zero", () => {
    const t = 1_000_000;
    expect(cooldownRemaining(t, t)).toBe(60);
    expect(cooldownRemaining(t, t + 30_000)).toBe(30);
    expect(cooldownRemaining(t, t + 60_000)).toBe(0);
    expect(cooldownRemaining(t, t + 999_000)).toBe(0);
  });
});

describe("describeBlocker", () => {
  it("names the workspace, the count and the recovery", () => {
    const msg = describeBlocker({
      kind: "workspace_has_members", workspace_id: "w", workspace_name: "Acme", member_count: 3,
    });
    expect(msg).toContain("Acme");
    expect(msg).toContain("3 other members");
    expect(msg).toMatch(/transfer/i);
  });

  it("uses the singular for one member", () => {
    const msg = describeBlocker({
      kind: "workspace_has_members", workspace_id: "w", workspace_name: "Solo", member_count: 1,
    });
    expect(msg).toContain("1 other member");
    expect(msg).not.toContain("members");
  });
});

describe("daysRemaining", () => {
  it("floors rather than rounds, so it never overstates the time left", () => {
    const now = 1_000_000;
    // 1 day and 23 hours left reads as 1, not 2.
    expect(daysRemaining(now + 86400 + 82800, now)).toBe(1);
  });

  it("is zero once the date has passed", () => {
    const now = 1_000_000;
    expect(daysRemaining(now - 10, now)).toBe(0);
    expect(daysRemaining(now, now)).toBe(0);
  });

  it("counts whole days for a full window", () => {
    const now = 1_000_000;
    expect(daysRemaining(now + 30 * 86400, now)).toBe(30);
  });
});

describe("formatScheduledDate", () => {
  it("renders a human date rather than a timestamp", () => {
    const out = formatScheduledDate(Math.floor(Date.UTC(2026, 8, 12, 12) / 1000));
    expect(out).toMatch(/2026/);
    expect(out).not.toMatch(/^\d+$/);
  });
});

describe("classifyDeleteError", () => {
  it("separates the two 429s, which need opposite advice", () => {
    expect(classifyDeleteError(new ApiError("Too many incorrect attempts. Request a new code.", 429)).kind)
      .toBe("code_burned");
    expect(classifyDeleteError(new ApiError("Too many attempts. Try again later.", 429)).kind)
      .toBe("rate_limited");
  });

  it("tells the user to resend when the code is burned", () => {
    expect(classifyDeleteError(new ApiError("Too many incorrect attempts. Request a new code.", 429)).message)
      .toMatch(/resend/i);
  });

  it("passes a blocker message through verbatim, since the server names the workspaces", () => {
    const msg = "Some workspaces you own still have other members. Transfer or remove them first.";
    const f = classifyDeleteError(new ApiError(msg, 400));
    expect(f.kind).toBe("blocked");
    expect(f.message).toBe(msg);
  });

  it("treats a plain 400 as a wrong code and names the recovery", () => {
    const f = classifyDeleteError(new ApiError("That code is not correct.", 400));
    expect(f.kind).toBe("wrong_code");
    expect(f.message).toMatch(/check/i);
  });

  it("names a wrong password as such, so the user retypes rather than resends", () => {
    const f = classifyDeleteError(new ApiError("Password is incorrect", 403));
    expect(f.kind).toBe("wrong_password");
    expect(f.message).toMatch(/password/i);
    expect(f.message).not.toMatch(/resend|code/i);
  });

  it("passes the no-password refusal through, since it names the recovery (the emailed code)", () => {
    const msg = "This account has no password. Confirm with the emailed code instead.";
    const f = classifyDeleteError(new ApiError(msg, 400));
    expect(f.kind).toBe("no_password");
    expect(f.message).toBe(msg);
  });

  it("never surfaces an empty message for any input", () => {
    for (const e of [null, undefined, {}, "oops", new ApiError("", 500)]) {
      expect(classifyDeleteError(e).message.trim().length).toBeGreaterThan(0);
    }
  });
});
