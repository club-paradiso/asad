/**
 * What kind of thing a browser audio-input label most likely names.
 *
 * The browser gives ASAD a label and an opaque id, nothing more. For a
 * volunteer setting up a booth the label is the only clue to the question
 * that actually matters — "is this the console feed, or is the laptop
 * listening to the room?" — so the answer is read from it here, once, and
 * said in plain Korean on the launcher, the preflight and the diagnostics
 * page. A heuristic, labelled as one: the level meter remains the proof.
 */
export type AudioInputKind =
  /** The laptop's own microphone. Hears the room, not the console. */
  | "builtin-mic"
  /** The 3.5 mm headset jack. Could be a console feed or a headset mic. */
  | "external-jack"
  /** A USB audio adapter or interface. The booth's intended path. */
  | "usb"
  /** Bluetooth. Latency and a narrow voice codec; never for a booth. */
  | "bluetooth"
  /** Software loopback or a conferencing driver. Only right if a program feed already reaches it. */
  | "virtual"
  /** A phone's microphone over Continuity or similar. Acoustic, not a feed. */
  | "phone"
  | "unknown";

export type BoothSuitability = "good" | "caution" | "bad";

export interface AudioInputDescription {
  kind: AudioInputKind;
  suitability: BoothSuitability;
  /** One plain sentence for a volunteer. */
  note: string;
}

const RULES: Array<{ kind: AudioInputKind; test: RegExp }> = [
  // Word-bounded, because "microphone", "headphone" and "earphone" all contain
  // "phone" and none of them is a telephone.
  { kind: "phone", test: /\biphone\b|\bipad\b|galaxy|\bz ?fold|\bfold\d|android|\bphone\b|continuity|휴대폰|아이폰|갤럭시/i },
  { kind: "bluetooth", test: /bluetooth|airpods|buds|블루투스|에어팟|버즈|hands-?free/i },
  { kind: "virtual", test: /zoomaudiodevice|blackhole|loopback|soundflower|vb-?cable|virtual|aggregate|다중 출력|teams audio|cable output/i },
  { kind: "usb", test: /usb|\([0-9a-f]{4}:[0-9a-f]{4}\)|audio interface|scarlett|focusrite|behringer|umc|yamaha ag|zoom h\d|ur\d{2}|audiobox|motu|rode|rødecaster|ssl 2/i },
  { kind: "external-jack", test: /external microphone|외장 마이크|외부 마이크|headset|헤드셋|line in|라인 입력/i },
  { kind: "builtin-mic", test: /built-?in|internal microphone|내장|macbook|맥북|imac|mac mini|mac studio|realtek|conexant|array microphone|마이크 배열/i },
];

const NOTE: Record<AudioInputKind, AudioInputDescription> = {
  "builtin-mic": {
    kind: "builtin-mic",
    suitability: "bad",
    note: "노트북 자체 마이크입니다. 콘솔에서 오는 소리가 아니라 부스 안의 소리를 듣습니다.",
  },
  "external-jack": {
    kind: "external-jack",
    suitability: "caution",
    note: "3.5mm 단자로 들어오는 입력입니다. 콘솔 출력이 실제로 연결됐는지 아래 레벨로 확인하세요.",
  },
  usb: {
    kind: "usb",
    suitability: "good",
    note: "USB 오디오 장치입니다. 콘솔 피드를 받기에 알맞은 경로입니다.",
  },
  bluetooth: {
    kind: "bluetooth",
    suitability: "bad",
    note: "블루투스 입력입니다. 지연이 크고 음질이 통화 수준이라 통역 부스에는 맞지 않습니다.",
  },
  virtual: {
    kind: "virtual",
    suitability: "caution",
    note: "소프트웨어 가상 입력입니다. 다른 프로그램이 여기에 소리를 보내고 있을 때만 쓸 수 있습니다.",
  },
  phone: {
    kind: "phone",
    suitability: "bad",
    note: "휴대폰 마이크입니다. 콘솔 피드가 아니라 공기 중의 소리를 듣습니다.",
  },
  unknown: {
    kind: "unknown",
    suitability: "caution",
    note: "어떤 장치인지 이름만으로는 알 수 없습니다. 아래 레벨로 소리가 실제로 들어오는지 확인하세요.",
  },
};

export function describeAudioInput(label: string | undefined | null): AudioInputDescription {
  const text = (label ?? "").trim();
  if (!text) return NOTE.unknown;
  for (const rule of RULES) if (rule.test.test(text)) return NOTE[rule.kind];
  return NOTE.unknown;
}
