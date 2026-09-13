/**
 * Chinese script awareness: Simplified vs Traditional.
 *
 * The registry keeps zh-CN and zh-TW as separate languages precisely because
 * a recogniser or a model can silently answer in the other script. An
 * interpreter reading 國 when the session is Simplified, or 国 when it is
 * Traditional, loses trust in the whole rail even though every word is right.
 *
 * Detection is done by a compact table (a few hundred pairs, ~2 KB) of
 * high-frequency characters whose glyphs differ between the two scripts. It is deliberately NOT a conversion
 * table: converting text is a big-dictionary problem (one Simplified character
 * often maps to several Traditional ones — 发 → 發/髮), and getting it wrong
 * on a live console is worse than flagging. We only ever *classify*.
 *
 * Characters that are shared by both scripts (人, 我, 你, 好 …) carry no
 * signal and are ignored. Characters that exist in both scripts with
 * different meanings (于/於, 里/裡, 干/幹, 面/麵, 台/臺, 云/雲, 谷/穀) are
 * deliberately left out of the table so they never produce a false vote.
 */

export type ChineseScript = "simplified" | "traditional" | "mixed" | "neutral";

/**
 * Pairs of (simplified, traditional) glyphs, as one flat string. Each pair is
 * a distinct code point on both sides — `chinese.test.ts` asserts this so a
 * typo in the table cannot silently flip a vote.
 */
const PAIRS =
  "国國这這说說时時会會后後门門长長发發们們为為来來对對个個从從电電学學见見还還过過开開关關车車东東头頭点點经經业業动動问問间間无無儿兒应應样樣现現实實让讓与與两兩书書万萬边邊气氣认認义義军軍马馬鸟鳥鱼魚龙龍龟龜岁歲处處声聲听聽觉覺单單医醫药藥体體权權农農号號网網论論该該请請谢謝语語话話词詞读讀写寫译譯华華汉漢术術师師队隊战戰报報复復备備优優亿億币幣卖賣买買员員园園圆圓图圖团團场場块塊坏壞妈媽孙孫宁寧广廣庆慶张張当當录錄总總态態爱愛惊驚户戶执執护護择擇数數显顯机機杂雜极極条條标標树樹检檢欢歡汇匯没沒泽澤测測济濟灭滅灯燈热熱尔爾页頁顺順颜顏风風飞飛饭飯饮飲馆館驻駐验驗鲁魯麦麥齐齊齿齒龄齡计計讨討训訓设設访訪证證评評识識诉訴试試诗詩诚誠谁誰调調谈談贝貝负負贡貢财財责責贤賢败敗货貨质質贫貧购購费費资資赛賽赵趙转轉轻輕载載较較辅輔辞辭达達迁遷运運进進远遠违違连連迟遲选選递遞逻邏遗遺邮郵邻鄰郑鄭释釋钟鐘钱錢铁鐵银銀错錯锁鎖镇鎮闭閉闲閒闻聞阅閱阳陽阴陰际際陆陸陈陳险險随隨隐隱难難韩韓项項须須顾顧预預领領频頻题題额額类類粮糧紧緊纪紀约約级級纯純纳納纸紙纷紛线線练練组組细細织織终終结結给給络絡绝絕统統继繼绩績续續维維综綜绿綠罗羅习習乡鄉丽麗举舉乐樂乱亂争爭亲親亚亞产產仅僅众眾伟偉传傳伤傷价價伞傘侧側侨僑债債倾傾偿償储儲兰蘭兴興养養兽獸击擊刘劉则則刚剛创創剧劇劳勞势勢协協卫衛厂廠厅廳历歷压壓厌厭县縣参參双雙变變吗嗎吨噸启啟吴吳响響团團围圍圣聖坚堅坛壇壮壯壳殼够夠夹夾夺奪奋奮奖獎妇婦娱娛婴嬰宝寶宪憲审審宽寬宾賓寿壽将將专專导導尘塵尝嘗层層属屬岛島岭嶺帅帥带帶帮幫庄莊库庫庙廟废廢异異弃棄弯彎强強归歸彻徹径徑忆憶怀懷恶惡恳懇惯慣愿願懒懶戏戲扩擴扫掃扬揚抚撫担擔挤擠挥揮损損换換据據摆擺摄攝敌敵断斷旧舊晓曉杀殺构構枪槍栏欄楼樓欧歐毁毀汤湯沟溝泪淚泼潑洁潔浅淺浓濃涛濤润潤涨漲渐漸湾灣满滿滚滾灵靈灾災炼煉烂爛焕煥牵牽犹猶狱獄独獨猎獵献獻环環玛瑪画畫疗療盐鹽监監盖蓋盘盤矿礦码碼础礎确確礼禮祸禍禅禪离離种種积積称稱稳穩穷窮窃竊竞競笔筆筑築简簡签簽罚罰罢罷联聯职職聪聰肃肅胁脅脑腦脸臉舰艦艺藝节節芦蘆苏蘇荐薦荣榮获獲萨薩营營萧蕭虑慮虽雖虫蟲蚀蝕蜡蠟补補袄襖装裝观觀规規视視订訂议議讯訊记記讲講许許询詢详詳误誤诸諸课課谱譜贯貫贵貴贺賀赋賦赶趕趋趨跃躍践踐轨軌轮輪软軟辆輛辈輩辉輝钢鋼铜銅锋鋒闪閃阵陣阶階雾霧顿頓饰飾饱飽驱驅驶駛骂罵骗騙鲜鮮鸡雞鸣鳴鸭鴨鹅鵝黄黃几幾么麼决決况況净淨凤鳳办辦务務厉厲";

