/** Lightweight Counter vocabulary profiles. They guide translation, not decisions. */

export const COUNTER_PROFILE_IDS = [
  "general",
  "immigration",
  "hospital",
  "hotel",
  "tourism",
  "public-office",
] as const;

export type CounterProfileId = (typeof COUNTER_PROFILE_IDS)[number];

export interface CounterProfile {
  id: CounterProfileId;
  label: string;
  description: string;
  setting: string;
  terminology: readonly string[];
}

export const COUNTER_PROFILES: readonly CounterProfile[] = [
  {
    id: "general",
    label: "일반",
    description: "일반 안내와 민원",
    setting: "general service counter",
    terminology: [],
  },
  {
    id: "immigration",
    label: "출입국·비자",
    description: "체류, 여권, 등록과 신청",
    setting: "immigration and visa service counter",
    terminology: [
      "체류기간",
      "체류자격",
      "체류기간 연장",
      "체류자격 변경",
      "외국인등록",
      "외국인등록증",
      "체류지 변경",
      "근무처 변경",
      "사증",
      "예약",
      "출국",
      "출국기한",
      "수수료",
      "통합신청서",
      "여권",
      "신고",
      "허가",
      "신청",
      "증명서",
    ],
  },
  {
    id: "hospital",
    label: "병원",
    description: "접수, 진료와 검사 안내",
    setting: "hospital reception counter",
    terminology: ["접수", "진료", "검사", "예약", "처방전", "수납", "보험"],
  },
  {
    id: "hotel",
    label: "호텔·숙박",
    description: "예약, 체크인과 객실 안내",
    setting: "hotel and accommodation front desk",
    terminology: ["예약", "체크인", "체크아웃", "객실", "보증금", "조식", "여권"],
  },
  {
    id: "tourism",
    label: "관광·안내",
    description: "교통, 표와 길 안내",
    setting: "tourism information counter",
    terminology: ["매표", "승차권", "환승", "운영시간", "입장료", "예약", "길 안내"],
  },
  {
    id: "public-office",
    label: "행정기관",
    description: "신청, 신고와 증명서",
    setting: "public administration service counter",
    terminology: ["신청서", "신고", "증명서", "본인확인", "수수료", "접수번호", "처리기한"],
  },
];

export function findCounterProfile(id: string | undefined): CounterProfile {
  return COUNTER_PROFILES.find((profile) => profile.id === id) ?? COUNTER_PROFILES[0];
}

export function isCounterProfileId(value: string): value is CounterProfileId {
  return COUNTER_PROFILE_IDS.includes(value as CounterProfileId);
}
