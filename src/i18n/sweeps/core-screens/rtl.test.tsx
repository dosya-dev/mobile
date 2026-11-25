/**
 * Core-screen RTL sweep: the core screens swept for i18n (sign-in, files list,
 * file detail, share sheet, backup tab, settings, security, activity, file
 * requests, workspace settings) rendered in Arabic, Hebrew and Persian under
 * the right-to-left layout seam, then once in German under the left-to-right
 * seam. Right to left: no leftover English and no directional icon left
 * unmirrored. German: its text in place and no icon transform at all.
 *
 * One render per screen; the interactions are covered by the sibling sweeps.
 * The mocks below are the union of theirs, steered per test through mutable
 * state (see ../*.test.tsx for the per-screen originals).
 */
import { configure, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { __resetI18nForTests, t } from "@/lib/i18n";
import { layoutIsRtl } from "@/lib/direction";
import type { Locale } from "@/i18n/locales";
import { Icon } from "@/ui/Icon";
import {
  collectTexts,
  renderInLocale,
  unflippedIcons,
  type ReactTestInstance,
} from "../../../../test-utils/i18n-sweep";

import LoginScreen from "../../../../app/(auth)/login";
import SignUpScreen from "../../../../app/(auth)/signup";
import ForgotPasswordScreen from "../../../../app/(auth)/forgot-password";
import ResetPasswordScreen from "../../../../app/(auth)/reset-password";
import TwoFactorScreen from "../../../../app/(auth)/2fa";
import VerifyScreen from "../../../../app/(auth)/verify";
import WelcomeScreen from "../../../../app/(auth)/welcome";
import { AppLockGate } from "@/auth/AppLockGate";
import ActivityScreen from "../../../../app/activity";
import BackupScreen from "../../../../app/(tabs)/backup";
import FileViewerRoute from "../../../../app/(tabs)/(files)/file/[id]";
import RequestsScreen from "../../../../app/file-requests/index";
import RequestDetailScreen from "../../../../app/file-requests/[id]";
import { CreateRequestSheet } from "@/requests/CreateRequestSheet";
import { FileBrowser } from "@/files/FileBrowser";
import SecurityScreen from "../../../../app/security";
import SettingsScreen from "../../../../app/(tabs)/settings";
import { CreateShareSheet } from "@/share/CreateShareSheet";
import { EditShareSheet } from "@/share/EditShareSheet";
import WorkspaceSettingsScreen from "../../../../app/workspace-settings";

import { useAuthStore } from "@/auth/authStore";
import { useWorkspaceStore } from "@/files/workspaceStore";
import { useViewPrefs, DEFAULT_LIBRARY_LAYOUT } from "@/files/viewPrefs";
import { useAppearance } from "@/theme/themeStore";
import { useBackupRun } from "@/backup/runState";
import { useBackupSettings, DEFAULT_BACKUP_SETTINGS } from "@/backup/settings";
import { useUploadStore } from "@/upload/store";
import { useUploadBlock } from "@/upload/uploadBlock";
import { usePacing } from "@/upload/pacing";
import { __resetBackupAlerts } from "@/backup/alerts";
import { useViewerList } from "@/viewer/viewerStore";
import { useArchiveSaveStore } from "@/archive/archiveSaveStore";
import { listActivity } from "@/activity/api";
import { listRequests, listUploads, listRecipients } from "@/requests/api";
import { useWorkspaces, useFileList, useSearch, useFile } from "@/files/hooks";
import { getTrash, getFavourites } from "@/files/api";
import { getWorkspaceDetail, getRoles, getTeam } from "@/workspace/api";
import { useMe, use2faStatus, useSessions } from "@/profile/hooks";
import * as shareHooks from "@/share/hooks";
import type { ShareAnalyticsLink } from "@/share/types";
import * as runtime from "@/update/runtime";

configure({ asyncUtilTimeout: 5000 });
jest.setTimeout(30000);

// ── mocks (union of the sibling sweeps) ─────────────────────────────────────
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const base = require("../../../../test-utils/i18n-sweep").routerMockWithTitles();
  const React = require("react");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const baseScreen = base.Stack.Screen;
  // Header parts become part of the screen.
  const Screen = (props: { options?: Record<string, unknown> }) => {
    const parts: unknown[] = [baseScreen(props)];
    for (const k of ["headerRight", "headerLeft", "headerTitle"]) {
      const fn = props.options?.[k];
      if (typeof fn === "function") parts.push((fn as () => unknown)());
    }
    return React.Children.toArray(parts);
  };
  return {
    ...base,
    Stack: Object.assign(base.Stack, { Screen }),
    useLocalSearchParams: () => mockParams,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []),
  };
});
jest.mock("@/ui/toast", () => ({ toast: jest.fn() }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("@/lib/keychain", () => ({ getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("expo-local-authentication", () => ({
  authenticateAsync: jest.fn(async () => ({ success: true })),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationChannelAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: () => {} })),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));
jest.mock("expo-device", () => ({ osName: "iOS", osVersion: "26.0", modelName: "iPhone 15" }));
jest.mock("expo-application", () => ({ nativeBuildVersion: "37", nativeApplicationVersion: "1.0.2" }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "0.0.0-config" } } }));
jest.mock("@/lib/appVersion", () => ({ getDisplayVersion: () => "1.0.2 (37)" }));
jest.mock("expo-contacts", () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, status: "denied" })),
}));
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true, isDirectory: false, size: 100 })),
  deleteAsync: jest.fn(async () => {}),
}));
const mockPlayer = { play: jest.fn(), pause: jest.fn(), currentTime: 0, muted: false, loop: false, addListener: jest.fn(() => ({ remove: jest.fn() })) };
jest.mock("expo-video", () => ({
  useVideoPlayer: jest.fn((_src: unknown, setup?: (p: unknown) => void) => { setup?.(mockPlayer); return mockPlayer; }),
  VideoView: () => null,
}));
jest.mock("react-native-webview", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const WebView = React.forwardRef(() => null);
  WebView.displayName = "WebView";
  return { WebView, default: WebView };
});
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }));
jest.mock("../../../../modules/dosya-background-upload", () => ({ backgroundUploadNative: () => null }));

