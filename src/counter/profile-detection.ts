import {
  isSensitiveCounterProfile,
  type CounterProfileId,
} from "./profiles";

interface ProfileDetectionInput {
  text: string;
  deskLabel?: string;
  recent?: readonly { text: string }[];
  currentProfileId?: CounterProfileId;
}

/**
 * Counter context is inferred locally before an utterance reaches a model.
 * This keeps setup friction low and, importantly, lets sensitive refugee and
 * judicial turns enter the strict provider path without first sending their
 * contents to a general-purpose classifier.
 */
const PROFILE_KEYWORDS: Readonly<Record<Exclude<CounterProfileId, "general">, readonly string[]>> = {
  immigration: [
    "출입국",
    "비자",
    "체류기간",
    "체류자격",
    "외국인등록",
    "사증",
    "immigration",
    "visa",
    "residence permit",
    "alien registration",
    "入管",
    "签证",
    "簽證",
    "비자 연장",
  ],
  refugee: [
    "난민",
    "망명",
    "박해",
    "refugee",
    "asylum",
    "persecution",
    "难民",
    "難民",
    "亡命",
    "庇護",
    "tị nạn",
    "бежен",
    "убежищ",
    "refugi",
    "asilo",
    "flücht",
    "mülteci",
    "لاجئ",
    "لجوء",
  ],
  judicial: [
    "사법",
    "사건번호",
    "범죄",
    "수사",
    "입건",
    "고발",
    "범칙금",
    "강제퇴거",
    "criminal",
    "police investigation",
    "case number",
    "prosecution",
    "deportation",
    "conviction",
    "arrest warrant",
    "犯罪",
    "捜査",
    "刑事",
    "уголов",
    "депортац",
    "delito",
    "expulsión",
  ],
  hospital: [
    "병원",
    "진료",
    "처방전",
    "건강보험",
    "의사 선생님",
    "hospital",
    "clinic",
    "medical appointment",
    "prescription",
    "health insurance",
    "医院",
    "醫院",
    "病院",
  ],
  hotel: [
    "호텔",
    "숙박",
    "체크인",
    "체크아웃",
    "객실",
    "hotel",
    "accommodation",
    "check-in",
    "check-out",
    "room reservation",
    "旅館",
    "酒店",
  ],
  tourism: [
    "관광",
    "관광안내",
    "매표",
    "승차권",
    "환승",
    "입장료",
    "tourist information",
    "tourism",
    "admission ticket",
    "train ticket",
    "bus ticket",
    "観光",
    "旅游",
    "旅遊",
  ],
  "public-office": [
    "행정기관",
    "주민센터",
    "민원실",
    "증명서 발급",
    "본인확인",
    "접수번호",
    "public office",
    "government office",
    "civil service",
    "official certificate",
    "行政",
    "政务",
    "政務",
  ],
};

const PROFILE_ORDER = Object.keys(PROFILE_KEYWORDS) as Exclude<
  CounterProfileId,
  "general"
>[];

const normalise = (value: string | undefined): string =>
  (value ?? "").normalize("NFKC").toLocaleLowerCase("en-US");

const score = (value: string, keywords: readonly string[], weight: number): number =>
  keywords.reduce(
    (total, keyword) => total + (value.includes(normalise(keyword)) ? weight : 0),
    0,
  );

export function detectCounterProfile({
  text,
  deskLabel,
  recent = [],
  currentProfileId = "general",
}: ProfileDetectionInput): CounterProfileId {
  const utterance = normalise(text);
  const desk = normalise(deskLabel);
  const history = normalise(recent.map((item) => item.text).join("\n"));

  const scores = PROFILE_ORDER.map((profileId) => ({
    profileId,
    score:
      score(utterance, PROFILE_KEYWORDS[profileId], 4) +
      score(desk, PROFILE_KEYWORDS[profileId], 6) +
      score(history, PROFILE_KEYWORDS[profileId], 1),
  })).sort((a, b) => b.score - a.score);

  const sensitiveMatch = scores.find(
    (candidate) => candidate.score > 0 && isSensitiveCounterProfile(candidate.profileId),
  );
  if (sensitiveMatch) return sensitiveMatch.profileId;

  // Once a session has entered a sensitive path, ambiguous later turns such as
  // "네" must remain there for the rest of that conversation.
  if (isSensitiveCounterProfile(currentProfileId)) return currentProfileId;

  const best = scores[0];
  if (best && best.score > 0) return best.profileId;
  return currentProfileId;
}
