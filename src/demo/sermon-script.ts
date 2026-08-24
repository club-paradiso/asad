/**
 * The scripted demo sermon.
 *
 * This is not a screenshot with a fade-in. The beats below are fed through the
 * *real* pipeline — the real stabiliser, the real chunk store with real
 * temporal locking, the real rolling context — so demo mode exercises the same
 * code path as a live session, minus the network.
 *
 * Coverage is deliberate. Between them these beats hit every category in the
 * evaluation fixture set: plain declaratives, delayed predicates, a very long
 * sentence, an unfinished one, a recogniser self-correction, Scripture,
 * theological vocabulary, an idiom, a cultural reference, name wordplay, a
 * proper noun, prayer, testimony, rhetorical repetition and humour.
 */
import type { DemoScript } from "./types";
import { chunk, note, person, ref, term } from "./types";

export const SERMON_DEMO: DemoScript = {
  id: "demo-1peter-2-9",
  title: "택하신 족속 — Our Identity in Christ",
  speaker: "류정길",
  speakerRomanised: "Ryu Jeong-gil",
  organisation: "새길교회",
  scripture: "1 Peter 2:9",
  mode: "sermon",
  beats: [
    {
      id: "b1",
      demonstrates: "Ordinary declarative speech",
      korean: "여러분, 반갑습니다. 오늘 이 자리에 함께해 주셔서 감사합니다.",
      paceMs: 260,
      holdMs: 700,
      output: {
        safeChunks: [chunk("Good morning, everyone."), chunk("Thank you for being here today.")],
        confidence: "high",
        topic: "Greeting",
      },
    },
    {
      id: "b2",
      demonstrates: "Proper noun · recogniser self-correction",
      korean: "저는 오늘 말씀을 전하게 된 류정길 목사입니다.",
      // The recogniser hears 유정길 first and repairs it — exactly what happens live.
      partials: [
        "저는 오늘",
        "저는 오늘 말씀을",
        "저는 오늘 말씀을 전하게 된 유정길",
        "저는 오늘 말씀을 전하게 된 유정길 목사입니다",
      ],
      paceMs: 300,
      holdMs: 800,
      output: {
        safeChunks: [chunk("I'm Pastor Ryu Jeong-gil,"), chunk("and I'll be bringing the message today.")],
        entities: [person("류정길", "Ryu Jeong-gil", "Speaker — recogniser first heard 유정길")],
        glossary: [term("목사님", "the pastor")],
        confidence: "high",
      },
    },
    {
      id: "b3",
      demonstrates: "ACCEPTANCE — Scripture reference detection",
      korean: "우리가 오늘 함께 살펴볼 말씀은 베드로전서 2장 9절입니다.",
      paceMs: 280,
      holdMs: 900,
      output: {
        safeChunks: [chunk("Today we're going to look at..."), chunk("1 Peter 2:9.")],
        bibleReferences: [ref("1 Peter", 2, 9, "베드로전서 2장 9절")],
        glossary: [term("말씀", "the passage", "'오늘의 말씀' is 'today's text', not 'the Word'")],
        confidence: "high",
        topic: "1 Peter 2:9 — our identity",
      },
    },
    {
      id: "b4",
      demonstrates: "Delayed predicate · safe scaffold + anticipation",
      korean: "제가 오늘 여러분과 함께 나누고 싶은 것은 바로 우리의 정체성입니다.",
      partials: [
        "제가 오늘",
        "제가 오늘 여러분과 함께",
        "제가 오늘 여러분과 함께 나누고 싶은 것은",
        "제가 오늘 여러분과 함께 나누고 싶은 것은 바로",
        "제가 오늘 여러분과 함께 나누고 싶은 것은 바로 우리의 정체성입니다",
      ],
      paceMs: 340,
      holdMs: 900,
      output: {
        safeChunks: [chunk("Today, I'd like to talk with you about..."), chunk("who we actually are.")],
        anticipatedChunks: [chunk("our identity.", { confidence: "medium" })],
        confidence: "high",
      },
    },
    {
      id: "b5",
      demonstrates: "Theological terminology",
      korean: "우리는 하나님의 부르심을 받은 사람들입니다.",
      paceMs: 260,
      holdMs: 700,
      output: {
        safeChunks: [chunk("We are people God has called.")],
        glossary: [term("부르심", "calling", "'the call of God' also works"), term("하나님", "God")],
        confidence: "high",
      },
    },
    {
      id: "b6",
      demonstrates: "Very long sentence · chunked into breath groups",
      korean:
        "베드로 사도는 우리를 가리켜서 택하신 족속이요, 왕 같은 제사장들이요, 거룩한 나라요, 그의 소유가 된 백성이라고 말씀하고 있습니다.",
      paceMs: 300,
      holdMs: 1000,
      output: {
        safeChunks: [
          chunk("Peter calls us..."),
          chunk("a chosen people,"),
          chunk("a royal priesthood,"),
          chunk("a holy nation,"),
          chunk("God's special possession."),
        ],
        glossary: [
          term("택하신 족속", "a chosen people", "1 Peter 2:9"),
          term("왕 같은 제사장", "a royal priesthood", "1 Peter 2:9"),
          term("거룩한 나라", "a holy nation", "1 Peter 2:9"),
          term("그의 소유가 된 백성", "God's special possession", "1 Peter 2:9"),
        ],
        entities: [{ korean: "베드로", english: "Peter", kind: "person" }],
        confidence: "high",
      },
    },
    {
      id: "b7",
      demonstrates: "Intentional rhetorical repetition — preserved, not compressed",
      korean:
        "여러분은 택하신 족속입니다. 여러분은 왕 같은 제사장입니다. 여러분은 거룩한 나라입니다.",
      paceMs: 260,
      holdMs: 900,
      output: {
        safeChunks: [
          chunk("You are a chosen people."),
          chunk("You are a royal priesthood."),
          chunk("You are a holy nation."),
        ],
        confidence: "high",
        // The repetition is the rhetoric. Compressing it would flatten the sermon.
      },
    },
    {
      id: "b8",
      demonstrates: "Rhetorical padding — compressed",
      korean:
        "제가 여러분에게 다시 한번 꼭 말씀드리고 싶은 것은, 이 부르심이 우리의 노력으로 된 것이 아니라는 것입니다.",
      paceMs: 300,
      holdMs: 900,
      output: {
        safeChunks: [
          chunk("Let me emphasise this again:"),
          chunk("this calling didn't come from anything we did."),
        ],
        confidence: "high",
      },
    },
    {
      id: "b9",
      demonstrates: "Testimony · low-confidence number",
      korean: "제가 처음 이 교회에 왔을 때, 한 삼천... 아니, 삼백 명 정도가 모였습니다.",
      partials: [
        "제가 처음 이 교회에 왔을 때",
        "제가 처음 이 교회에 왔을 때 한 삼천",
        "제가 처음 이 교회에 왔을 때, 한 삼천... 아니, 삼백 명",
        "제가 처음 이 교회에 왔을 때, 한 삼천... 아니, 삼백 명 정도가 모였습니다",
      ],
      paceMs: 320,
      holdMs: 900,
      output: {
        safeChunks: [
          chunk("When I first came to this church,"),
          chunk("there were about three hundred of us.", {
            confidence: "low",
            note: "Speaker self-corrected 3,000 → 300",
          }),
        ],
        confidence: "medium",
      },
    },
    {
      id: "b10",
      demonstrates: "ACCEPTANCE — name wordplay adaptation",
      korean: "그래서 우리는 길을 잘 찾아야 됩니다. 제 이름에도 길이 있어요.",
      paceMs: 300,
      holdMs: 1100,
      output: {
        safeChunks: [
          chunk("So we need to find the right way."),
          chunk('And speaking of "the way," it\'s even in my name.', {
            adapted: true,
            note: "Wordplay adapted — not literal",
          }),
        ],
        culturalNotes: [
          note(
            "wordplay",
            "길",
            '"Gil" in Jeong-gil means "way" in Korean.',
            'And speaking of "the way," it\'s even in my name.',
          ),
        ],
        confidence: "high",
      },
    },
    {
      id: "b11",
      demonstrates: "Korean idiom",
      korean: "티끌 모아 태산이라고 하지 않습니까? 작은 순종이 쌓이는 겁니다.",
      paceMs: 280,
      holdMs: 800,
      output: {
        safeChunks: [
          chunk("You know the saying —"),
          chunk("little by little, it adds up.", { adapted: true, note: "Idiom, not literal" }),
          chunk("Small acts of obedience pile up."),
        ],
        culturalNotes: [
          note("idiom", "티끌 모아 태산", "Tiny specks make a mountain — small things accumulate", "Little by little, it adds up."),
        ],
        glossary: [term("순종", "obedience")],
        confidence: "high",
      },
    },
    {
      id: "b12",
      demonstrates: "Cultural reference",
      korean: "우리 교회는 새벽기도로 유명한 교회입니다.",
      paceMs: 260,
      holdMs: 700,
      output: {
        safeChunks: [chunk("Our church is known for early morning prayer.")],
        culturalNotes: [
          note("cultural", "새벽기도", "Daily dawn prayer meeting — a Korean church institution", "Early morning prayer."),
        ],
        glossary: [term("새벽기도", "early morning prayer")],
        confidence: "high",
      },
    },
    {
      id: "b13",
      demonstrates: "Humour · congregation interaction",
      korean: "사실 제가 어젯밤에 설교 준비하다가 그만 잠들었습니다. 아멘 하실 분?",
      paceMs: 300,
      holdMs: 900,
      output: {
        safeChunks: [
          chunk("I'll be honest —"),
          chunk("last night I fell asleep preparing this sermon."),
          chunk("Anyone want to say amen to that?", {
            confidence: "medium",
            note: "May not get a response from an English-speaking room",
          }),
        ],
        culturalNotes: [
          note("humour", "아멘 하실 분?", "Invites the room to answer — English congregations often stay silent"),
        ],
        confidence: "high",
      },
    },
    {
      id: "b14",
      demonstrates: "Unfinished sentence — scaffold only, no invention",
      korean: "그런데 우리가 이 놀라운 은혜를 받고도",
      paceMs: 340,
      holdMs: 1400,
      output: {
        safeChunks: [chunk("And yet, even after receiving this amazing grace...")],
        anticipatedChunks: [chunk("we so easily forget who we are.", { confidence: "low" })],
        glossary: [term("은혜", "grace", "In a greeting, prefer 'blessing'")],
        confidence: "medium",
      },
    },
    {
      id: "b15",
      demonstrates: "Prayer register",
      korean: "사랑의 하나님, 오늘 이 말씀을 통해 우리를 만나 주시옵소서.",
      paceMs: 280,
      holdMs: 900,
      output: {
        safeChunks: [chunk("God of love,"), chunk("meet us today through this word.")],
        confidence: "high",
      },
    },
    {
      id: "b16",
      demonstrates: "Dynamic equivalence — meaning over words",
      korean: "오늘 하루도 은혜 많이 받으세요.",
      paceMs: 260,
      holdMs: 1200,
      output: {
        safeChunks: [
          chunk("I hope you're richly blessed today.", {
            adapted: true,
            note: 'Not "receive much grace"',
          }),
        ],
        culturalNotes: [
          note("cultural", "은혜 많이 받으세요", "A blessing, not an instruction to receive grace", "I hope you're richly blessed today."),
        ],
        confidence: "high",
      },
    },
  ],
};

