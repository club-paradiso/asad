/**
 * Deterministic prep brief.
 *
 * Used whenever no interpretation model is configured, and as the fallback
 * when one fails. It cannot invent insight, so it does the honest thing: it
 * normalises what the interpreter typed, resolves the Scripture, romanises the
 * names, pulls the relevant terminology out of the lexicon, and flags the
 * structural difficulties that are true of the genre regardless of content.
 *
 * That is a genuinely useful sheet to walk into a service holding.
 */
import type { z } from "zod";
import type { prepRequestSchema } from "@/lib/schema";
import type { PrepBrief } from "@/types";
import { parseEnglishReference, detectScriptureReferences } from "../scripture/detect";
import { matchGlossary } from "../glossary/matcher";
import { detectCultural } from "../cultural/detect";
import { romaniseName } from "@/lib/romanise";

type PrepInput = z.infer<typeof prepRequestSchema>;

const SERMON_DIFFICULTIES = [
  "Korean holds the predicate to the end — lead with a topic frame ('What I want to say is…') so you can start speaking.",
  "Scripture references arrive as 책 N장 N절. Say the lead-in first, then the reference on its own.",
  "Technical theology (칭의, 성화, 대속) must stay technical; relational language (은혜 많이 받으세요) should go dynamic.",
  "Congregation prompts (아멘?, 그렇죠?) are addressed to the room. Decide in advance whether you will render or drop them.",
  "Sermon repetition is usually deliberate. Preserve a refrain even when it feels redundant in English.",
];

const GENERAL_DIFFICULTIES = [
  "Korean holds the predicate to the end — lead with a topic frame so you can start speaking.",
  "Numbers, dates and amounts are the highest-risk items. Ask for a repeat rather than guessing.",
  "우리 is collective — 'our team', not 'my team'.",
  "Honorific level rarely maps to English grammar. Carry the respect, not the structure.",
];

const SERMON_PHRASES: Array<{ korean: string; english: string }> = [
  { korean: "우리가 오늘 함께 살펴볼 말씀은…", english: "Today we're going to look at…" },
  { korean: "제가 오늘 여러분과 나누고 싶은 것은…", english: "Today, I'd like to talk with you about…" },
  { korean: "제가 다시 한번 말씀드리고 싶은 것은…", english: "Let me emphasise this again:" },
  { korean: "함께 기도하시겠습니다.", english: "Let's pray together." },
  { korean: "은혜 많이 받으세요.", english: "I hope you're richly blessed." },
  { korean: "아멘 하시겠습니다.", english: "Can I get an amen?" },
  { korean: "말씀을 봉독하겠습니다.", english: "Let's read the passage together." },
];

const GENERAL_PHRASES: Array<{ korean: string; english: string }> = [
  { korean: "제가 먼저 말씀드리고 싶은 것은…", english: "The first thing I want to say is…" },
  { korean: "결론적으로 말씀드리면…", english: "To sum up…" },
  { korean: "질문 있으시면 말씀해 주세요.", english: "Please stop me if you have questions." },
  { korean: "다음 장표를 봐 주시기 바랍니다.", english: "If you'll look at the next slide." },
];

export function localPrepBrief(
  input: PrepInput,
  options: { localOnly?: boolean } = {},
): PrepBrief {
  const corpus = [input.title, input.notes, input.outline].filter(Boolean).join("\n");
  const sermon = input.mode === "sermon";

  // Scripture: the typed main passage plus anything found in the outline.
  const scripture = [
    ...(input.scripture ? [parseEnglishReference(input.scripture)].filter(Boolean) : []),
    ...detectScriptureReferences(corpus).map(({ index: _index, ...ref }) => ref),
  ].filter((ref): ref is NonNullable<typeof ref> => ref !== null);

  const seenRefs = new Set<string>();
  const uniqueScripture = scripture.filter((ref) => {
    if (seenRefs.has(ref.display)) return false;
    seenRefs.add(ref.display);
    return true;
  });

  const keyTerms = matchGlossary(corpus, input.mode)
    .slice(0, 20)
    .map(({ index: _index, ...item }) => item);

  const properNouns = [
    ...(input.speaker
      ? [{
          korean: input.speaker,
          english: romaniseName(input.speaker),
          kind: "person" as const,
          note: "Speaker",
        }]
      : []),
    ...(input.organisation
      ? [{
          korean: input.organisation,
          english: input.organisation,
          kind: "organisation" as const,
        }]
      : []),
  ];

  const cultural = detectCultural(corpus, properNouns);

  const overviewParts = [
    input.title ? `"${input.title}"` : sermon ? "Sermon" : "Session",
    input.speaker ? `by ${romaniseName(input.speaker)}` : null,
    input.organisation ? `at ${input.organisation}` : null,
    uniqueScripture[0] ? `on ${uniqueScripture[0].display}` : null,
  ].filter(Boolean);

  const localExplanation = options.localOnly
    ? "This brief was assembled locally from your prep sheet, the built-in lexicon and Scripture normalisation. No prep content was sent to an AI provider."
    : "No interpretation model is configured, so this brief was assembled from your prep sheet, the built-in lexicon and Scripture normalisation. Add an LLM key for a content-aware briefing.";

  const overview =
    (overviewParts.length > 1
      ? `${overviewParts.join(" ")}. `
      : sermon
        ? "Sermon session. "
        : "General interpretation session. ") +
    localExplanation;

  return {
    overview,
    likelyStructure: sermon
      ? [
          "Greeting and welcome",
          "Scripture reading",
          "Introduction / hook — often a story or a question",
          "Main points, usually two or three, each with an illustration",
          "Application to the congregation",
          "Closing prayer and benediction",
        ]
      : [
          "Greeting and framing",
          "Main content, section by section",
          "Discussion or questions",
          "Summary and next steps",
        ],
    keyTerms,
    scripture: uniqueScripture,
    properNouns,
    difficultPoints: [
      ...(sermon ? SERMON_DIFFICULTIES : GENERAL_DIFFICULTIES),
      ...cultural.map((c) => `${c.korean}: ${c.note}`),
    ].slice(0, 12),
    anticipatedPhrases: sermon ? SERMON_PHRASES : GENERAL_PHRASES,
    pronunciation: properNouns
      .filter((p) => p.kind === "person")
      .map((p) => ({ korean: p.korean, english: p.english })),
  };
}
