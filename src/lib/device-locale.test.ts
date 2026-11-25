import type { Locale } from "@/i18n/locales";
import { LOCALES } from "@/i18n/locales";
import { deviceLanguageTags, matchDeviceLocale } from "./device-locale";

const mockGetLocales = jest.fn();
jest.mock("expo-localization", () => ({ getLocales: () => mockGetLocales() }));

const without = (...drop: string[]) => LOCALES.filter((l) => !drop.includes(l)) as Locale[];
// ur is not shipped at the moment; a test that needs it shipped adds it.
const withUr = [...LOCALES, "ur"] as Locale[];

describe("matchDeviceLocale", () => {
  const table: [string[], Locale][] = [
    [["pt-PT"], "pt-PT"],
    [["pt-AO"], "pt-PT"],
    [["pt-MZ"], "pt-PT"],
    [["pt_pt"], "pt-PT"],
    [["pt"], "pt-BR"],
    [["pt-BR"], "pt-BR"],
    [["zh-TW"], "zh-Hant"],
    [["zh-Hant-HK"], "zh-Hant"],
    [["zh-hant-tw"], "zh-Hant"],
    [["zh-MO"], "zh-Hant"],
    [["zh-CN"], "zh-Hans"],
    [["zh-SG"], "zh-Hans"],
    [["zh"], "zh-Hans"],
    [["zh-Hans-TW"], "zh-Hans"],
    [["nn-NO"], "nb"],
    [["no"], "nb"],
    [["nb-NO"], "nb"],
    [["es-MX"], "es-419"],
    [["es-AR"], "es-419"],
    [["es-CO"], "es-419"],
    [["es-US"], "es-419"],
    [["es-419"], "es-419"],
    [["es-ES"], "es"],
    [["es"], "es"],
    [["fr-CA"], "fr-CA"],
    [["fr-FR"], "fr"],
    [["fr-BE"], "fr"],
    [["fr"], "fr"],
    [["sr"], "sr"],
    [["sr-RS"], "sr"],
    [["sr-Latn-RS"], "sr"],
    [["sr-Cyrl"], "sr"],
    [["ru-RU"], "ru"],
    [["uk-UA"], "uk"],
    [["ar-SA"], "ar"],
    [["ar-SA", "de-DE"], "ar"],
    [["he-IL"], "he"],
    [["fa-IR"], "fa"],
    [["ur-PK", "en-GB"], "en"],
    [["ar-SA", "en-GB", "de-DE"], "ar"],
    [["ur-PK", "uk-UA", "ar-EG"], "uk"],
    [["de_DE"], "de"],
    [["pt-BR"], "pt-BR"],
    [["zh-Hans"], "zh-Hans"],
    [["tr-TR"], "tr"],
    [[""], "en"],
    [[], "en"],
  ];
  it.each(table)("%j gives %s", (tags, want) => {
    expect(matchDeviceLocale(tags, LOCALES)).toBe(want);
  });

  it("gives es-419 for a Latin American Spanish tag only when es-419 is shipped", () => {
    for (const tag of ["es-MX", "es-419", "es-AR", "es-CO", "es-PR", "es-US", "es-CL", "es-PE"]) {
      expect(matchDeviceLocale([tag], LOCALES)).toBe("es-419");
      expect(matchDeviceLocale([tag], without("es-419"))).toBe("es");
    }
    expect(matchDeviceLocale(["es-ES"], LOCALES)).toBe("es");
  });

  it("gives fr-CA only when it is shipped", () => {
    expect(matchDeviceLocale(["fr-CA"], without("fr-CA"))).toBe("fr");
    expect(matchDeviceLocale(["fr-CH"], LOCALES)).toBe("fr");
  });

  it("gives pt-PT to European and African Portuguese, and pt-BR to Brazil and plain pt", () => {
    for (const tag of ["pt-PT", "pt-AO", "pt-MZ", "pt-CV"]) expect(matchDeviceLocale([tag], LOCALES)).toBe("pt-PT");
    for (const tag of ["pt-BR", "pt"]) expect(matchDeviceLocale([tag], LOCALES)).toBe("pt-BR");
    expect(matchDeviceLocale(["pt-AO"], without("pt-PT"))).toBe("pt-BR");
    expect(matchDeviceLocale(["pt"], without("pt-BR"))).toBe("pt-PT");
  });

  it("picks up a language that becomes shipped later", () => {
    expect(matchDeviceLocale(["ur-PK"], withUr)).toBe("ur");
  });

  it("never returns an unshipped language, and takes the first shipped one", () => {
    expect(matchDeviceLocale(["ur-PK", "ps-AF", "ar-EG"], LOCALES)).toBe("ar");
  });
});

describe("deviceLanguageTags", () => {
  it("lists the phone's tags in order", () => {
    mockGetLocales.mockReturnValueOnce([{ languageTag: "tr-TR" }, { languageTag: "en-US" }]);
    expect(deviceLanguageTags()).toEqual(["tr-TR", "en-US"]);
  });

  it("is empty when the native call throws", () => {
    mockGetLocales.mockImplementationOnce(() => {
      throw new Error("no native module");
    });
    expect(deviceLanguageTags()).toEqual([]);
  });

  it("is empty when the answer is not a list", () => {
    mockGetLocales.mockReturnValueOnce(undefined);
    expect(deviceLanguageTags()).toEqual([]);
  });
});
