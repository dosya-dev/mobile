import {
  isHiddenModeSettable, requiresPassword, describeProtection,
  SETTABLE_HIDDEN_MODES, MIN_LOCK_PASSWORD_LENGTH,
  LOCK_MODE_OPTIONS, canApplyLock, describeLockMode, describeLockStatus, describeLockTarget,
  lockActionLabel, passwordFieldLabel, passwordHint,
} from "./protection";

describe("isHiddenModeSettable", () => {
  it("allows the two modes mobile can express", () => {
    expect(isHiddenModeSettable("none")).toBe(true);
    expect(isHiddenModeSettable("everyone")).toBe(true);
  });

  it("refuses the modes that need a member or role picker mobile does not have", () => {
    expect(isHiddenModeSettable("users")).toBe(false);
    expect(isHiddenModeSettable("roles")).toBe(false);
  });

  it("exposes exactly the settable modes, so the radio list cannot drift from the rule", () => {
    expect(SETTABLE_HIDDEN_MODES).toEqual(["none", "everyone"]);
    for (const m of SETTABLE_HIDDEN_MODES) expect(isHiddenModeSettable(m)).toBe(true);
  });
});

describe("requiresPassword", () => {
  it("is true only for full_lock", () => {
    expect(requiresPassword("full_lock")).toBe(true);
    expect(requiresPassword("view_only")).toBe(false);
    expect(requiresPassword("none")).toBe(false);
  });
});

describe("MIN_LOCK_PASSWORD_LENGTH", () => {
  it("matches the web lock modal so the clients reject the same passwords", () => {
    expect(MIN_LOCK_PASSWORD_LENGTH).toBe(8);
  });
});

describe("describeProtection", () => {
  it("returns null when nothing is set, so no badge renders", () => {
    expect(describeProtection({ lock_mode: "none", hidden_mode: "none" })).toBeNull();
    expect(describeProtection({})).toBeNull();
  });

  it("describes the lock modes", () => {
    expect(describeProtection({ lock_mode: "view_only" })).toBe("View only");
    expect(describeProtection({ lock_mode: "full_lock" })).toBe("Locked");
  });

  it("reports lock before hide, because lock is the stronger control", () => {
    expect(describeProtection({ lock_mode: "full_lock", hidden_mode: "everyone" })).toBe("Locked");
  });

  it("names the count for the modes mobile cannot set, so the label explains itself", () => {
    expect(describeProtection({ hidden_mode: "roles", hidden_rule_count: 3 }))
      .toBe("Hidden from 3 roles");
    expect(describeProtection({ hidden_mode: "users", hidden_rule_count: 1 }))
      .toBe("Hidden from 1 user");
  });

  it("falls back gracefully when the count is missing", () => {
    expect(describeProtection({ hidden_mode: "roles" })).toBe("Hidden from specific roles");
    expect(describeProtection({ hidden_mode: "users" })).toBe("Hidden from specific users");
  });

  it("says hidden from everybody without a count", () => {
    expect(describeProtection({ hidden_mode: "everyone", hidden_rule_count: 9 }))
      .toBe("Hidden from everybody");
  });

  it("tolerates nulls, which some list endpoints send for these columns", () => {
    expect(describeProtection({ lock_mode: null, hidden_mode: null })).toBeNull();
  });
});

// --- Lock dialog model: shared with web/desktop word for word so the three
// dialogs say the same thing about the same lock_mode.

describe("LOCK_MODE_OPTIONS", () => {
  it("offers the three modes in order, with the user-facing labels", () => {
    expect(LOCK_MODE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ["none", "Unlocked"], ["view_only", "View only"], ["full_lock", "Password"],
    ]);
  });
});

describe("describeLockMode", () => {
  it("tells a file owner what each mode allows", () => {
    expect(describeLockMode("file", "none")).toBe("Anyone with access to it can open, download and edit it.");
    expect(describeLockMode("file", "view_only")).toBe("Members can preview it in the viewer, but not download or edit it.");
    expect(describeLockMode("file", "full_lock")).toBe("Opens only with a password. An unlock lasts an hour, and share links to it stop working while it is locked.");
  });

  it("tells a folder owner the folder-specific consequences", () => {
    expect(describeLockMode("folder", "none")).toBe("Anyone with access to it can open it and work with everything inside.");
    expect(describeLockMode("folder", "view_only")).toBe("Members can browse and preview what is inside, but not download it.");
    expect(describeLockMode("folder", "full_lock")).toBe("Opens only with a password. While it is locked nothing can be added inside and share links to its contents stop working. An unlock lasts an hour.");
  });
});

