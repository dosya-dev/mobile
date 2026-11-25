import { NativeModules } from "react-native";
import { Passkey, type PasskeyCreateResult, type PasskeyGetResult } from "react-native-passkey";
import {
  assertionToJson, attestationToJson, createPasskeyCredential, isPasskeyCancelled,
  isPasskeySupported, passkeyFailureMessage, toBase64Url,
} from "./passkey";
import type { MessageKey } from "@/i18n/keys";

jest.mock("react-native-passkey", () => ({
  Passkey: { isSupported: jest.fn(() => true), get: jest.fn(), createPlatformKey: jest.fn(), create: jest.fn() },
}));

const t = (key: MessageKey) => key;

describe("toBase64Url", () => {
  it("rewrites the standard alphabet and strips padding", () => {
    expect(toBase64Url("a+b/c==")).toBe("a-b_c");
    expect(toBase64Url("abc=")).toBe("abc");
  });

  it("leaves a base64url value alone", () => {
    expect(toBase64Url("a-b_c")).toBe("a-b_c");
  });
});

describe("assertionToJson", () => {
  const result: PasskeyGetResult = {
    id: "cred+id/1==",
    rawId: "cred+id/1==",
    response: {
      clientDataJSON: "client+data=",
      authenticatorData: "auth/data==",
      signature: "sig+nature/==",
      userHandle: "user+handle=",
    },
  };

  it("emits every field the verify route reads, all base64url", () => {
    expect(assertionToJson(result)).toEqual({
      id: "cred-id_1",
      rawId: "cred-id_1",
      type: "public-key",
      response: {
        clientDataJSON: "client-data",
        authenticatorData: "auth_data",
        signature: "sig-nature_",
        userHandle: "user-handle",
      },
      clientExtensionResults: {},
    });
  });

  it("fills in rawId when the platform omits it, since the server refuses a response without one", () => {
    const { rawId: _, ...withoutRawId } = result;
    expect(assertionToJson(withoutRawId).rawId).toBe("cred-id_1");
  });

  it("drops an empty user handle instead of sending a blank string", () => {
    const json = assertionToJson({ ...result, response: { ...result.response, userHandle: "" } });
    expect(json.response).not.toHaveProperty("userHandle");
  });
});

describe("attestationToJson", () => {
  const result: PasskeyCreateResult = {
    id: "new+id=",
    rawId: "new+id=",
    response: { clientDataJSON: "client/data=", attestationObject: "att+obj==" },
  };

  it("converts the fields the save route verifies", () => {
    expect(attestationToJson(result)).toEqual({
      id: "new-id",
      rawId: "new-id",
      type: "public-key",
      response: { clientDataJSON: "client_data", attestationObject: "att-obj" },
      clientExtensionResults: {},
    });
  });
});

describe("createPasskeyCredential", () => {
  it("asks for a platform key, never the combined request", async () => {
    (Passkey.createPlatformKey as jest.Mock).mockResolvedValue({
      id: "a", rawId: "a", response: { clientDataJSON: "b", attestationObject: "c" },
    });
    await createPasskeyCredential({} as never);
    expect(Passkey.createPlatformKey).toHaveBeenCalled();
    expect(Passkey.create).not.toHaveBeenCalled();
  });
});

describe("isPasskeySupported", () => {
  afterEach(() => { delete (NativeModules as Record<string, unknown>).Passkey; });

  it("is false in a binary without the native module, whatever the OS says", () => {
    expect(isPasskeySupported()).toBe(false);
  });

  it("follows the OS once the module is linked", () => {
    (NativeModules as Record<string, unknown>).Passkey = {};
    expect(isPasskeySupported()).toBe(true);
    (Passkey.isSupported as jest.Mock).mockReturnValueOnce(false);
    expect(isPasskeySupported()).toBe(false);
  });
});

describe("error handling", () => {
  it("recognises the library's cancel", () => {
    expect(isPasskeyCancelled({ error: "UserCancelled", message: "x" })).toBe(true);
    expect(isPasskeyCancelled({ error: "RequestFailed", message: "x" })).toBe(false);
    expect(isPasskeyCancelled(new Error("UserCancelled"))).toBe(false);
    expect(isPasskeyCancelled(null)).toBe(false);
  });

  it("shows a server sentence as it is", () => {
    expect(passkeyFailureMessage(new Error("Password is incorrect"), "security.heading.passkeys", t)).toBe("Password is incorrect");
  });

  it("maps library codes to copy and never shows the library's own message", () => {
    expect(passkeyFailureMessage({ error: "NoCredentials", message: "dev text" }, "security.heading.passkeys", t))
      .toBe("sign-in.error.weCouldNotFindADosyaPasskeyOnThisDevice");
    expect(passkeyFailureMessage({ error: "BadConfiguration", message: "dev text" }, "security.heading.passkeys", t))
      .toBe("security.heading.passkeys");
  });
});
