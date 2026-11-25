import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProfileScreen from "../../app/profile";
import CommentsScreen from "../../app/comments";
import MySharesScreen from "../../app/shares/index";
import * as shareHooks from "@/share/hooks";
import * as filesHooks from "@/files/hooks";
import { useMe } from "@/profile/hooks";
import { useFamily } from "@/family/hooks";
import { listComments } from "@/comments/api";
import { collectTexts, renderInLocale, unflippedIcons } from "../../test-utils/i18n-sweep";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ fileId: "f1", name: "report.pdf" }),
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock("@/profile/hooks", () => ({ useMe: jest.fn(), ME_KEY: ["me"] }));
jest.mock("@/family/hooks", () => ({ useFamily: jest.fn(), FAMILY_KEY: ["family"] }));
jest.mock("@/files/workspaceStore", () => ({
  useWorkspaceStore: (selector: (s: { activeId: string | null }) => unknown) => selector({ activeId: "w1" }),
}));
jest.mock("@/comments/api", () => ({
  MAX_COMMENT_LENGTH: 5000,
  listComments: jest.fn(),
  postComment: jest.fn(),
  editComment: jest.fn(),
  deleteComment: jest.fn(),
}));
jest.mock("@/workspace/usePermissions", () => ({
  usePermissions: () => ({ userId: "u1", roleName: "member", can: () => true }),
}));

const root = join(__dirname, "../..");

// Files this unit owns (the Task 7 row for unit A), minus tests, generated and probe files.
function ownedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.|\.generated\.|\.d\.ts$/.test(name)) out.push(relative(root, p));
    }
  };
  walk(join(root, "app"));
  for (const d of [
    "auth", "vault", "family", "profile", "requests", "groups", "workspace", "workspace-dashboard", "account",
    "support", "update", "comments", "contacts", "duplicates", "editor", "map", "share-intent", "upload", "legal",
  ]) walk(join(root, "src", d));
  return out.filter(
    (f) => !/^app\/(player\.tsx|language\.tsx|_layout\.tsx)$/.test(f) && !f.startsWith("app/file/"),
  );
}

// Reserved for Task 8 (pager scroll offset) and not this unit's (orbit/FamilyUsage SVG geometry).
const RESERVED = [/^app\/\(tabs\)\/\(files\)\/file\/\[id\]\.tsx:817 /, /^src\/family\/FamilyUsage\.tsx:/];

const ME = {
  id: "u1", email: "a@b.com", name: "Jane Doe", initials: "JD", avatar_url: null,
  preferred_language: "en", ui_theme: "default", ui_mode: "system",
  created_at: 1700000000, email_verified_at: 1700000000, workspace_count: 2,
};
const now = Math.floor(Date.now() / 1000);

function setup() {
  (useMe as jest.Mock).mockReturnValue({ data: ME, isLoading: false, isError: false, refetch: jest.fn() });
  (useFamily as jest.Mock).mockReturnValue({ data: undefined });
  (listComments as jest.Mock).mockResolvedValue([
    {
      id: "c1", file_id: "f1", folder_id: null, workspace_id: "w1", user_id: "u1", parent_id: null, body: "hello",
      is_edited: 0, created_at: now, updated_at: now, user_name: "Ada", user_email: "a@b.c", user_avatar: null,
    },
  ]);
  jest.spyOn(filesHooks, "useWorkspaces").mockReturnValue({ data: [{ id: "w1" }] } as never);
  jest.spyOn(shareHooks, "useShareMutations").mockReturnValue({
    createLink: {}, email: {}, revoke: { mutate: jest.fn() }, createFolderLink: {}, folderEmail: {}, update: {},
  } as never);
  jest.spyOn(shareHooks, "useSharedWithMe").mockReturnValue({
    data: { links: [], emailVerified: true, stats: { total: 0, active: 0, unopened: 0 } },
    isLoading: false, isRefetching: false, refetch: jest.fn(),
  } as never);
  jest.spyOn(shareHooks, "useMyShares").mockReturnValue({
    data: {
      links: [{
        link_id: "l1", token: "t1", url: "https://dosya.dev/s/t1", display_name: "a.txt", file_id: "f1",
        file_name: "a.txt", folder_id: null, folder_name: null, is_folder: false, is_bundle: 0, size_bytes: 100,
        extension: "txt", region: "weur", is_password_protected: 0, lock_mode: "none", access_mode: "public",
        recipient_count: 0, is_revoked: 0, revoked_at: null, expires_at: null, view_count: 2, download_count: 1,
        max_downloads: null, shared_at: now - 86400, created_by: "u1", sharer_name: "Me", status: "active", is_mine: true,
      }],
      stats: { total: 1, active: 1, expiring: 0, total_views: 2 },
    },
    isLoading: false, isRefetching: false, refetch: jest.fn(),
  } as never);
}

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } })}>{ui}</QueryClientProvider>
);

const SCREENS: [string, () => React.ReactElement, string][] = [
  ["profile", () => wrap(<ProfileScreen />), "profile-name"],
  ["comments", () => wrap(<CommentsScreen />), "comment-c1"],
  ["shares", () => wrap(<MySharesScreen />), "share-row-l1"],
];

// English output captured from the base commit (0e885e862), never edited.
// The clock reading of a comment is the one text that depends on when the test runs.
const texts = () => collectTexts().filter((x) => !/^· \d/.test(x));

const BASE_EN: Record<string, string[]> = {
  profile: ["Profile","Change avatar","JD","Jane Doe","a@b.com","Member since November 2023 · 2 workspaces","Identity","Full name","Full name","Jane Doe","Save","Email","Verified","name@example.com","Account","Password & 2FA","Notification settings","Appearance","Sessions","My workspaces","Report a problem","Tell us about a bug. Device details travel with it.","Delete account"],
  comments: ["report.pdf","Today","You","hello","Reply","Reply","Edit","Edit","Delete","Delete","Write a comment…","Send comment"],
  shares: ["Shared by me","Shared with me","Filter by name or person","1","Active","2","Views","0","Expiring","1","Total","All","Active","Expiring","Expired","Revoked","a.txt, Never expires","TXT","a.txt","Never expires","2","1 dl","Copy link","Revoke share"],
};

describe("unit A (app and the rest) in RTL", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setup();
  });

  it("the source gate lists nothing unmarked outside the reserved lines", () => {
    let out = "";
    try {
      out = execFileSync("node", ["scripts/rtl-gate.mjs", "--check", ...ownedFiles()], { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? e);
    }
    const left = out.split("\n").filter((l) => l.trim() && !RESERVED.some((r) => r.test(l)));
    expect(left).toEqual([]);
  });

  for (const [name, make, ready] of SCREENS) {
    it(`${name} mirrors its directional icons in ar`, async () => {
      await renderInLocale(make(), "ar");
      await waitFor(() => expect(screen.getByTestId(ready)).toBeTruthy());
      expect(unflippedIcons(screen.UNSAFE_root)).toEqual([]);
    });

    it(`${name} reads the same in en as at the base commit`, async () => {
      await renderInLocale(make(), "en");
      await waitFor(() => expect(screen.getByTestId(ready)).toBeTruthy());
      expect(texts()).toEqual(BASE_EN[name]);
    });
  }
});