// auth
jest.mock("@/auth/lastMethod", () => ({ getLastMethod: jest.fn().mockResolvedValue(null) }));
jest.mock("@/onboarding/onboardingState", () => ({
  setWelcomeSeen: jest.fn(async () => {}),
  readOnboarding: jest.fn(async () => ({ completedAt: null, skippedAt: null, photoPermission: "unasked" })),
  writeOnboarding: jest.fn(async () => ({})),
}));
jest.mock("@/auth/biometric", () => ({
  getBiometricEnabled: jest.fn(async () => true),
  isBiometricAvailable: jest.fn(async () => true),
  authenticateBiometric: jest.fn(async () => false),
  biometricKind: jest.fn(async () => "face"),
  setBiometricEnabled: jest.fn(async () => {}),
}));
// A PIN is set, so every App lock row (biometrics, Lock after, Change PIN) is swept.
jest.mock("@/auth/appLock", () => ({
  ...jest.requireActual("@/auth/appLock"),
  hasPin: jest.fn(async () => true),
  getLockAfter: jest.fn(async () => 60),
}));
jest.mock("@/auth/passwordReset", () => ({
  ...jest.requireActual("@/auth/passwordReset"),
  requestResetCode: jest.fn(),
  submitReset: jest.fn(),
}));
jest.mock("@/auth/pendingOAuth", () => ({
  savePendingOAuth: jest.fn(async () => {}),
  loadPendingOAuth: jest.fn(async () => ({ nonce: "the-nonce", verifier: "v" })),
  clearPendingOAuth: jest.fn(async () => {}),
}));
jest.mock("@/auth/pkce", () => ({ createPkcePair: jest.fn(async () => ({ nonce: "n", challenge: "c", verifier: "v" })) }));
jest.mock("@/auth/authStore", () => ({
  ...jest.requireActual("@/auth/authStore"),
  getAccessToken: jest.fn(() => "tok"),
}));

