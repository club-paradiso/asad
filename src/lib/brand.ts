/**
 * Brand constants.
 *
 * The name is a sentence, not a noun, and that is the product: "아무튼 서로
 * 알아들었으면 된 거 아닌가요?" — if we understood each other anyway, isn't
 * that the point? Everything downstream follows from taking that literally.
 * The service is not selling correct language. It is selling the shrug at the
 * end of a conversation that worked.
 *
 * `nameLead` / `nameTail` are the wordmark's two lines. They live here rather
 * than in the component because the split is a brand decision — where the
 * sentence stops hedging and starts shrugging — not a layout one.
 */
export const BRAND = {
  name: "아무튼서로알아들었으면된거아닌가요",
  /** Wordmark line 1 — the hedge. Quiet, narrow. */
  nameLead: "아무튼서로알아들었으면",
  /** Wordmark line 2 — the shrug. Loud, wide, followed by the mark. */
  nameTail: "된거아닌가요",
  /** Full Korean signature; do not collapse it into an acronym-style nickname. */
  secondaryMark: "아무튼 서로 알아들었으면 된 거 아닌가요?",
  /** Latin short form, for technical and non-Korean contexts. */
  shortName: "ASAD",
  /**
   * The chosen line, of the four tested. "통했으면 된 거 아닌가요" repeats the
   * name; "You got the point" is not the voice in Korean; "Communication
   * successful" is the joke stated instead of made. This one is the shrug
   * itself — it concedes the error and dismisses it in the same breath, which
   * is the only one of the four that sounds like a person.
   */
  tagline: "정확한지는 모르겠고, 아무튼 알아들었어요.",
  /** English support line. Used under the Latin lockup, never on its own. */
  taglineEn: "Communication successful. Accuracy unconfirmed.",
  liveTagline: "일단 말해보세요. 어떻게든 알아듣게 해보겠습니다.",
  descriptor: "AI 통역 보조",
  englishDescriptor: "AI-assisted interpretation",
  description:
    "정확한지는 모르겠고, 아무튼 알아들었어요. 라이브 통역과 현장 응대를 위한 AI 통역 보조 서비스.",
  liveDescription:
    "일단 말해보세요. 어떻게든 알아듣게 해보겠습니다. 설교·강연·회의를 위한 ASAD 라이브 통역.",
  /**
   * The identity colour, for anywhere a platform asks for one value: a
   * manifest, a store listing, an embed host's `primaryColor`. It is the
   * correction red, not the button colour — see the brand block in
   * globals.css for why those are deliberately different.
   */
  primaryColor: "#c81e1e",
} as const;

export const BRAND_TITLE = BRAND.name;
