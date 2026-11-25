/**
 * Task 7: text from shared and vendored code (validation policy messages, the
 * Vault client's transport error, backup hold reason codes) in the chosen
 * language. translateExternal is strict: only an exact catalog message.
 */
jest.mock("@/auth/authStore", () => ({
  getAccessToken: jest.fn(() => "dosm_token1"),
  refreshSession: jest.fn(async () => "unavailable"),
}));
jest.mock("@/lib/deviceId", () => ({ DEVICE_ID_HEADER: "X-Dosya-Device", currentDeviceId: () => "dev-1" }));
jest.mock("@/api/client", () => ({ apiRequest: jest.fn(async () => ({})) }));

import { Text } from "react-native";
import { translateExternal } from "../../lib/external-text";
import { loadMessages, t, __resetI18nForTests } from "../../lib/i18n";
import { renderInLocale } from "../../../test-utils/i18n-sweep";
import { summariseRejections } from "../../upload/limits";
import { createFolder, renameFile } from "../../files/mutations";
import { editComment } from "../../comments/api";
import { authedFetch, __setVaultFetchForTests } from "../../vault/client";
import { engineLabel } from "../../backup/ui/engineStatus";
import { validatePassword } from "../../lib/validationPolicy.generated";

async function inLanguage(locale: "tr" | "de"): Promise<void> {
  __resetI18nForTests();
  await loadMessages(locale);
  await renderInLocale(<Text>x</Text>, locale);
}

beforeEach(() => { __resetI18nForTests(); });

describe("translateExternal", () => {
  it("translates a policy message with its argument untouched", async () => {
    await inLanguage("tr");
    const out = translateExternal('Folder name "a/b" contains invalid characters');
    expect(out).toContain("a/b");
    expect(out).not.toMatch(/contains invalid characters/);
    expect(translateExternal(validatePassword("x")!)).not.toMatch(/Password must/);
  });

  it("leaves text with extra words, and unknown text, unchanged", async () => {
    await inLanguage("tr");
    expect(translateExternal('Folder name "a/b" contains invalid characters, sorry')).toBe('Folder name "a/b" contains invalid characters, sorry');
    expect(translateExternal("Vault is locked")).toBe("Vault is locked");
    expect(translateExternal("")).toBe("");
  });

  it("English stays English", () => {
    expect(translateExternal("Name is required")).toBe("Name is required");
  });
});

describe("call sites", () => {
  it("name rules, comment rules and batch summaries follow the language", async () => {
    await inLanguage("tr");
    expect(() => renameFile("f1", "")).toThrow(t("common.error.nameIsRequired"));
    expect(t("common.error.nameIsRequired")).not.toBe("Name is required");
    expect(() => createFolder("w", null, "")).toThrow(t("common.error.folderNameIsRequired"));
    await expect(editComment("c1", "   ")).rejects.toMatchObject({ message: t("common.error.commentBodyIsRequired") });
    const one = summariseRejections([{ name: "a.exe", reason: "File type .exe is not allowed in this workspace" }]);
    expect(one).toBe(t("backup.error.nameReason", { name: "a.exe", reason: t("common.error.fileTypeExtensionIsNotAllowedInThisWorkspace", { extension: ".exe" }) }));
    const many = summariseRejections([
      { name: "a.exe", reason: "File type .exe is not allowed in this workspace" },
      { name: "b.exe", reason: "File type .exe is not allowed in this workspace" },
    ]);
    expect(many).toBe(t("common.error.reasonCountFiles", { reason: t("common.error.fileTypeExtensionIsNotAllowedInThisWorkspace", { extension: ".exe" }), count: "2" }));
  });

  it("the Vault client's transport error is in the chosen language", async () => {
    await inLanguage("de");
    __setVaultFetchForTests(async () => { throw new TypeError("Network request failed"); });
    await expect(authedFetch("https://api.test/x")).rejects.toMatchObject({ message: t("common.error.networkRequestFailed") });
    expect(t("common.error.networkRequestFailed")).not.toBe("Network request failed");
    __setVaultFetchForTests(null);
  });

  it("an unknown native hold code shows the generic catalog label, never the raw code", async () => {
    await inLanguage("tr");
    expect(engineLabel("holding", "offline")).toBe(t("backup.status.pausedOffline"));
    expect(engineLabel("holding", "NSURLErrorDomain -1009")).toBe(t("common.status.paused"));
  });
});