// files
jest.mock("@/files/hooks", () => ({
  useWorkspaces: jest.fn(),
  useFileList: jest.fn(),
  useSearch: jest.fn(),
  useFile: jest.fn(),
  useRegions: jest.fn(() => ({ data: [{ code: "eu-west-1", city: "Dublin", country: "Ireland", continent: "Europe", flag: "" }] })),
  useWorkspaceStorage: jest.fn(() => ({ data: { used: 12_884_901_888, total: 53_687_091_200, free: 40_802_189_312 }, refetch: jest.fn() })),
}));
jest.mock("@/files/api", () => ({
  ...jest.requireActual("@/files/api"),
  getTrash: jest.fn(),
  getFavourites: jest.fn(),
  getDownloadUrl: jest.fn(async () => "https://r2/x"),
  getVersions: jest.fn(),
  listFiles: jest.fn(async () => ({ files: [], folders: [], breadcrumbs: [], pagination: { page: 1, per_page: 500, total_files: 0, total_pages: 1 } })),
}));
jest.mock("@/files/mutations", () => ({
  ...jest.requireActual("@/files/mutations"),
  deleteFile: jest.fn(),
  restoreFile: jest.fn(),
  unlockFile: jest.fn(async () => "tok_1"),
}));
jest.mock("@/files/mutationHooks", () => ({
  useFileMutations: () => ({
    remove: { mutate: jest.fn() },
    rename: { mutate: jest.fn() },
    removeWithTwin: { mutate: jest.fn() },
    restoreVersion: { mutate: jest.fn() },
  }),
}));
jest.mock("@/files/download", () => ({ downloadToCache: jest.fn(async () => "file:///cache/c.vcf"), shareFile: jest.fn() }));
jest.mock("@/files/byteStore", () => ({ localUri: jest.fn(async () => null), ensureLocal: jest.fn(async () => null) }));
jest.mock("@/files/WorkspaceHeader", () => ({ WorkspaceHeader: () => null }));
jest.mock("@/files/cacheControl", () => ({
  getCacheSizeBytes: jest.fn(async () => 1.5 * 1_073_741_824),
  clearCaches: jest.fn(async () => {}),
}));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ userId: "u1", roleId: "role_c1", roleName: "member", permissions: {}, rootFolderId: null, rootFolderName: null, can: () => true }),
}));
jest.mock("@/player/controller", () => ({ playFolder: jest.fn(async () => true), playFileQueue: jest.fn(async () => true) }));
jest.mock("@/player/useFavourite", () => ({ useFavourite: () => ({ isFav: false, toggle: jest.fn(), busy: false }) }));
jest.mock("@/player/metadata/metadataStore", () => ({ getForTrack: () => null }));
jest.mock("@/reader/readingState", () => ({ loadReadingState: jest.fn(async () => ({ version: 1, location: null, percent: 0, bookmarks: [] })) }));
jest.mock("@/reader/bookCache", () => ({ ensureBookCached: jest.fn(), releaseOpenBooks: jest.fn(async () => {}) }));
jest.mock("@/reader/BookReader", () => ({ BookReader: () => null }));
jest.mock("@/reader/PdfReader", () => ({ PdfReader: () => null }));
jest.mock("@/library/LibraryBrowser", () => ({ LibraryBrowser: () => null }));
jest.mock("@/groups/AddToGroupSheet", () => ({ AddToGroupSheet: () => null }));
jest.mock("@/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
jest.mock("@/account/DeletionBanner", () => ({ DeletionBanner: () => null }));
jest.mock("@/upload/controller", () => ({ startUploads: jest.fn() }));
jest.mock("@/upload/runner", () => ({ uploadOne: jest.fn(async () => ({ fileId: "f1", sizeBytes: null })) }));
jest.mock("@/share-intent/copy", () => ({ toUploadDrafts: jest.fn() }));
jest.mock("@/share-intent/incoming", () => ({ discardSharedFiles: jest.fn(async () => {}) }));
jest.mock("@/contacts/restoreContacts", () => ({ restoreContacts: jest.fn(async () => ({ added: 4, failed: 1 })) }));
jest.mock("@/contacts/backupContacts", () => ({
  backupContacts: jest.fn(async () => ({ count: 3, fileName: "contacts.vcf" })),
  getLastContactsBackupAt: jest.fn(async () => null),
}));
jest.mock("@/backup/folders", () => ({ findContactsFolder: jest.fn(async () => "folder1") }));
jest.mock("@/comments/api", () => ({
  MAX_COMMENT_LENGTH: 5000, listComments: jest.fn(), postComment: jest.fn(), editComment: jest.fn(), deleteComment: jest.fn(),
}));
jest.mock("@/editor/api", () => ({ getEditorConfig: jest.fn(), editorHtml: jest.fn(() => "<html>editor</html>") }));
jest.mock("@/share/SharePreview", () => ({ SharePreview: () => null }));
jest.mock("@/api/client", () => ({ ...jest.requireActual("@/api/client"), apiRequest: jest.fn(async () => ({ ok: true, user: { deletion_scheduled_for: null } })) }));

// backup
jest.mock("@/backup/ledger", () => ({
  countByStatus: jest.fn(async () => ({ pending: 2, queued: 0, uploaded: 5, skipped_large: 1, error: 1 })),
  listByStatus: jest.fn(async () => []),
  resetForRetry: jest.fn(async () => 3),
  setStatus: jest.fn(async () => {}),
}));
jest.mock("@/backup/transport/backgroundTransport", () => ({ queuedJobCount: jest.fn(async () => 0) }));
jest.mock("@/backup/scanner", () => ({
  isPhotoAccessLimited: jest.fn(async () => true),
  countLibraryAssets: jest.fn(async () => 120),
  hasPhotoAccess: jest.fn(async () => false),
  listBackupAlbums: jest.fn(async () => [{ id: "wa", title: "WhatsApp Images", count: 11300 }]),
}));
jest.mock("@/backup/albumDefaults", () => ({ ensureAlbumDefaults: jest.fn(async () => {}) }));
jest.mock("@/onboarding/permissions", () => ({ requestPhotoAccess: jest.fn(async () => "granted") }));
jest.mock("@/backup/policy", () => ({
  ...jest.requireActual("@/backup/policy"),
  readPolicyInputs: jest.fn(async () => ({ connected: true, onWifi: false, charging: true, batteryPercent: 90 })),
}));
jest.mock("@/backup/orchestrator", () => ({ runBackup: jest.fn(async () => ({})), stopBackup: jest.fn(), clearManualStop: jest.fn() }));
jest.mock("@/backup/history", () => ({
  getBackupHistory: jest.fn(async () => [
    { id: "run_1", workspace_name: "Personal", uploaded: 3, deduped: 1, skipped_large: 0, failed: 2, at: 1710000500 },
  ]),
}));
jest.mock("@/backup/settings", () => ({
  ...jest.requireActual("@/backup/settings"),
  getLastRunAt: jest.fn(async () => 1710000000),
  setLastRunAt: jest.fn(async () => {}),
}));
jest.mock("@/backup/reclaim", () => ({
  buildReclaimPlan: jest.fn(async () => ({ ids: ["a", "b"], bytes: 4_509_715_660, unverifiable: 6 })),
  runReclaim: jest.fn(async () => 2),
}));
jest.mock("@/backup/alertReport", () => ({ reportPause: jest.fn(async () => {}) }));

// activity, requests, workspace, profile
jest.mock("@/activity/api", () => ({ ...jest.requireActual("@/activity/api"), listActivity: jest.fn() }));
jest.mock("@/requests/api", () => ({
  listRequests: jest.fn(), createRequest: jest.fn(), listUploads: jest.fn(), listRecipients: jest.fn(),
  addRecipient: jest.fn(), removeRecipient: jest.fn(), resendInvite: jest.fn(), patchRequest: jest.fn(), revokeRequest: jest.fn(),
}));
jest.mock("@/workspace/api", () => ({
  getWorkspaceDetail: jest.fn(), getRoles: jest.fn(), getTeam: jest.fn(),
  updateWorkspaceName: jest.fn(), updateWorkspaceSettings: jest.fn(), transferOwnership: jest.fn(), leaveWorkspace: jest.fn(),
}));
jest.mock("@/workspace-dashboard/api", () => ({
  useWorkspaceDashboard: jest.fn(() => ({ data: { total: { used_bytes: 2_147_483_648, limit_bytes: 10_737_418_240 } } })),
}));
jest.mock("@/telemetry/sentry", () => ({ ...jest.requireActual("@/telemetry/sentry"), reportError: jest.fn(() => "evt_1") }));
jest.mock("@/family/hooks", () => ({ useFamily: jest.fn(() => ({ data: undefined })), FAMILY_KEY: ["family"] }));
// Passkey copy stays English until its translation batch; PasskeysSection has its own tests.
jest.mock("@/profile/PasskeysSection", () => ({ PasskeysSection: () => null }));
jest.mock("@/profile/hooks", () => ({
  useMe: jest.fn(), use2faStatus: jest.fn(), useSessions: jest.fn(),
  ME_KEY: ["me"], TWO_FA_KEY: ["2fa-status"], SESSIONS_KEY: ["sessions"],
}));
jest.mock("@/account/deletion", () => ({
  ...jest.requireActual("@/account/deletion"),
  fetchDeletePreview: jest.fn(), requestDeleteCode: jest.fn(async () => {}), confirmDelete: jest.fn(), cancelDelete: jest.fn(async () => {}),
}));
jest.mock("@/update/runtime");
jest.mock("@/update/sideloadUpdate", () => ({
  checkForUpdate: jest.fn(async () => ({
    status: "available", version: "1.2.0", versionCode: 20, sizeBytes: 68_000_000, downloadPageUrl: "https://dosya.dev/mobile/",
  })),
}));

// ── fixtures ─────────────────────────────────────────────────────────────────
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

// User data, sample addresses and technical names the catalog also holds; not sentences.
const ALLOW = [
  "name@example.com", "a@b.com", "000000", "123456", "Personal", "Acme", "Beta", "AC", "Admin", "Jane", "Jane Doe", "jane@x.com",
  "Boss", "boss@x.com", "eu", "old.pdf", "a.pdf", "b.pdf", "Documents", "Photos", "dosya.dev", "report.pdf", "notes.txt",
  "Brand assets", "guest@example.com", "a@b.c", "logo.png", "Guest", "beach.jpg", "Chrome · 2d ago", "A", "Ada", "ada@x.com",
  "Argon2id", "XChaCha20-Poly1305", "HPKE (X25519)", "1,204 of 12,885", "9%", "macOS", "Windows", "Linux", "iOS", "Android",
  "S3", "WebDAV", "SFTP", "rclone", "CLI", "Camera", "WhatsApp Images", "19 lines",
  // German Jane Doe placeholder; the strict matcher reads it as the English "Max {gb}".
  "Max Mustermann",
];

const FILE = {
  id: "f1", name: "old.pdf", size_bytes: 2048, mime_type: "application/pdf", extension: "pdf",
  created_at: 1700000000, updated_at: 1700000000, current_version: 1, lock_mode: "none",
  share_count: 0, comment_count: 3, is_hidden: 0, current_version_label: undefined,
};
const FOLDER = { id: "fo1", name: "Documents", created_at: 1700000000, lock_mode: "none", file_count: 3, is_synced: 0, is_hidden: 0, hidden_mode: "none" };
const WS = [
  { id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, role_id: "role_owner", joined_at: 1, storage: { used: 100, total: 4096 }, default_region: "eu-west-1" },
  { id: "w2", name: "Beta", slug: "beta", icon_initials: "BE", icon_color: "#2f6fd0", icon_image_url: null, role_id: "role_member", joined_at: 1 },
];
const listState = (over: Record<string, unknown> = {}) => ({
  data: { pages: [{ folders: [FOLDER], files: [FILE], breadcrumbs: [], pagination: { page: 1, total_pages: 1 } }] },
  isLoading: false, isPending: false, isError: false, isRefetching: false,
  isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn(), ...over,
});
const activityRow = (id: string, over: Record<string, unknown> = {}) => ({
  id, action: "file_uploaded", category: "files", entity_type: "file", entity_id: `f_${id}`, resource_name: `${id}.pdf`, entity_name: `${id}.pdf`,
  meta: null, outcome: "success", source: "web", source_ip: null, user_agent: null, session_id: null, on_behalf_of: null, obo_name: null,
  user_id: "u1", user_name: "Ada", user_email: "ada@x.com", created_at: NOW - 3600, ...over,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: "fr_1", token: "tok", title: "Brand assets", message: "Please send the logo",
  is_password_protected: 1, expires_at: NOW + DAY * 5, allowed_extensions: ".jpg, pdf",
  max_file_size_bytes: 5 * 1024 * 1024, max_files: 3, upload_count: 1, is_revoked: 0,
  created_at: NOW - 100, folder_id: null, created_by_name: "Ada", folder_name: null, url: "https://dosya.dev/upload-request/tok", ...over,
}) as never;
const ME = {
  id: "u1", email: "a@b.com", name: "Jane Doe", initials: "JD", avatar_url: null, has_password: true,
  preferred_language: "en", ui_theme: "default", ui_mode: "system",
  created_at: 1700000000, email_verified_at: 1700000000, workspace_count: 2,
};
const DETAIL = {
  workspace: { id: "w1", name: "Acme", slug: "acme", icon_initials: "AC", icon_color: "#22c55e", icon_image_url: null, owner_id: "u9", default_region: "eu", created_at: 1700000000, storage_used_bytes: 10 },
  settings: { max_file_size_gb: 5, max_total_storage_gb: 100, require_2fa: true, session_timeout_minutes: 30 },
  role_id: "role_admin", is_owner: false, plan: "team", storage: { used: 10, total: 100, free: 90 },
};
const ROLES = { roles: [{ id: "role_admin", name: "Admin", is_custom: false, permissions: { a: true, b: false } }], all_permissions: [] };
const TEAM = {
  members: [
    { membership_id: "m1", user_id: "u1", name: "Jane", email: "jane@x.com", role_id: "role_member" },
    { membership_id: "m2", user_id: "u9", name: "Boss", email: "boss@x.com", role_id: "role_owner" },
  ],
};
const SHARE_LINK = {
  link_id: "l1", url: "https://dosya.dev/s/tok", display_name: "Q3.pdf", is_folder: false, is_bundle: false, file_id: "f1", size_bytes: 2048,
  extension: "pdf", region: "weur", created_at: NOW - DAY * 6, created_by: "u1", created_by_name: "Me", is_mine: false,
  expires_at: NOW + 5 * DAY, is_revoked: false, revoked_at: null, is_password_protected: true, lock_mode: "none", access_mode: "restricted",
  status: "active", view_count: 86, download_count: 12, max_downloads: null, downloads_left: null,
} as unknown as ShareAnalyticsLink;
const idle = { mutateAsync: jest.fn(), mutate: jest.fn(), isPending: false };

beforeEach(() => {
  jest.clearAllMocks();
  __resetI18nForTests();
  __resetBackupAlerts();
  mockParams = { id: "f1", fileId: "f1", name: "report.pdf", mode: "copy", email: "a@b.com" };
  useAuthStore.setState({
    status: "signedIn", user: { id: "u1", email: "a@b.com", name: "A", created_at: 1 }, pending2fa: null, error: null,
    pendingVerificationEmail: null, hydrate: jest.fn(),
  } as never);
  useWorkspaceStore.setState({ activeId: "w1" });
  useViewPrefs.setState({ viewMode: "list", libraryLayout: { ...DEFAULT_LIBRARY_LAYOUT }, hydrated: true });
  useAppearance.setState({ theme: "default", mode: "system", hydrated: true });
  useBackupRun.setState({ phase: "idle", workspaceName: null, startedAt: null, backgroundJobs: 0, lastUnreadable: 4 } as never);
  useBackupSettings.setState({ settings: { ...DEFAULT_BACKUP_SETTINGS }, hydrated: true } as never);
  useUploadStore.setState({ items: [], batchStartedAt: null });
  useUploadBlock.setState({ reason: null });
  usePacing.setState({ thermal: "nominal", charging: true, connected: true, onWifi: true, policyOverride: { wifi: false, charging: false } });
  useViewerList.getState().clearViewerList();
  useArchiveSaveStore.getState().take();
  (listActivity as jest.Mock).mockResolvedValue({
    activities: [activityRow("a1"), activityRow("a2", { action: "file_renamed", outcome: "denied", source: "mobile", meta: { old_name: "a", new_name: "b" } })],
    members: [{ id: "u1", name: "Ada", email: "ada@x.com" }], total: 2, hasMore: false,
  });
  (listRequests as jest.Mock).mockResolvedValue([request(), request({ id: "fr_2", title: null, is_revoked: 1, expires_at: null, max_files: null, allowed_extensions: null, max_file_size_bytes: null })]);
  (listUploads as jest.Mock).mockResolvedValue({
    request: request(),
    uploads: [{ id: "fru_1", file_id: "f1", uploader_email: "guest@example.com", uploader_name: null, created_at: NOW - 50, file_name: "logo.png", size_bytes: 2048, mime_type: "image/png", extension: ".png" }],
  });
  (listRecipients as jest.Mock).mockResolvedValue([
    { id: "rcp_1", email: "a@b.c", token: "t", sent_at: NOW - 60, uploaded_at: null, created_at: NOW - 60 },
    { id: "rcp_2", email: "u@v.w", token: "t", sent_at: NOW - 60, uploaded_at: NOW, created_at: NOW - 60 },
  ]);
  (useWorkspaces as jest.Mock).mockReturnValue({ data: WS, isLoading: false, isPending: false });
  (useFileList as jest.Mock).mockReturnValue(listState());
  (useSearch as jest.Mock).mockReturnValue({ data: { files: [], folders: [] }, isFetching: false });
  (useFile as jest.Mock).mockReturnValue({ data: { ...FILE, name: "notes.txt", mime_type: "text/plain", extension: ".txt" }, isLoading: false, isError: false, refetch: jest.fn() });
  (getTrash as jest.Mock).mockResolvedValue({ folders: [], files: [], breadcrumbs: [], pagination: { page: 1, per_page: 100, total_files: 0, total_pages: 1 } });
  (getFavourites as jest.Mock).mockResolvedValue({ folders: [], files: [] });
  (getWorkspaceDetail as jest.Mock).mockResolvedValue(DETAIL);
  (getRoles as jest.Mock).mockResolvedValue(ROLES);
  (getTeam as jest.Mock).mockResolvedValue(TEAM);
  (useMe as jest.Mock).mockReturnValue({ data: ME, isLoading: false, isError: false, refetch: jest.fn() });
  (use2faStatus as jest.Mock).mockReturnValue({ data: { method: null, totp_enabled: false, recovery_codes_remaining: 0 }, isLoading: false, isError: false, refetch: jest.fn() });
  (useSessions as jest.Mock).mockReturnValue({
    data: [
      { id: "sess_1", device: "Mac", kind: "desktop", browser: "Chrome", meta: "Chrome · 2d ago", is_current: false, created_at: 2 },
      { id: "mtk_1", device: "iPhone", kind: "mobile", browser: "dosya.dev app", meta: "dosya.dev app · active now", is_current: true, created_at: 1 },
    ],
    isLoading: false, isError: false, refetch: jest.fn(), isRefetching: false,
  });
  jest.spyOn(runtime, "getDistributionChannel").mockReturnValue("direct");
  jest.spyOn(runtime, "getInstalledVersionCode").mockReturnValue(14);
  jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
    createLink: { mutateAsync: jest.fn(async () => ({ url: "https://dosya.dev/s/tok" })), isPending: false },
    email: idle, revoke: idle, createFolderLink: idle, folderEmail: idle, update: idle,
  } as never);
  jest.spyOn(shareHooks, "useIsFreePlan").mockReturnValue(false);
  jest.spyOn(shareHooks, "useFolderShareExclusions").mockReturnValue({ data: undefined } as never);
  jest.spyOn(shareHooks, "useWorkspaceShareDefault").mockReturnValue({ data: 14 } as never);
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as never;
});

