import { describe, expect, it } from "vitest";
import { hasStrings, stringsFor } from "./ui-strings";
import { COUNTER_LANGUAGES } from "./languages";

const KEYS = Object.keys(stringsFor("en-US")) as Array<keyof ReturnType<typeof stringsFor>>;

describe("counter interface strings", () => {
  it("has every key in every language it claims to cover", () => {
    // A half-translated interface is worse than an English one: the visitor
    // cannot tell which of the two languages on screen is the real label.
    for (const language of COUNTER_LANGUAGES) {
      if (!hasStrings(language.code)) continue;
      const strings = stringsFor(language.code);
      for (const key of KEYS) {
        expect(strings[key], `${language.code}.${key}`).toBeTruthy();
      }
    }
  });

  it("never leaves a string in Korean for a language that is not Korean", () => {
    const hangul = /[가-힣]/;
    for (const language of COUNTER_LANGUAGES) {
      if (language.code === "ko-KR" || !hasStrings(language.code)) continue;
      const strings = stringsFor(language.code);
      for (const key of KEYS) {
        expect(hangul.test(strings[key]), `${language.code}.${key}`).toBe(false);
      }
    }
  });

  it("covers every language the picker offers", () => {
    // The picker is written in endonyms, so a visitor can always *find* their
    // language. Landing in an English interface after choosing it is the part
    // they cannot ask about, and it was happening for seven of the languages
    // on the list.
    for (const language of COUNTER_LANGUAGES) {
      expect(hasStrings(language.code), language.code).toBe(true);
    }
  });

  it("falls back to English, not to Korean", () => {
    // A visitor at a Korean counter is likelier to manage some English than
    // some Korean, and the language picker is in endonyms either way.
    expect(stringsFor("sw-KE")).toEqual(stringsFor("en-US"));
    expect(stringsFor("is-IS").send).toBe("Send");
  });

  it("matches on the base tag when the region differs", () => {
    expect(stringsFor("es-MX")).toEqual(stringsFor("es-ES"));
    expect(stringsFor("en-GB")).toEqual(stringsFor("en-US"));
  });

  it("reports coverage honestly", () => {
    expect(hasStrings("vi-VN")).toBe(true);
    expect(hasStrings("vi")).toBe(true);
    expect(hasStrings("sw-KE")).toBe(false);
  });

  it("gives Uyghur its own interface rather than an Arabic one", () => {
    const uyghur = stringsFor("ug-CN");
    expect(uyghur).not.toEqual(stringsFor("ar-SA"));
    expect(uyghur).not.toEqual(stringsFor("en-US"));
    expect(stringsFor("ug")).toEqual(uyghur);
    // Arabic-script, but not the Arabic language: the two share letters and
    // nothing else, and routing one to the other is the mistake this entry
    // exists to prevent.
    expect(uyghur.send).not.toBe(stringsFor("ar-SA").send);
  });
});
