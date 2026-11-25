/**
 * Task 9 (cleanup): the keys Task 8 added are wired, the sibling keys replace
 * the old ones, the workarounds whose catalog fix landed are gone, and the
 * stores and helpers that held a sentence now hold a key. English stays as it
 * was except the listed defect fixes.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Platform, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { makeT } from "@/i18n/translator";
import en from "@/i18n/messages/en.json";
import type { MessageKey } from "@/i18n/keys";
import { LOCALES } from "@/i18n/locales";
import { EXTERNAL_KEYS } from "@/i18n/external-keys";
import { pluralCategories, pluralCategory } from "@/i18n/plural-fallback";
import { __resetI18nForTests, loadMessages, t as moduleT } from "@/lib/i18n";
import { renderInLocale, collectTexts } from "../../../test-utils/i18n-sweep";

import LoginScreen from "../../../app/(auth)/login";
import SignUpScreen from "../../../app/(auth)/signup";
import TermsScreen from "../../../app/terms";
import PrivacyScreen from "../../../app/privacy";
import ShareView from "../../../app/s/[token]";
import MySharesScreen from "../../../app/shares/index";
import { VideoStage } from "@/viewer/stages/VideoStage";
import { ViewerMoreSheet } from "@/viewer/ViewerMoreSheet";
import { BackupArt } from "@/onboarding/ui/DeckArt";
import AppearanceScreen from "../../../app/appearance";
import { Segmented } from "@/share/controls";
import { ListPager, type Pager } from "@/ui/ListPager";
import { CreateShareSheet } from "@/share/CreateShareSheet";
import { containerName } from "@/viewer/videoSupport";
import * as shareHooks from "@/share/hooks";
import * as shareApi from "@/share/api";
import * as filesHooks from "@/files/hooks";
import { useUploadBlock, blockReasonText, hydrateUploadBlock, __resetUploadBlockHydration } from "@/upload/uploadBlock";
import { errorFields, itemErrorText } from "@/upload/uploadError";
import { summariseRejections } from "@/upload/limits";
import { translateExternal } from "@/lib/external-text";
import { collectMobileDiagnostics, diagnosticsRows } from "@/support/diagnostics";
import { syncPushRegistration } from "@/notifications/push";
import { editorHtml } from "@/editor/api";

// ---- mocks ----
// Email sign-up is open in these sweeps; the screen asks the API before it
// shows the form (admin dashboard switch, 6baf1e6aa1).
jest.mock("@/auth/api", () => ({
  ...jest.requireActual("@/auth/api"),
  fetchEmailSignupOpen: () => Promise.resolve(true),
}));
jest.mock("expo-router", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../../../test-utils/i18n-sweep").routerMockWithTitles();
});
jest.mock("@/auth/lastMethod", () => ({ getLastMethod: jest.fn().mockResolvedValue(null) }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("react-native-qrcode-svg", () => () => null);
jest.mock("@/files/download", () => ({ downloadToCache: jest.fn(async () => "file:///tmp/x"), shareFile: jest.fn(async () => {}) }));
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { activeId: string | null }) => unknown) => selector({ activeId: "w1" }),
}));
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn(() => ({ duration: 0, addListener: () => ({ remove: () => {} }) })),
  VideoView: "VideoView",
}));
jest.mock("@/viewer/vlcPlayer", () => ({ isVlcAvailable: () => false }));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "t" })),
}));
let mockIsDevice = true;
jest.mock("expo-device", () => ({
  get isDevice() { return mockIsDevice; },
  deviceName: "x",
  DeviceType: { TABLET: 2 },
  deviceType: 1,
}));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock("@/notifications/api", () => ({ registerPushDevice: jest.fn(async () => {}), unregisterPushDevice: jest.fn(async () => {}) }));
const mockMem = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (mockMem.has(k) ? mockMem.get(k)! : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockMem.set(k, v); }),
  deleteItemAsync: jest.fn(async (k: string) => { mockMem.delete(k); }),
}));

const english = makeT("en", en as never, en as never);
async function inLocale(locale: "tr" | "de" | "pl") {
  return makeT(locale, await loadMessages(locale), en as never);
}
const wrap = (ui: ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false }, mutations: { gcTime: 0 } } })}>
    {ui}
  </QueryClientProvider>
);

const NOW = Math.floor(Date.now() / 1000);

beforeEach(() => {
  jest.restoreAllMocks();
  __resetI18nForTests();
  mockMem.clear();
  mockIsDevice = true;
  useUploadBlock.setState({ reason: null, message: null });
  __resetUploadBlockHydration();
});

// ---------------------------------------------------------------------------
describe("plural rules for the languages that ship once complete", () => {
  const NS: number[] = [];
  for (let n = 0; n <= 1200; n++) NS.push(n);
  NS.push(1e4, 1e5, 1e6, 2e6, 0.5, 1.5, 2.5, 1.25, 0.01, 0.1, 1.001, 1.01, 2.02, 10.5, 11.5, 21.1, 100.1, 0.2, 3.2);

  it.each(["lv", "lt", "ja", "ko"])("%s matches Node ICU for every sample number", (lang) => {
    const oracle = new Intl.PluralRules(lang);
    const bad: string[] = [];
    for (const n of NS) {
      const got = pluralCategory(lang, n);
      if (got !== oracle.select(n)) bad.push(`${lang} ${n}: got ${got}, want ${oracle.select(n)}`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it.each(["lv", "lt", "ja", "ko"])("%s lists the categories Node ICU lists", (lang) => {
    const want = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    expect([...pluralCategories(lang)].sort()).toEqual([...want].sort());
  });

  it("every shipped language has a rule of its own", () => {
    for (const lang of LOCALES) {
      if (lang === "en") continue;
      const oracle = new Intl.PluralRules(lang);
      // A language without a rule would answer "other" for every number.
      const answers = new Set(NS.map((n) => pluralCategory(lang, n)));
      const wantMany = new Set(NS.map((n) => oracle.select(n)));
      expect([...answers].sort()).toEqual([...wantMany].sort());
    }
  });
});

// ---------------------------------------------------------------------------
describe("consent sentences carry link slots", () => {
  it("English stays byte-identical on login and signup", async () => {
    await renderInLocale(<LoginScreen />, "en");
    expect(screen.getByText("By continuing, you agree to our Terms of Service and Privacy Policy.")).toBeTruthy();
    __resetI18nForTests();
    await renderInLocale(<SignUpScreen />, "en");
    await screen.findByTestId("create");
    expect(screen.getByText("I agree to the Terms of Service and acknowledge the Privacy Policy")).toBeTruthy();
    expect(screen.getAllByText("By continuing, you agree to our Terms of Service and Privacy Policy.").length).toBe(1);
  });

  it.each(["tr", "de", "pl"] as const)("%s: both links sit inside the translated sentence, no fallback line", async (locale) => {
    const tr = await inLocale(locale);
    await renderInLocale(<LoginScreen />, locale);
    const links = { link1: tr("legal.heading.termsOfService"), link2: tr("legal.heading.privacyPolicy") };
    expect(screen.getByText(tr("common.description.byContinuingYouAgreeToOurLink1AndLink2", links))).toBeTruthy();
    expect(screen.getByTestId("terms-link").props.children).toBe(links.link1);
    expect(screen.getByTestId("privacy-link").props.children).toBe(links.link2);
    expect(collectTexts().join("|")).not.toMatch(/\{link/);
    const { router } = jest.requireMock("expo-router") as { router: { push: jest.Mock } };
    fireEvent.press(screen.getByTestId("terms-link"));
    expect(router.push).toHaveBeenCalledWith("/terms");
  });

  it("signup: the checkbox sentence and the OAuth line follow the language", async () => {
    const tr = await inLocale("tr");
    await renderInLocale(<SignUpScreen />, "tr");
    await screen.findByTestId("create");
    const links = { link1: tr("legal.heading.termsOfService"), link2: tr("legal.heading.privacyPolicy") };
    expect(screen.getByText(tr("sign-up.label.iAgreeToTheLink1AndAcknowledgeTheLink2", links))).toBeTruthy();
    expect(screen.getByText(tr("common.description.byContinuingYouAgreeToOurLink1AndLink2", links))).toBeTruthy();
    for (const id of ["terms-link", "privacy-link", "oauth-terms-link", "oauth-privacy-link"]) expect(screen.getByTestId(id)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("Terms and Privacy say which version applies", () => {
  it("is absent in English and shown in the chosen language otherwise", async () => {
    await renderInLocale(<TermsScreen />, "en");
    expect(screen.queryByTestId("legal-english-note")).toBeNull();
    __resetI18nForTests();
    const tr = await inLocale("tr");
    await renderInLocale(<TermsScreen />, "tr");
    expect(screen.getByTestId("legal-english-note").props.children).toBe(tr("legal.description.englishVersionApplies"));
    expect(tr("legal.description.englishVersionApplies")).not.toBe(english("legal.description.englishVersionApplies"));
    __resetI18nForTests();
    await renderInLocale(<PrivacyScreen />, "tr");
    expect(screen.getByTestId("legal-english-note")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("video that cannot play", () => {
  const stage = (mimeType: string, extension: string | null) =>
    <VideoStage uri="https://r/x" mimeType={mimeType} extension={extension} onSave={jest.fn()} onRetry={jest.fn()} />;
  afterEach(() => { (Platform as unknown as { OS: string }).OS = "ios"; });

  it("English: iPhone on iOS, phone elsewhere, 'this video' when the format has no name", async () => {
    (Platform as unknown as { OS: string }).OS = "ios";
    await renderInLocale(stage("video/x-matroska", ".mkv"), "en");
    expect(screen.getByText("This iPhone can't play Matroska video")).toBeTruthy();
    // A format with no name falls back to the "this video" sentence (the card
    // only shows for the formats named in videoSupport, so check the message).
    expect(english("common.heading.thisPhoneCanTPlayThisVideo", { platform: "ios" })).toBe("This iPhone can't play this video");
    expect(english("common.heading.thisPhoneCanTPlayThisVideo", { platform: "other" })).toBe("This phone can't play this video");
  });

  it("Android and Turkish: the word for phone is the language's own", async () => {
    (Platform as unknown as { OS: string }).OS = "android";
    const tr = await inLocale("tr");
    // Android never reaches the unplayable card for a stock format; use the VLC-less path by forcing iOS-only formats off.
    expect(tr("common.heading.thisPhoneCanTPlayFormatVideo", { platform: "other", format: "Matroska" })).toContain("telefon");
    expect(tr("common.heading.thisPhoneCanTPlayFormatVideo", { platform: "ios", format: "Matroska" })).toContain("iPhone");
    expect(containerName("video/x-matroska", ".mkv")).toBe("Matroska");
    expect(containerName("video/unknown", null)).toBeNull();
  });

  it("Turkish on iOS", async () => {
    (Platform as unknown as { OS: string }).OS = "ios";
    const tr = await inLocale("tr");
    await renderInLocale(stage("video/x-matroska", ".mkv"), "tr");
    expect(screen.getByText(tr("common.heading.thisPhoneCanTPlayFormatVideo", { platform: "ios", format: "Matroska" }))).toBeTruthy();
    expect(tr("common.heading.thisPhoneCanTPlayThisVideo", { platform: "ios" })).toContain("iPhone");
  });
});

// ---------------------------------------------------------------------------
describe("public share page", () => {
  const file = { id: "f1", name: "shared.pdf", size_bytes: 2048, mime_type: "application/pdf", extension: "pdf" };
  const payload = (over = {}) => ({
    isFolder: false, isBundle: false, lockMode: "view_only", requiresPassword: false, requiresRecipientVerification: false,
    files: [file], file, folder: null, viewCount: 3, downloadCount: 0, expiresAt: NOW + 6 * 86400, ...over,
  }) as shareApi.SharePayload;

  it("the view-only note: bold lead-in inside one translated sentence, English unchanged", async () => {
    jest.spyOn(shareApi, "openShare").mockResolvedValue(payload());
    // SharePreview is irrelevant here.
    await renderInLocale(<ShareView />, "en");
    await waitFor(() => expect(screen.getByTestId("copy-share-link")).toBeTruthy());
    expect(screen.getByText("View only. The sender turned off downloads for this link.")).toBeTruthy();
    expect(screen.getByText("View only.")).toBeTruthy();
    __resetI18nForTests();
    const tr = await inLocale("tr");
    await renderInLocale(<ShareView />, "tr");
    await waitFor(() => expect(screen.getByTestId("copy-share-link")).toBeTruthy());
    const lead = tr("shared-link.label.viewOnlyLead");
    expect(screen.getByText(tr("shared-link.description.viewOnlyLeadTheSenderTurnedOffDownloadsForThisLink", { viewOnlyLead: lead }))).toBeTruthy();
    expect(screen.getByText(lead)).toBeTruthy();
  });

  it("the preview card for a file of unknown size says only what to do", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SharePreview } = jest.requireActual("@/share/SharePreview") as typeof import("@/share/SharePreview");
    const book = { id: "f2", name: "b.epub", size_bytes: null, mime_type: "application/epub+zip", extension: "epub" } as never;
    await renderInLocale(<SharePreview file={book} uri="u" scheme="dark" viewOnly={false} />, "en");
    expect(screen.getByText("Download it to open this one")).toBeTruthy();
    __resetI18nForTests();
    const tr = await inLocale("tr");
    await renderInLocale(<SharePreview file={book} uri="u" scheme="dark" viewOnly={false} />, "tr");
    expect(screen.getByText(tr("shared-link.label.downloadItToOpenThisOne"))).toBeTruthy();
    const sized = { ...(book as object), size_bytes: 2048 } as never;
    __resetI18nForTests();
    await renderInLocale(<SharePreview file={sized} uri="u" scheme="dark" viewOnly={false} />, "en");
    expect(screen.getByText("2.0 KB · Download it to open this one")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("sharing screens", () => {
  const idle = { mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false };
  beforeEach(() => {
    jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
      createLink: idle, email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
    } as never);
    jest.spyOn(shareHooks, "useIsFreePlan").mockReturnValue(false);
    jest.spyOn(shareHooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
    jest.spyOn(shareHooks, "useWorkspaceShareDefault").mockReturnValue({ data: 14 } as never);
    jest.spyOn(filesHooks, "useWorkspaces").mockReturnValue({ data: [{ id: "w1" }] } as never);
  });

  it("the create sheet's email button reads 'Send to people' before anyone is added", async () => {
    const target = { kind: "file", id: "f1", name: "beach.jpg", sizeBytes: 2048, extension: "jpg" } as const;
    await renderInLocale(<CreateShareSheet visible target={target} onClose={jest.fn()} />, "en");
    fireEvent.press(screen.getByTestId("tab-email"));
    expect(screen.getByTestId("send-email")).toBeTruthy();
    expect(collectTexts()).toContain("Send to people");
    __resetI18nForTests();
    const tr = await inLocale("tr");
    await renderInLocale(<CreateShareSheet visible target={target} onClose={jest.fn()} />, "tr");
    fireEvent.press(screen.getByTestId("tab-email"));
    expect(collectTexts()).toContain(tr("sharing.action.sendToPeople"));
  });

  it("the Shared with me tab shows the count from the catalog message", async () => {
    const row = {
      link_id: "wm1", url: "https://dosya.dev/s/w", display_name: "brief.pdf", is_folder: false, is_bundle: false, size_bytes: 2048,
      extension: "pdf", is_password_protected: 0, lock_mode: "none", expires_at: null, revoked_at: null, status: "active",
      shared_at: NOW, invited_at: NOW, verified_at: null, sender_name: "Dana",
    };
    jest.spyOn(shareHooks, "useMyShares").mockReturnValue({
      data: { links: [], stats: { total: 0, active: 0, expiring: 0, total_views: 0 } }, isLoading: false, isRefetching: false, refetch: jest.fn(),
    } as never);
    jest.spyOn(shareHooks, "useSharedWithMe").mockReturnValue({
      data: { links: [row, { ...row, link_id: "wm2" }, { ...row, link_id: "wm3" }], emailVerified: true, stats: { total: 3, active: 0, unopened: 0 } },
      isLoading: false, isRefetching: false, refetch: jest.fn(),
    } as never);
    await renderInLocale(wrap(<MySharesScreen />), "en");
    expect(collectTexts()).toContain("Shared with me · 3");
    __resetI18nForTests();
    const tr = await inLocale("tr");
    await renderInLocale(wrap(<MySharesScreen />), "tr");
    expect(collectTexts()).toContain(tr("shared-links.label.sharedWithMeHasCountSelectTrueCountOther", { hasCount: "true", count: "3" }));
  });

  it("groups: the catalog line is the English the screen showed", async () => {
    expect(english("groups.description.foldersPluralOneFolderOtherFoldersFilesPluralOneFileOtherFileS", { folders: 2, files: 3 })).toBe("2 folders · 3 files");
    expect(english("groups.description.foldersPluralOneFolderOtherFoldersFilesPluralOneFileOtherFileS", { folders: 1, files: 1 })).toBe("1 folder · 1 file");
    const it = makeT("it", await loadMessages("it"), en as never);
    expect(it("groups.description.foldersPluralOneFolderOtherFoldersFilesPluralOneFileOtherFileS", { folders: 3, files: 3 })).toBe("3 cartelle · 3 file");
  });
});

// ---------------------------------------------------------------------------
describe("pager labels", () => {
  const pager: Pager = { page: 0, pageCount: 2, from: 0, to: 6, paged: true, label: "1-6 of 8", prev: jest.fn(), next: jest.fn() };

  it("a backup history pager has its own catalog kind", async () => {
    await renderInLocale(<ListPager pager={pager} testID="p" what="backups" />, "en");
    expect(screen.getByTestId("p-prev").props.accessibilityLabel).toBe("Previous backups page");
    expect(screen.getByTestId("p-next").props.accessibilityLabel).toBe("Next backups page");
    __resetI18nForTests();
    const tr = await inLocale("tr");
    await renderInLocale(<ListPager pager={pager} testID="p" what="backups" />, "tr");
    expect(screen.getByTestId("p-prev").props.accessibilityLabel).toBe(tr("backup.label.previousKindSelectFailedFailedItemsSkippedSkippedItemsOtherItemsPage", { kind: "backups" }));
    expect(screen.getByTestId("p-prev").props.accessibilityLabel).not.toMatch(/backups/);
  });

  it("the other three kinds are unchanged", async () => {
    for (const [what, text] of [["failed items", "failed items"], ["skipped items", "skipped items"], ["items", "items"]] as const) {
      __resetI18nForTests();
      await renderInLocale(<ListPager pager={pager} testID="p" what={what} />, "en");
      expect(screen.getByTestId("p-next").props.accessibilityLabel).toBe(`Next ${text} page`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("viewer more sheet", () => {
  const file = {
    id: "f1", name: "a.jpg", size_bytes: 10, mime_type: "image/jpeg", extension: ".jpg",
    created_at: 1, updated_at: 1, current_version: 1, lock_mode: "none", share_count: 0, comment_count: 0,
  } as never;

  it("row ids do not follow the language", async () => {
    const actions = [
      { id: "rename", label: "Yeniden adlandır", icon: "create-outline" as const, onPress: jest.fn() },
      { id: "move-to-trash", label: "Çöp kutusuna taşı", icon: "trash-outline" as const, destructive: true, onPress: jest.fn() },
    ];
    await renderInLocale(<ViewerMoreSheet visible file={file} actions={actions} onClose={jest.fn()} />, "tr");
    expect(screen.getByTestId("more-rename")).toBeTruthy();
    expect(screen.getByTestId("more-move-to-trash")).toBeTruthy();
    expect(screen.queryByTestId("more-")).toBeNull();
  });

  it("a row without an id keeps the label-derived id", async () => {
    await renderInLocale(<ViewerMoreSheet visible file={file} actions={[{ label: "Rename", icon: "create-outline", onPress: jest.fn() }]} onClose={jest.fn()} />, "en");
    expect(screen.getByTestId("more-rename")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("external text: policy and e2ee messages", () => {
  it("EXTERNAL_KEYS has the 17 policy keys and all 45 vault e2ee keys", () => {
    const e2ee = (EXTERNAL_KEYS as readonly string[]).filter((k) => k.startsWith("vault.error.e2ee"));
    expect(e2ee.length).toBe(45);
    expect(Object.keys(en).filter((k) => k.startsWith("vault.error.e2ee")).sort()).toEqual([...e2ee].sort());
    for (const k of [
      "common.error.expiryMustBeInTheFuture", "common.error.invalidExpiry", "common.error.fileTypeExtnoextensionIsNotInTheAllowedListForThis",
      "common.error.invalidCategory", "common.error.invalidLockMode", "common.error.invalidScope", "common.error.invalidSurfacesInvalidjoin",
      "common.error.maximumMaxFilesFilesPerShareLink", "common.error.messageIsRequired", "common.error.messageTooLongMax10000Characters",
      "common.error.nameIsTooLongMaxMaxChars", "common.error.nameMustBeLimitsapiKeyNameMaxCharactersOrLess", "common.error.selectAtLeastOneFile",
      "common.error.subjectIsRequired", "common.error.subjectTooLongMax200Characters", "common.error.surfacesMustBeAnArrayOfStrings",
      "common.error.topreasonTopcountFilesAndOthersPluralOneOtherReasonOther",
    ]) expect(EXTERNAL_KEYS).toContain(k);
  });

  it("a vault client error and a policy message come out in the chosen language", async () => {
    const tr = await inLocale("tr");
    await renderInLocale(<Text>x</Text>, "tr");
    const vaultKey: MessageKey = "vault.error.e2eeCannotRemoveTheLastMemberOfAWorkspace";
    const out = translateExternal(english(vaultKey));
    expect(out).toBe(tr(vaultKey));
    expect(out).not.toBe(english(vaultKey));
    expect(translateExternal("Message is required")).toBe(tr("common.error.messageIsRequired"));
    expect(translateExternal("Select at least one file")).toBe(tr("common.error.selectAtLeastOneFile"));
  });

  it("every e2ee message translates back to itself in English", () => {
    for (const k of EXTERNAL_KEYS.filter((x) => x.startsWith("vault.error.e2ee"))) {
      const text = (en as Record<string, string>)[k]!;
      if (!/[{}]/.test(text)) expect(translateExternal(text)).toBe(text);
    }
  });

  it("several rejection reasons are composed from the catalog tail", async () => {
    const tr = await inLocale("tr");
    await renderInLocale(<Text>x</Text>, "tr");
    const out = summariseRejections([
      { name: "a.exe", reason: "File type .exe is not allowed in this workspace" },
      { name: "b.exe", reason: "File type .exe is not allowed in this workspace" },
      { name: "c", reason: "Name is required" },
    ]);
    expect(out).toBe(tr("common.error.topreasonTopcountFilesAndOthersPluralOneOtherReasonOther", {
      topReason: tr("common.error.fileTypeExtensionIsNotAllowedInThisWorkspace", { extension: ".exe" }),
      topCount: "2",
      others: 1,
    }));
    __resetI18nForTests();
    expect(summariseRejections([
      { name: "a.exe", reason: "File type .exe is not allowed in this workspace" },
      { name: "c", reason: "Name is required" },
    ])).toBe("File type .exe is not allowed in this workspace (1 files), and 1 other reason");
  });
});

// ---------------------------------------------------------------------------
describe("the upload block holds a key, not a sentence", () => {
  const KEY: MessageKey = "backup.error.notEnoughFreeSpaceOnThisDeviceToStageTheNextPhotos";

  it("the reason reads in the language of the moment it is shown, not the moment it was set", async () => {
    useUploadBlock.getState().setReasonMessage(KEY);
    const s = useUploadBlock.getState();
    expect(s.reason).toBe(english(KEY));
    expect(s.message).toMatchObject({ key: KEY });
    const tr = await inLocale("tr");
    expect(blockReasonText(s, tr)).toBe(tr(KEY));
    expect(blockReasonText(s, tr)).not.toBe(english(KEY));
    const de = await inLocale("de");
    expect(blockReasonText(useUploadBlock.getState(), de)).toBe(de(KEY));
  });

  it("server text stays text; a reason replaced on its own does not show the old message", async () => {
    useUploadBlock.getState().setReason("Storage limit reached.");
    const tr = await inLocale("tr");
    expect(blockReasonText(useUploadBlock.getState(), tr)).toBe("Storage limit reached.");
    useUploadBlock.getState().setReasonMessage(KEY);
    useUploadBlock.setState({ reason: "Storage is full." });
    expect(blockReasonText(useUploadBlock.getState(), tr)).toBe("Storage is full.");
    useUploadBlock.getState().setReason(null);
    expect(useUploadBlock.getState().message).toBeNull();
    expect(blockReasonText(useUploadBlock.getState(), tr)).toBeNull();
  });

  it("survives a restart as a key and is shown in the language chosen then", async () => {
    useUploadBlock.getState().setReasonMessage(KEY);
    await new Promise((r) => setTimeout(r, 0));
    useUploadBlock.setState({ reason: null, message: null });
    __resetUploadBlockHydration();
    await hydrateUploadBlock();
    const s = useUploadBlock.getState();
    expect(s.message?.key).toBe(KEY);
    const tr = await inLocale("tr");
    expect(blockReasonText(s, tr)).toBe(tr(KEY));
  });

  it("an older build's plain stored sentence still restores", async () => {
    mockMem.set("dosya.upload.block", "Storage limit reached.");
    await hydrateUploadBlock();
    expect(useUploadBlock.getState().reason).toBe("Storage limit reached.");
    expect(useUploadBlock.getState().message).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("an upload item's error holds a key", () => {
  it("our own wording reads in the language chosen now; server text is shown as sent", async () => {
    const f = errorFields("upload.error.fileIsNoLongerOnThisDevice");
    expect(f.error).toBe(english("upload.error.fileIsNoLongerOnThisDevice"));
    const tr = await inLocale("tr");
    expect(itemErrorText(f, tr)).toBe(tr("upload.error.fileIsNoLongerOnThisDevice"));
    expect(itemErrorText({ error: "Storage limit reached." }, tr)).toBe("Storage limit reached.");
    // A later failure replaces `error` alone: the old key must not win.
    expect(itemErrorText({ ...f, error: "Boom" }, tr)).toBe("Boom");
    expect(itemErrorText({}, tr)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("literals now in the catalog", () => {
  it("push: the two reasons are in the chosen language", async () => {
    const tr = await inLocale("tr");
    await renderInLocale(<Text>x</Text>, "tr");
    mockIsDevice = false;
    const res = await syncPushRegistration("silent");
    expect(res).toEqual({ kind: "unsupported", reason: tr("notifications.error.pushNeedsAPhysicalDevice") });
    mockIsDevice = true;
    const res2 = await syncPushRegistration("silent");
    expect(res2).toEqual({ kind: "unsupported", reason: tr("notifications.error.pushIsnTConfiguredForThisBuildNoEasProjectId") });
  });

  it("push: English is unchanged", async () => {
    mockIsDevice = false;
    expect(await syncPushRegistration("silent")).toEqual({ kind: "unsupported", reason: "Push needs a physical device." });
  });

  it("the diagnostics card says 'unknown' in the chosen language; the payload stays English", async () => {
    const tr = await inLocale("tr");
    await renderInLocale(<Text>x</Text>, "tr");
    const d = collectMobileDiagnostics({ backup: null } as never, {});
    expect(d.app_version).toBe("unknown");
    expect(d.platform).toBe("unknown");
    const rows = diagnosticsRows(d, null, tr);
    expect(rows.find((r) => r.label === tr("report-problem.label.app"))?.value).toBe(tr("report-problem.label.unknown"));
    expect(rows.find((r) => r.label === tr("report-problem.label.operatingSystem"))?.value).toBe(tr("report-problem.label.unknown"));
    expect(tr("report-problem.label.unknown")).not.toBe("unknown");
    const enRows = diagnosticsRows(d, null, english);
    expect(enRows[0]!.value).toBe("unknown");
  });

  it("the editor page tells the app which failure it is, and the app words it", () => {
    const html = editorHtml({ documentServerUrl: "https://ds", config: { editorConfig: {} } } as never);
    expect(html).toContain('code: "unreachable"');
    expect(html).toContain('message: "Document server unreachable"');
  });
});

describe("welcome card numbers and large-text mode labels", () => {
  it("the mock card phrase and digits follow the chosen language; English is unchanged", async () => {
    const tr = await inLocale("tr");
    await renderInLocale(<BackupArt />, "en");
    expect(screen.getByText("1,204 of 12,885")).toBeTruthy();
    await renderInLocale(<BackupArt />, "tr");
    expect(screen.queryByText(/ of /)).toBeNull();
    expect(screen.getByText(tr("common.label.sentOfTotal", { sent: "1.204", total: "12.885" }))).toBeTruthy();
  });

  it("the Appearance mode labels stay on one line and shrink instead of breaking", async () => {
    await renderInLocale(<AppearanceScreen />, "pl");
    for (const id of ["light", "dark", "system"]) {
      const label = within(screen.getByTestId(`mode-${id}`)).UNSAFE_getByType(Text);
      expect(label.props.numberOfLines).toBe(1);
      expect(label.props.adjustsFontSizeToFit).toBe(true);
    }
  });

  it("the shared Segmented control does the same", async () => {
    await renderInLocale(<Segmented options={[{ key: "a", label: "Aaa" }]} value="a" onChange={() => {}} testID="s" />, "en");
    const label = within(screen.getByTestId("s-a")).UNSAFE_getByType(Text);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.adjustsFontSizeToFit).toBe(true);
  });
});
