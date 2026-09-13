import { describe, expect, it } from "vitest";
import {
  enforceTerminology,
  isEnforceableForm,
  isVariantOf,
  settledForms,
} from "./consistency";

const forms = (input: Parameters<typeof settledForms>[0]) => settledForms(input);

describe("which forms are enforced at all", () => {
  it("accepts name-shaped forms", () => {
    expect(isEnforceableForm("Ryu Jeong-gil")).toBe(true);
    expect(isEnforceableForm("Grace Community Church")).toBe(true);
    expect(isEnforceableForm("Seoul")).toBe(true);
  });

  it("refuses ordinary vocabulary, so a transcript is never re-worded", () => {
    expect(isEnforceableForm("justification")).toBe(false);
    expect(isEnforceableForm("the kingdom of God")).toBe(false);
    expect(isEnforceableForm("")).toBe(false);
  });

  it("refuses scripts where capitalisation cannot mark a name", () => {
    // Nothing in 은혜 says "this is an entity", so the fuzzy rule must not run.
    expect(isEnforceableForm("은혜")).toBe(false);
    expect(isEnforceableForm("金秀賢")).toBe(false);
  });
});

describe("settled-form precedence", () => {
  it("puts a user correction ahead of anything the model said", () => {
    const list = forms({
      corrections: [{ from: "유정길", to: "류정길", at: 0, english: "Ryu Jeong-gil" }],
      entities: [{ korean: "류정길", english: "Yu Jung-gil", kind: "person" }],
    });
    expect(list[0].canonical).toBe("Ryu Jeong-gil");
    // The model's spelling is a variant of the correction, so it is not also
    // registered as its own canonical form.
    expect(list).toHaveLength(2);
    expect(list.map((form) => form.canonical)).toContain("Yu Jung-gil");
  });

  it("puts the longest form first so a prefix cannot claim the match", () => {
    const list = forms({
      entities: [
        { korean: "은혜교회", english: "Grace Church", kind: "organisation" },
        { korean: "은혜공동체교회", english: "Grace Community Church", kind: "organisation" },
      ],
    });
    expect(list[0].canonical).toBe("Grace Community Church");
  });
});

describe("variant detection", () => {
  const form = forms({ entities: [{ korean: "류정길", english: "Ryu Jeong-gil", kind: "person" }] })[0];

  it("recognises a plausible misspelling of the same name", () => {
    expect(isVariantOf("Ryu Jung-gil", form)).toBe(true);
    expect(isVariantOf("Ryu Jeonggil", form)).toBe(true);
    expect(isVariantOf("Ryu Jeong Gil", form)).toBe(true);
  });

  it("refuses a different name that merely rhymes", () => {
    expect(isVariantOf("Kim Jeong-gil", form)).toBe(false);
    expect(isVariantOf("Ryu Min-seok", form)).toBe(false);
    expect(isVariantOf("Ryan", form)).toBe(false);
  });

  it("accepts a different initial only when the rest of the name carries it", () => {
    // 류 romanises as both Ryu and Yu, and eleven shared characters are enough
    // to be sure it is the same person.
    expect(isVariantOf("Yu Jeong-gil", form)).toBe(true);

    // Three characters are not. Kim and Lim are one edit apart and are two
    // different surnames.
    const short = forms({ entities: [{ korean: "김", english: "Kim", kind: "person" }] })[0];
    expect(isVariantOf("Lim", short)).toBe(false);
    expect(isVariantOf("Kin", short)).toBe(true);
  });

  it("is not a variant of itself", () => {
    expect(isVariantOf("Ryu Jeong-gil", form)).toBe(false);
  });
});

describe("enforcement in produced text", () => {
  const list = forms({
    entities: [
      { korean: "류정길", english: "Ryu Jeong-gil", kind: "person" },
      { korean: "은혜공동체교회", english: "Grace Community Church", kind: "organisation" },
    ],
  });

  it("rewrites a drifted spelling to the settled one", () => {
    const result = enforceTerminology("Pastor Ryu Jung-gil opened the service.", list);
    expect(result.text).toBe("Pastor Ryu Jeong-gil opened the service.");
    expect(result.fixes).toEqual([{ from: "Ryu Jung-gil", to: "Ryu Jeong-gil" }]);
  });

  it("leaves text that is already correct untouched, by identity", () => {
    const text = "Ryu Jeong-gil welcomed everyone.";
    const result = enforceTerminology(text, list);
    expect(result.text).toBe(text);
    expect(result.fixes).toEqual([]);
  });

  it("never rewrites a lowercase word that happens to look close", () => {
    const result = enforceTerminology("we all need grace community church today", list);
    expect(result.fixes).toEqual([]);
  });

  it("does not touch a different person with a similar name", () => {
    const result = enforceTerminology("Kim Jeong-gil sat at the back.", list);
    expect(result.text).toBe("Kim Jeong-gil sat at the back.");
  });

  it("catches a recogniser splitting a hyphenated name into two words", () => {
    const result = enforceTerminology("Pastor Ryu Jeong Gil closed in prayer.", list);
    expect(result.text).toBe("Pastor Ryu Jeong-gil closed in prayer.");
  });

  it("handles a multi-word organisation drifting one word", () => {
    const result = enforceTerminology("He founded Grace Comunity Church in 1994.", list);
    expect(result.text).toBe("He founded Grace Community Church in 1994.");
  });

  it("is a no-op with no settled forms", () => {
    const text = "Anything at all.";
    expect(enforceTerminology(text, []).text).toBe(text);
  });

  it("does not corrupt punctuation or sentence boundaries", () => {
    const result = enforceTerminology("“Ryu Jung-gil,” he said.", list);
    expect(result.text).toBe("“Ryu Jeong-gil,” he said.");
  });
});