const SIMPLIFIED = new Set<string>();
const TRADITIONAL = new Set<string>();
{
  const chars = [...PAIRS];
  for (let i = 0; i + 1 < chars.length; i += 2) {
    SIMPLIFIED.add(chars[i]);
    TRADITIONAL.add(chars[i + 1]);
  }
}

/** The distinguishing-character sets, exported for the table-consistency test. */
export const CHINESE_SCRIPT_TABLE = { simplified: SIMPLIFIED, traditional: TRADITIONAL } as const;

/**
 * Classify text by counting distinguishing characters on each side.
 *
 * `mixed` is only declared when the minority script is a real presence
 * (≥ 20% of the votes) — one stray 國 in a Simplified paragraph is recogniser
 * noise, not a script change, and flagging it would train the interpreter to
 * ignore the flag.
 */
export function detectChineseScript(text: string): {
  script: ChineseScript;
  simplified: number;
  traditional: number;
} {
  let simplified = 0;
  let traditional = 0;
  for (const ch of text) {
    if (SIMPLIFIED.has(ch)) simplified += 1;
    else if (TRADITIONAL.has(ch)) traditional += 1;
  }
  const total = simplified + traditional;
  if (total === 0) return { script: "neutral", simplified, traditional };
  const minority = Math.min(simplified, traditional);
  if (minority > 0 && minority / total >= 0.2) return { script: "mixed", simplified, traditional };
  return {
    script: simplified >= traditional ? "simplified" : "traditional",
    simplified,
    traditional,
  };
}

/**
 * True when the text is written in the script its language tag expects.
 *
 * Non-Chinese tags are always consistent (there is nothing to check), and so
 * is neutral text — shared characters cannot be in the wrong script. Mixed
 * text is NOT consistent: it is exactly the symptom this check exists for.
 */
export function matchesChineseScript(text: string, languageTag: string): boolean {
  const expected = expectedScript(languageTag);
  if (!expected) return true;
  const { script } = detectChineseScript(text);
  if (script === "neutral") return true;
  return script === expected;
}

function expectedScript(languageTag: string): "simplified" | "traditional" | null {
  const key = languageTag.trim().toLowerCase().replace(/_/g, "-");
  if (!key.startsWith("zh") && !key.startsWith("cmn")) return null;
  if (/hant|-tw|-hk|-mo/.test(key)) return "traditional";
  return "simplified";
}

/** Han ideographs, kana, and the CJK punctuation that binds to them. */
const CJK_LETTER = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}";
const CJK_PUNCT = "。，！？、；：「」『』（）《》〈〉…—～";
const HAN = /\p{Script=Han}/u;
const CJK_OR_PUNCT_START = new RegExp(`^[${CJK_LETTER}${CJK_PUNCT}]`, "u");

/**
 * Normalise punctuation to the full-width forms Chinese readers expect and
 * close up the spaces a recogniser sprinkles between characters.
 *
 * Only marks adjacent to a CJK character are converted, so "3.5", "15:30",
 * "E-7" and a URL keep their ASCII punctuation: a full-width comma inside a
 * number would corrupt the value, and values must survive untouched.
 */
export function normaliseChinesePunctuation(text: string): string {
  let out = text;
  // Spaces between two CJK characters, or between a CJK character and CJK
  // punctuation, are recogniser artefacts. Latin/digit runs keep their spaces.
  out = out.replace(new RegExp(`([${CJK_LETTER}${CJK_PUNCT}])[ \\t]+(?=[${CJK_LETTER}${CJK_PUNCT}])`, "gu"), "$1");
  // Half-width marks following a CJK character become full-width. A trailing
  // space after the mark is absorbed only when CJK text follows.
  out = out.replace(new RegExp(`([${CJK_LETTER}])\\s*,\\s*`, "gu"), (m, ch: string, offset: number, whole: string) =>
    ch + "，" + trailingSpace(whole, offset + m.length));
  out = out.replace(new RegExp(`([${CJK_LETTER}])\\s*\\?\\s*`, "gu"), (m, ch: string, offset: number, whole: string) =>
    ch + "？" + trailingSpace(whole, offset + m.length));
  out = out.replace(new RegExp(`([${CJK_LETTER}])\\s*!\\s*`, "gu"), (m, ch: string, offset: number, whole: string) =>
    ch + "！" + trailingSpace(whole, offset + m.length));
  // A full stop is only a sentence end when nothing Latin/digit follows it —
  // "版本3.5" must keep its decimal point.
  out = out.replace(new RegExp(`([${CJK_LETTER}])\\s*\\.(?![A-Za-z0-9])\\s*`, "gu"), (m, ch: string, offset: number, whole: string) =>
    ch + "。" + trailingSpace(whole, offset + m.length));
  return out;
}

/** Keep one space after a converted mark only when Latin text follows. */
function trailingSpace(whole: string, at: number): string {
  const rest = whole.slice(at);
  if (!rest) return "";
  if (CJK_OR_PUNCT_START.test(rest)) return "";
  return " ";
}

/** Whether the text is mostly Han characters (by letters and digits, ignoring punctuation). */
export function isMostlyHan(text: string): boolean {
  let han = 0;
  let total = 0;
  for (const ch of text) {
    if (!/[\p{L}\p{N}]/u.test(ch)) continue;
    total += 1;
    if (HAN.test(ch)) han += 1;
  }
  return total > 0 && han / total > 0.5;
}
