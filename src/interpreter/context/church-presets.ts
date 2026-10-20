/**
 * Church gathering presets — refinements inside the worship context.
 *
 * The context resolver decides *worship*; a Sunday service, a sermon, a prayer
 * meeting, a Bible study and a retreat are all worship, but an interpreter
 * prepares differently for each. These presets let the system name the
 * gathering so the rail, the glossary and the prep sheet can tune themselves
 * to it.
 *
 * Detection is deliberately keyword-and-metadata based, never model-based: it
 * reads the same speech window the resolver already holds, plus the prep
 * sheet, so it costs nothing and is fully testable.
 */
import type { PrepSheet } from "@/types";

export type ChurchPreset =
  | "worship-service"
  | "sermon"
  | "prayer-meeting"
  | "bible-study"
  | "retreat";

export interface ChurchPresetInfo {
  id: ChurchPreset;
  ko: string;
  en: string;
  /**
   * Short guidance the console can show a volunteer interpreter for this
   * gathering. Register notes, not orders.
   */
  guidance: string;
  /** Keywords that vote for this preset in speech or prep metadata. */
  keywords: string[];
}

export const CHURCH_PRESETS: ChurchPresetInfo[] = [
  {
    id: "worship-service",
    ko: "예배",
    en: "Worship service",
    guidance:
      "주일·수요·금요 예배의 전체 흐름을 따릅니다. 찬양·기도·광고·설교·축도의 순서를 의식하고, 순서 전환 멘트는 짧게 처리합니다.",
    keywords: ["주일예배", "수요예배", "금요예배", "예배를", "찬양", "헌금", "축도", "성찬", "대표기도", "광고", "개회", "폐회", "예배당"],
  },
  {
    id: "sermon",
    ko: "설교",
    en: "Sermon",
    guidance:
      "본문 중심의 선포입니다. 본문 구절은 참조만 정확히, 해설은 설교자의 논리 구조(대지)를 살려 전달합니다.",
    keywords: ["설교", "본문", "설교자", "대지", "강해", "말씀을", "오늘의 말씀"],
  },
  {
    id: "prayer-meeting",
    ko: "기도회",
    en: "Prayer meeting",
    guidance:
      "기도 제목과 중보의 흐름이 중심입니다. 기도문은 2인칭 직접 호소로, 간결한 문장으로 옮깁니다.",
    keywords: ["기도회", "기도제목", "중보", "통성", "새벽기도", "철야", "기도합시다", "합심"],
  },
  {
    id: "bible-study",
    ko: "성경공부",
    en: "Bible study",
    guidance:
      "질문과 나눔이 오가는 자리입니다. 질문은 질문으로 남기고, 원어·배경 설명은 용어를 풀지 말고 그대로 둡니다.",
    keywords: ["성경공부", "원어", "해석", "나눔", "소그룹", "질문", "발제", "교재"],
  },
  {
    id: "retreat",
    ko: "수련회",
    en: "Retreat",
    guidance:
      "집회 분위기가 강합니다. 호응 유도(아멘·할렐루야)는 방의 반응으로, 길어지는 반복은 요지만 잡습니다.",
    keywords: ["수련회", "부흥회", "집회", "캠프", "특강", "수련"],
  },
];

export const CHURCH_PRESET_LABEL_KO: Record<ChurchPreset, string> = {
  "worship-service": "예배",
  sermon: "설교",
  "prayer-meeting": "기도회",
  "bible-study": "성경공부",
  retreat: "수련회",
};

export const isChurchPreset = (value: unknown): value is ChurchPreset =>
  typeof value === "string" &&
  (CHURCH_PRESETS as ChurchPresetInfo[]).some((preset) => preset.id === value);

/** How many distinct keywords must hit before a preset is declared. */
export const CHURCH_PRESET_MIN_KEYWORDS = 2;

function prepCorpus(prep: PrepSheet | undefined): string {
  if (!prep) return "";
  return [prep.organisation, prep.title, prep.notes, prep.outline]
    .filter((value): value is string => !!value?.trim())
    .join("\n");
}

/**
 * Name the gathering inside a worship context, or null when the evidence is
 * too thin to specialise. Pure and synchronous, like the resolver itself.
 *
 * Prep metadata votes alongside speech: a venue or title that names the
 * gathering ("금요 기도회") counts before anyone speaks. A keyword found in
 * the prep sheet counts double — it is a deliberate choice, not an incidental
 * mention — so a single named gathering in the title is enough to declare it.
 */
export function detectChurchPreset(
  text: string,
  prep?: PrepSheet,
): ChurchPreset | null {
  const speech = text.trim();
  const metadata = prepCorpus(prep);
  if (!speech && !metadata) return null;

  let best: { preset: ChurchPresetInfo; hits: number } | null = null;
  for (const preset of CHURCH_PRESETS) {
    const hits = preset.keywords.reduce((total, keyword) => {
      if (speech.includes(keyword)) total += 1;
      if (metadata.includes(keyword)) total += 2;
      return total;
    }, 0);
    if (hits >= CHURCH_PRESET_MIN_KEYWORDS && (!best || hits > best.hits)) {
      best = { preset, hits };
    }
  }
  return best?.preset.id ?? null;
}
