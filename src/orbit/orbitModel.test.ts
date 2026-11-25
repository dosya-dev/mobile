import { orbitState, playbackFraction, transferFraction, liveDownloads, liveUploads, vaultSummary } from "./orbitModel";
import { NO_VAULT_ACTIVITY, type VaultActivity } from "@/vault/status";
import type { DownloadEntry } from "@/files/downloadModel";
import type { UploadItem } from "@/upload/types";

function down(over: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    fileId: "d1",
    name: "match.mp4",
    phase: "downloading",
    written: 50,
    total: 200,
    startedAt: 0,
    ...over,
  };
}

function up(over: Partial<UploadItem> = {}): UploadItem {
  return {
    id: "u1",
    name: "photo.jpg",
    uri: "file:///photo.jpg",
    size: 100,
    mime: "image/jpeg",
    folderId: null,
    workspaceId: "w1",
    status: "uploading",
    progress: 0.5,
    ...over,
  };
}

const QUIET = { downloads: [], uploads: [], hasTrack: false, position: 0, duration: 0, vault: NO_VAULT_ACTIVITY, open: false };

function vault(over: Partial<VaultActivity> = {}): VaultActivity {
  return { ...NO_VAULT_ACTIVITY, count: 1, uploads: 1, written: 50, total: 200, ...over };
}

describe("which transfers count as present", () => {
  it("drops finished downloads and keeps every other phase", () => {
    const entries = [down({ phase: "done" }), down({ fileId: "d2", phase: "saving" })];
    expect(liveDownloads(entries).map((e) => e.fileId)).toEqual(["d2"]);
  });

  it("keeps an errored upload, because nothing else reports a broken batch", () => {
    const items = [up({ status: "done" }), up({ id: "u2", status: "error" })];
    expect(liveUploads(items).map((i) => i.id)).toEqual(["u2"]);
  });
});

describe("the outer arc", () => {
  it("is absent when nothing is moving", () => {
    expect(transferFraction([], [])).toBeNull();
  });

  it("weights both directions by bytes, so a big file counts for more", () => {
    // 50/200 down + 50/100 up = 100 of 300.
    expect(transferFraction([down()], [up()])).toBeCloseTo(1 / 3);
  });

  it("draws a zero-length arc rather than none when no size is known yet", () => {
    expect(transferFraction([down({ written: 0, total: 0 })], [])).toBe(0);
  });

  it("caps the numeral at 99, because 100 belongs to a finished transfer", () => {
    const almost = down({ written: 1999, total: 2000 });
    expect(orbitState({ ...QUIET, downloads: [almost] }).transferPct).toBe(99);
  });
});

describe("the inner arc", () => {
  it("is absent with no queue loaded", () => {
    expect(playbackFraction(false, 30, 100)).toBeNull();
  });

  it("is zero, not absent, before the player reports a duration", () => {
    expect(playbackFraction(true, 0, 0)).toBe(0);
  });

  it("is the position over the duration", () => {
    expect(playbackFraction(true, 30, 120)).toBe(0.25);
  });

  it("never runs past a full circle when the position overshoots", () => {
    expect(playbackFraction(true, 130, 120)).toBe(1);
  });
});

describe("what sits in the middle of the disc", () => {
  it("is a plus when the app is idle", () => {
    expect(orbitState(QUIET).core).toBe("add");
  });

  it("is a percentage while a transfer runs alone", () => {
    expect(orbitState({ ...QUIET, downloads: [down()] }).core).toBe("percent");
  });

  it("is the artwork while a track is loaded", () => {
    expect(orbitState({ ...QUIET, hasTrack: true }).core).toBe("artwork");
  });

  it("stays the artwork when a transfer runs too - the arc and the sheet both still report it", () => {
    const s = orbitState({ ...QUIET, hasTrack: true, downloads: [down()] });
    expect(s.core).toBe("artwork");
    expect(s.transfer).toBeCloseTo(0.25);
    expect(s.playback).toBe(0);
  });

  it("is a close glyph while the sheet is open, whatever else is happening", () => {
    expect(orbitState({ ...QUIET, open: true, hasTrack: true, downloads: [down()] }).core).toBe("close");
  });
});

describe("what the button announces", () => {
  it("offers upload when idle", () => {
    expect(orbitState(QUIET).label).toBe("Upload");
  });

  it("counts transfers, singular and plural", () => {
    expect(orbitState({ ...QUIET, downloads: [down()] }).label).toBe("1 transfer");
    expect(orbitState({ ...QUIET, downloads: [down(), down({ fileId: "d2" })] }).label).toBe("2 transfers");
  });

  it("says how many broke", () => {
    const s = orbitState({ ...QUIET, uploads: [up(), up({ id: "u2", status: "error" })] });
    expect(s.failedCount).toBe(1);
    expect(s.label).toBe("2 transfers, 1 failed");
  });

  it("leads with the track, then the transfers", () => {
    expect(orbitState({ ...QUIET, hasTrack: true, downloads: [down()] }).label).toBe("Now playing, 1 transfer");
  });
});

describe("the Vault in the orbit", () => {
  it("weighs its bytes in the arc like any other transfer", () => {
    // 50/200 down + 50/100 up + 25/100 vault = 125 of 400.
    expect(transferFraction([down()], [up()], vault({ written: 25, total: 100 }))).toBeCloseTo(125 / 400);
  });

  it("draws an arc when the Vault alone is working", () => {
    const s = orbitState({ ...QUIET, vault: vault() });
    expect(s.core).toBe("percent");
    expect(s.transferPct).toBe(25);
  });

  it("counts its files in the label alongside everything else", () => {
    expect(orbitState({ ...QUIET, downloads: [down()], vault: vault({ count: 2, uploads: 2 }) }).label).toBe("3 transfers");
  });

  it("counts its failures in the label", () => {
    expect(orbitState({ ...QUIET, vault: vault({ count: 2, uploads: 2, failed: 1 }) }).label).toBe("2 transfers, 1 failed");
  });

  it("says nothing at all when the Vault is quiet, so the row never announces a Vault exists", () => {
    expect(vaultSummary(NO_VAULT_ACTIVITY)).toBeNull();
  });

  it("names the encryption, because it is the slow half nobody expects", () => {
    expect(vaultSummary(vault())).toEqual({
      title: "1 file in your Vault",
      caption: "Encrypting and uploading · 25%",
    });
  });

  it("says decrypting on the way down", () => {
    expect(vaultSummary(vault({ uploads: 0, downloads: 1 }))?.caption).toBe("Downloading and decrypting · 25%");
  });

  it("claims neither direction for a mixed batch", () => {
    expect(vaultSummary(vault({ count: 2, uploads: 1, downloads: 1 }))?.caption).toBe("Transferring · 25%");
  });

  it("counts files rather than naming one", () => {
    expect(vaultSummary(vault({ count: 3, uploads: 3 }))?.title).toBe("3 files in your Vault");
  });

  it("reports a breakage in place of the percentage, with the direction it broke in", () => {
    expect(vaultSummary(vault({ count: 2, uploads: 2, failed: 1 }))?.caption).toBe("1 file couldn't upload");
    expect(vaultSummary(vault({ count: 2, uploads: 0, downloads: 2, failed: 2 }))?.caption).toBe("2 files couldn't download");
  });

  it("reports zero rather than no percentage before a size is known", () => {
    expect(vaultSummary(vault({ written: 0, total: 0 }))?.caption).toBe("Encrypting and uploading · 0%");
  });
});