/** A short domain-neutral script, used to demo GENERAL mode. */
export const GENERAL_DEMO: DemoScript = {
  id: "demo-general-meeting",
  title: "3분기 실적 보고 — Quarterly Review",
  speaker: "김서연",
  speakerRomanised: "Kim Seo-yeon",
  organisation: "",
  scripture: "",
  mode: "general",
  beats: [
    {
      id: "g1",
      demonstrates: "Ordinary declarative speech",
      korean: "안녕하세요. 오늘 3분기 실적을 보고드리겠습니다.",
      paceMs: 260,
      holdMs: 700,
      output: {
        safeChunks: [chunk("Good afternoon."), chunk("I'll be presenting our third-quarter results.")],
        confidence: "high",
        topic: "Q3 results",
      },
    },
    {
      id: "g2",
      demonstrates: "Delayed predicate · anticipation",
      korean: "제가 먼저 말씀드리고 싶은 것은 매출이 전년 대비 십이 퍼센트 성장했다는 점입니다.",
      partials: [
        "제가 먼저 말씀드리고 싶은 것은",
        "제가 먼저 말씀드리고 싶은 것은 매출이",
        "제가 먼저 말씀드리고 싶은 것은 매출이 전년 대비",
        "제가 먼저 말씀드리고 싶은 것은 매출이 전년 대비 십이 퍼센트 성장했다는 점입니다",
      ],
      paceMs: 320,
      holdMs: 900,
      output: {
        safeChunks: [
          chunk("The first thing I want to highlight is..."),
          chunk("revenue grew twelve percent year on year."),
        ],
        anticipatedChunks: [chunk("our revenue figures.", { confidence: "medium" })],
        confidence: "high",
      },
    },
    {
      id: "g3",
      demonstrates: "Register — no theological assumptions applied",
      korean: "물론 아직 해결해야 할 과제가 남아 있습니다.",
      paceMs: 260,
      holdMs: 800,
      output: {
        safeChunks: [chunk("Of course, there are still challenges to work through.")],
        confidence: "high",
      },
    },
    {
      id: "g4",
      demonstrates: "Rhetorical padding — compressed",
      korean: "제가 다시 한번 강조하고 싶은 것은, 사실 인력 확보가 가장 시급하다는 것입니다.",
      paceMs: 300,
      holdMs: 1000,
      output: {
        safeChunks: [chunk("Let me stress this again:"), chunk("hiring is our most urgent problem.")],
        confidence: "high",
      },
    },
  ],
};

export const DEMO_SCRIPTS: Record<string, DemoScript> = {
  [SERMON_DEMO.id]: SERMON_DEMO,
  [GENERAL_DEMO.id]: GENERAL_DEMO,
};

export const demoScriptFor = (mode: "sermon" | "general"): DemoScript =>
  mode === "sermon" ? SERMON_DEMO : GENERAL_DEMO;
