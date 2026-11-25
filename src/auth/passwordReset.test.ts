import {
  CODE_LENGTH, RESEND_COOLDOWN_SECONDS,
  isCompleteCode, normaliseCode, cooldownRemaining, classifyResetError,
} from "./passwordReset";
import { ApiError } from "@/api/errors";

describe("normaliseCode", () => {
  it("keeps digits only, so a pasted code with spaces or dashes still works", () => {
    expect(normaliseCode("12 34-56")).toBe("123456");
    expect(normaliseCode("abc123")).toBe("123");
  });

  it("caps at the code length rather than letting the field grow", () => {
    expect(normaliseCode("1234567890")).toBe("123456");
    expect(normaliseCode("1234567890").length).toBe(CODE_LENGTH);
  });

  it("returns an empty string for input with no digits", () => {
    expect(normaliseCode("....")).toBe("");
  });
});

describe("isCompleteCode", () => {
  it("is true only for exactly six digits", () => {
    expect(isCompleteCode("123456")).toBe(true);
    expect(isCompleteCode("12345")).toBe(false);
    expect(isCompleteCode("1234567")).toBe(false);
    expect(isCompleteCode("12345a")).toBe(false);
    expect(isCompleteCode("")).toBe(false);
  });
});

describe("cooldownRemaining", () => {
  it("is zero before any code has been sent, so Resend starts enabled", () => {
    expect(cooldownRemaining(null, 1_000_000)).toBe(0);
  });

  it("counts down from the server's 30 second cooldown", () => {
    const sentAt = 1_000_000;
    expect(cooldownRemaining(sentAt, sentAt)).toBe(RESEND_COOLDOWN_SECONDS);
    expect(cooldownRemaining(sentAt, sentAt + 10_000)).toBe(20);
    expect(cooldownRemaining(sentAt, sentAt + 29_000)).toBe(1);
  });

  it("floors at zero and never goes negative", () => {
    const sentAt = 1_000_000;
    expect(cooldownRemaining(sentAt, sentAt + 30_000)).toBe(0);
    expect(cooldownRemaining(sentAt, sentAt + 99_000)).toBe(0);
  });
});

describe("classifyResetError", () => {
  it("separates the two different 429s, because they need different recovery", () => {
    const burned = classifyResetError(
      new ApiError("Too many incorrect attempts. Request a new code.", 429),
    );
    expect(burned.kind).toBe("code_burned");

    const hourly = classifyResetError(new ApiError("Too many attempts. Try again later.", 429));
    expect(hourly.kind).toBe("rate_limited");
  });

  it("tells the user to request a new code when the old one is burned", () => {
    const burned = classifyResetError(
      new ApiError("Too many incorrect attempts. Request a new code.", 429),
    );
    expect(burned.message).toMatch(/resend/i);
  });

  it("treats a 400 as a wrong code and names the recovery", () => {
    const wrong = classifyResetError(new ApiError("Invalid or expired code", 400));
    expect(wrong.kind).toBe("wrong_code");
    expect(wrong.message).toMatch(/check/i);
  });

  it("falls back to unknown for a network error, without inventing a cause", () => {
    const unknown = classifyResetError(new Error("Network request failed"));
    expect(unknown.kind).toBe("unknown");
    expect(unknown.message.length).toBeGreaterThan(0);
  });

  it("never surfaces an empty message for any input", () => {
    for (const e of [null, undefined, {}, "oops", new ApiError("", 500)]) {
      expect(classifyResetError(e).message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("submitReset wire shape", () => {
  it("sends the new password as `new_password`, the field the API reads", async () => {
    jest.resetModules();
    const apiRequest = jest.fn().mockResolvedValue({ ok: true });
    jest.doMock("@/api/client", () => ({ apiRequest }));
    const { submitReset } = jest.requireActual("./passwordReset") as typeof import("./passwordReset");
    await submitReset(" Ayse@Acme.test ", "482913", "Str0ng!Passw0rd");
    expect(apiRequest).toHaveBeenCalledWith("/api/auth/reset-password-code", expect.objectContaining({
      method: "POST",
      body: { email: "ayse@acme.test", code: "482913", new_password: "Str0ng!Passw0rd" },
    }));
    jest.dontMock("@/api/client");
  });
});

describe("classifyResetError edge challenge", () => {
  it("tells the user to pick a different password when the security check refused it", () => {
    const err = Object.assign(new Error("Our security check blocked this request."), { status: 403, code: "edge_challenge" });
    const out = classifyResetError(err);
    expect(out.kind).toBe("password_refused");
    expect(out.message).toBe("Our security check refused that password. Choose a different, stronger one and try again.");
  });
});