// ── helpers ──────────────────────────────────────────────────────────────────
function withQuery(ui: ReactElement): ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

/** Icons under the screen that carry a mirror transform (must be none when the layout is left to right). */
function mirroredIcons(tree: ReactTestInstance): string[] {
  return tree
    .findAll((n) => n.type === Icon)
    .filter((icon) =>
      icon.findAll((n) => {
        const t = (StyleSheet.flatten(n.props?.style as never) as { transform?: unknown } | undefined)?.transform;
        return Array.isArray(t) && t.some((x) => (x as { scaleX?: number })?.scaleX === -1);
      }).length > 0,
    )
    .map((icon) => String(icon.props.name));
}

type Ready = () => Promise<unknown> | unknown;
interface Screen {
  name: string;
  ui: () => ReactElement;
  ready?: Ready;
  setup?: () => void;
}

const byId = (id: string): Ready => () => waitFor(() => expect(screen.getByTestId(id)).toBeTruthy());
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

const SCREENS: Screen[] = [
  { name: "login", ui: () => <LoginScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null, error: "Invalid email or password" } as never) },
  { name: "sign up", ui: () => <SignUpScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null } as never) },
  { name: "forgot password", ui: () => <ForgotPasswordScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null } as never) },
  { name: "reset password", ui: () => <ResetPasswordScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null } as never) },
  { name: "two-factor", ui: () => <TwoFactorScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null, pending2fa: { method: "totp" } } as never) },
  { name: "verify", ui: () => <VerifyScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null, pendingVerificationEmail: "a@b.com" } as never) },
  { name: "welcome", ui: () => <WelcomeScreen />, setup: () => useAuthStore.setState({ status: "signedOut", user: null } as never) },
  {
    name: "locked",
    ui: () => <AppLockGate><></></AppLockGate>,
    ready: () => waitFor(() => expect(screen.getByText(t("security.heading.enterYourPin"))).toBeTruthy()),
    setup: () => useAuthStore.setState({ status: "signedOut", user: null } as never),
  },
  { name: "files list", ui: () => withQuery(<FileBrowser folderId={null} />) },
  {
    name: "file detail",
    ui: () => withQuery(<FileViewerRoute />),
    ready: byId("viewer-action-more"),
    setup: () => {
      (useFile as jest.Mock).mockReturnValue({ data: { ...FILE, name: "notes.txt", mime_type: "text/plain", extension: ".txt" }, isLoading: false, isError: false, refetch: jest.fn() });
    },
  },
  { name: "share sheet (create)", ui: () => <CreateShareSheet visible target={{ kind: "file", id: "f1", name: "beach.jpg", sizeBytes: 2048, extension: "jpg" }} onClose={jest.fn()} /> },
  { name: "share sheet (edit)", ui: () => <EditShareSheet visible link={SHARE_LINK} recipientEmails={["ada@x.com"]} onClose={jest.fn()} /> },
  { name: "backup tab", ui: () => <BackupScreen />, ready: async () => { await settle(); await screen.findByTestId("backup-now"); await screen.findByTestId("backup-history"); } },
  { name: "settings tab", ui: () => <SettingsScreen />, ready: byId("settings-clear-cache") },
  { name: "security", ui: () => withQuery(<SecurityScreen />), ready: byId("change-pin") },
  { name: "activity", ui: () => withQuery(<ActivityScreen />), ready: byId("activity-a1") },
  { name: "file requests list", ui: () => withQuery(<RequestsScreen />), ready: byId("request-fr_1"), setup: () => { mockParams = { id: "fr_1" }; } },
  { name: "file request detail", ui: () => withQuery(<RequestDetailScreen />), ready: byId("detail-link"), setup: () => { mockParams = { id: "fr_1" }; } },
  { name: "file request create sheet", ui: () => <CreateRequestSheet visible busy={false} resultUrl={null} onSubmit={() => {}} onClose={() => {}} onCopyResult={() => {}} /> },
  { name: "workspace settings", ui: () => withQuery(<WorkspaceSettingsScreen />), ready: byId("ws-name") },
];

async function open(s: Screen, locale: Locale) {
  s.setup?.();
  const view = await renderInLocale(s.ui(), locale);
  await settle();
  if (s.ready) await s.ready();
  return view;
}

describe.each(["ar", "he", "fa"] as const)("core screens in %s (right to left)", (locale) => {
  it.each(SCREENS.map((s) => [s.name, s] as const))("%s: no leftover English, no unmirrored icon", async (_name, s) => {
    const view = await open(s, locale);
    expect(layoutIsRtl()).toBe(true);
    expect(collectTexts().length).toBeGreaterThan(0);
    expect(view.leftover({ allow: ALLOW })).toEqual([]);
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
  });
});

describe("core screens in de (left to right)", () => {
  it.each(SCREENS.map((s) => [s.name, s] as const))("%s: German in place, no icon transform", async (_name, s) => {
    const view = await open(s, "de");
    expect(layoutIsRtl()).toBe(false);
    expect(collectTexts().length).toBeGreaterThan(0);
    expect(view.leftover({ allow: ALLOW })).toEqual([]);
    expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
    expect(mirroredIcons(screen.UNSAFE_root)).toEqual([]);
  });
});
