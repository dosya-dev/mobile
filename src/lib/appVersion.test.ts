/**
 * The interesting cases here are all the ones where a native version is
 * MISSING, because that is where a version line goes quietly wrong. Expo Go,
 * the web build and jest all have no native binary, and rendering
 * "1.0.1 (null)" or "Version undefined" to a user would be worse than
 * rendering nothing at all.
 *
 * The factories below return plain literals rather than closing over
 * module-scope state: jest hoists `jest.mock` above every `const`, so a
 * factory that referenced one would capture `undefined` and every test would
 * fail on a mock that looks correct. The objects are mutated per test instead.
 */
jest.mock("expo-application", () => ({ nativeApplicationVersion: null, nativeBuildVersion: null }));
jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { version: "1.0.1" } } }));

import * as Application from "expo-application";
import Constants from "expo-constants";
import { getDisplayVersion } from "./appVersion";

// The real modules declare these as read-only constants; the mocks are plain
// objects, so this cast is what lets a test set up a platform.
const app = Application as unknown as { nativeApplicationVersion: string | null; nativeBuildVersion: string | null };
const constants = Constants as unknown as { expoConfig: { version?: string } | null };

describe("getDisplayVersion", () => {
  beforeEach(() => {
    app.nativeApplicationVersion = null;
    app.nativeBuildVersion = null;
    constants.expoConfig = { version: "1.0.1" };
  });

  it("joins the installed version and build number", () => {
    app.nativeApplicationVersion = "1.0.1";
    app.nativeBuildVersion = "36";
    expect(getDisplayVersion()).toBe("1.0.1 (36)");
  });

  it("prefers the native version over the config literal", () => {
    // The config legitimately runs ahead of the installed binary: a user on
    // build 36 must keep seeing 1.0.1 after we bump app.config.ts to 1.0.2.
    // The binary on the device is the truth.
    app.nativeApplicationVersion = "1.0.1";
    app.nativeBuildVersion = "36";
    constants.expoConfig = { version: "1.0.2" };
    expect(getDisplayVersion()).toBe("1.0.1 (36)");
  });

  it("falls back to the config version when there is no native binary", () => {
    expect(getDisplayVersion()).toBe("1.0.1");
  });

  it("omits the build number rather than rendering a null one", () => {
    app.nativeApplicationVersion = "1.0.1";
    expect(getDisplayVersion()).toBe("1.0.1");
  });

  it("drops an empty build number too", () => {
    app.nativeApplicationVersion = "1.0.1";
    app.nativeBuildVersion = "";
    expect(getDisplayVersion()).toBe("1.0.1");
  });

  it("returns null when nothing knows the version, so Settings renders no line", () => {
    constants.expoConfig = null;
    expect(getDisplayVersion()).toBeNull();
  });
});