describe("lockActionLabel", () => {
  it("names the change the button will make", () => {
    expect(lockActionLabel({ selected: "none", current: "full_lock" })).toBe("Remove lock");
    expect(lockActionLabel({ selected: "view_only", current: "none" })).toBe("Set view only");
    expect(lockActionLabel({ selected: "full_lock", current: "none" })).toBe("Lock with password");
    expect(lockActionLabel({ selected: "full_lock", current: "full_lock" })).toBe("Update password");
    expect(lockActionLabel({ selected: "none", current: "none", loading: true })).toBe("Apply");
  });
});

describe("canApplyLock", () => {
  it("is off until something would change", () => {
    expect(canApplyLock({ selected: "none", current: "none", password: "" })).toBe(false);
    expect(canApplyLock({ selected: "view_only", current: "view_only", password: "" })).toBe(false);
    expect(canApplyLock({ selected: "none", current: "view_only", password: "" })).toBe(true);
    expect(canApplyLock({ selected: "view_only", current: "none", password: "" })).toBe(true);
  });

  it("needs a password of the minimum length for a password lock, even as a change", () => {
    expect(canApplyLock({ selected: "full_lock", current: "none", password: "abc" })).toBe(false);
    expect(canApplyLock({ selected: "full_lock", current: "none", password: "   abcdefg " })).toBe(false);
    expect(canApplyLock({ selected: "full_lock", current: "none", password: "abcdefgh" })).toBe(true);
    expect(canApplyLock({ selected: "full_lock", current: "full_lock", password: "" })).toBe(false);
    expect(canApplyLock({ selected: "full_lock", current: "full_lock", password: "new-one-long" })).toBe(true);
  });

  it("is off while loading", () => {
    expect(canApplyLock({ selected: "none", current: "full_lock", password: "", loading: true })).toBe(false);
  });
});

describe("password field copy", () => {
  it("asks for a new password only when one already exists", () => {
    expect(passwordFieldLabel("none")).toBe("Password");
    expect(passwordFieldLabel("full_lock")).toBe("New password");
    expect(passwordHint("none")).toBe("At least 8 characters.");
    expect(passwordHint("full_lock")).toBe("At least 8 characters. Replaces the current one.");
  });
});

describe("describeLockStatus", () => {
  it("is empty for an unlocked item and reports provenance when known", () => {
    expect(describeLockStatus({ lock_mode: "none", locked_by_name: "Firat Kaya", lockedWhen: "2d ago" })).toBeNull();
    expect(describeLockStatus({ lock_mode: "full_lock", locked_by_name: "Firat Kaya", lockedWhen: "2d ago" })).toBe("Password lock · set by Firat Kaya, 2d ago");
    expect(describeLockStatus({ lock_mode: "view_only", locked_by_name: "Firat Kaya" })).toBe("View only · set by Firat Kaya");
    expect(describeLockStatus({ lock_mode: "full_lock", lockedWhen: "2d ago" })).toBe("Password lock · set 2d ago");
  });

  it("still names the current mode when the list row is all mobile knows", () => {
    expect(describeLockStatus({ lock_mode: "full_lock" })).toBe("Currently password-locked");
    expect(describeLockStatus({ lock_mode: "view_only" })).toBe("Currently view only");
  });
});

describe("describeLockTarget", () => {
  it("summarises folders by contents and files by type", () => {
    expect(describeLockTarget({ kind: "folder", file_count: 128, size: "1.9 GB" })).toBe("Folder · 128 files · 1.9 GB");
    expect(describeLockTarget({ kind: "folder", file_count: 1 })).toBe("Folder · 1 file");
    expect(describeLockTarget({ kind: "folder" })).toBe("Folder");
    expect(describeLockTarget({ kind: "file", extension: "pdf", size: "2.4 MB" })).toBe("PDF · 2.4 MB");
    expect(describeLockTarget({ kind: "file", extension: null, size: "2.4 MB" })).toBe("File · 2.4 MB");
    expect(describeLockTarget({ kind: "file" })).toBe("File");
  });
});
