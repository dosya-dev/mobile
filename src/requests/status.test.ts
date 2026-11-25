import {
  requestStatus, statusLabel, describeLimits, validatePassword, parseEmails,
  recipientState, destinationLabel, MIN_REQUEST_PASSWORD,
  type RequestRow, type RecipientRow,
} from "./status";

const NOW = 1_800_000_000;

function r(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: "fr_1", token: "tok", title: "Brand assets", message: null,
    is_password_protected: 0, expires_at: null, allowed_extensions: null,
    max_file_size_bytes: null, max_files: null, upload_count: 0, is_revoked: 0,
    created_at: NOW - 1000, folder_id: null, created_by_name: "Ada",
    folder_name: null, url: "https://dosya.dev/upload-request/tok",
    ...over,
  };
}

function rec(over: Partial<RecipientRow> = {}): RecipientRow {
  return { id: "rcp_1", email: "a@b.c", token: "t", sent_at: null, uploaded_at: null, created_at: NOW, ...over };
}

describe("requestStatus", () => {
  it("is active by default", () => {
    expect(requestStatus(r(), NOW)).toBe("active");
  });

  it("reports a revoked request as closed", () => {
    expect(requestStatus(r({ is_revoked: 1 }), NOW)).toBe("closed");
  });

  it("prefers closed over expired when a request is both", () => {
    // Closing it was the deliberate act; the expiry it also drifted past is
    // incidental and would be the less useful thing to show.
    expect(requestStatus(r({ is_revoked: 1, expires_at: NOW - 10 }), NOW)).toBe("closed");
  });

  it("reports an elapsed expiry", () => {
    expect(requestStatus(r({ expires_at: NOW - 1 }), NOW)).toBe("expired");
  });

  it("treats an expiry still in the future as active", () => {
    expect(requestStatus(r({ expires_at: NOW + 1 }), NOW)).toBe("active");
  });

  it("reports full at exactly max_files", () => {
    // The request refuses the next upload here. Showing "Active" would be a lie
    // the uploader discovers and the owner does not.
    expect(requestStatus(r({ max_files: 3, upload_count: 3 }), NOW)).toBe("full");
    expect(requestStatus(r({ max_files: 3, upload_count: 2 }), NOW)).toBe("active");
  });

  it("never reports full when there is no limit", () => {
    expect(requestStatus(r({ max_files: null, upload_count: 900 }), NOW)).toBe("active");
  });

  it("prefers expired over full", () => {
    expect(requestStatus(r({ expires_at: NOW - 1, max_files: 1, upload_count: 1 }), NOW)).toBe("expired");
  });
});

describe("statusLabel", () => {
  it("names each state in a word", () => {
    expect(statusLabel("closed")).toBe("Closed");
    expect(statusLabel("expired")).toBe("Expired");
    expect(statusLabel("full")).toBe("Full");
    expect(statusLabel("active")).toBe("Active");
  });
});

describe("describeLimits", () => {
  it("is null when nothing is limited", () => {
    expect(describeLimits(r())).toBeNull();
  });

  it("describes a size cap on its own", () => {
    expect(describeLimits(r({ max_file_size_bytes: 10 * 1024 * 1024 }))).toBe("Max 10 MB per file");
  });

  it("describes a count cap on its own", () => {
    expect(describeLimits(r({ max_files: 1 }))).toBe("1 file");
    expect(describeLimits(r({ max_files: 5 }))).toBe("5 files");
  });

  it("describes an extension allowlist on its own", () => {
    expect(describeLimits(r({ allowed_extensions: "jpg,png" }))).toBe("jpg, png only");
  });

  it("joins every limit it has", () => {
    const out = describeLimits(r({
      max_file_size_bytes: 5 * 1024 * 1024, max_files: 2, allowed_extensions: "pdf",
    }));
    expect(out).toBe("Max 5 MB per file · 2 files · pdf only");
  });
});

describe("validatePassword", () => {
  it("accepts an empty string - the password is optional", () => {
    expect(validatePassword("")).toBeNull();
  });

  it("refuses one character short of the floor", () => {
    expect(validatePassword("x".repeat(MIN_REQUEST_PASSWORD - 1))).toContain("8");
  });

  it("accepts the floor itself", () => {
    expect(validatePassword("x".repeat(MIN_REQUEST_PASSWORD))).toBeNull();
  });
});

describe("parseEmails", () => {
  it("splits a pasted list on commas, spaces and newlines", () => {
    expect(parseEmails("a@b.c, d@e.f\ng@h.i j@k.l")).toEqual(["a@b.c", "d@e.f", "g@h.i", "j@k.l"]);
  });

  it("lowercases and drops duplicates", () => {
    expect(parseEmails("A@B.c, a@b.c")).toEqual(["a@b.c"]);
  });

  it("keeps the valid addresses and drops the rubbish", () => {
    expect(parseEmails("good@example.com, not-an-email")).toEqual(["good@example.com"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseEmails("   ")).toEqual([]);
  });
});

describe("recipientState", () => {
  it("reports an upload even when no invite was recorded", () => {
    expect(recipientState(rec({ uploaded_at: NOW }))).toBe("uploaded");
  });

  it("reports invited once the mail went out", () => {
    expect(recipientState(rec({ sent_at: NOW }))).toBe("invited");
  });

  it("reports pending when neither happened", () => {
    expect(recipientState(rec())).toBe("pending");
  });
});

describe("destinationLabel", () => {
  it("names the workspace root when there is no folder", () => {
    expect(destinationLabel(r({ folder_id: null }))).toBe("Workspace root");
  });

  it("names the folder when it has one", () => {
    expect(destinationLabel(r({ folder_id: "fld_1", folder_name: "Inbox" }))).toBe("Inbox");
  });

  it("says the folder is unknown when the join found no name", () => {
    // The listing LEFT JOINs folders with is_deleted = 0, so a deleted
    // destination comes back as an id with a null name.
    expect(destinationLabel(r({ folder_id: "fld_gone", folder_name: null }))).toBe("Unknown folder");
  });
});
