/**
 * Volunteer-maintained Korean → English church glossary for ASAD sermon mode.
 *
 * Generated from the supplied "기독교 영단어 500개" workbook. The workbook
 * has 500 numbered rows and 447 unique Korean headwords. Duplicate headwords
 * are merged; alternate English renderings are retained as alternatives.
 *
 * This is a coverage layer. Prep/session decisions and ASAD's hand-curated
 * theological lexicon remain higher priority at match time.
 */
import type { GlossaryItem } from "@/types";

const RAW_COMMUNITY_GLOSSARY = `하나님	God	
주님	Lord	
예수님	Jesus	
예수 그리스도	Jesus Christ	
그리스도	Christ	
메시아	Messiah	
구세주	Savior	
구속자	Redeemer	
왕	King	
왕 중의 왕	King of Kings	
주님의 주	Lord of Lords	
전능하신 하나님	Almighty God	
살아계신 하나님	The Living God	
창조주	Creator	
아버지 하나님	God the Father	
성부	God the Father	
성자	God the Son	
성령	Holy Spirit	
삼위일체	Trinity	
하나님의 아들	Son of God	
인자	Son of Man	
보혜사	Helper (Advocate)	
주권	Sovereignty	
주권자	Sovereign Lord	
영광	Glory	
영광스러운	Glorious	
거룩	Holiness	
거룩한	Holy	
영원하신	Eternal	
신실하신	Faithful	
의로우신	Righteous	
전지하신	Omniscient	
전능하신	Omnipotent	
무소부재하신	Omnipresent	
선하신	Good	
사랑이신 하나님	God is love	
공의	Justice	
공의로우신	Just	
긍휼	Mercy	
자비	Compassion	Kindness
은혜	Grace	
인내	Patience	Perseverance
오래 참으심	Longsuffering	
진리	Truth	
빛	Light	
생명	Life	
평강	Peace	
기쁨	Joy	
소망	Hope	
사랑	Love	
구원	Salvation	
구원받다	Be saved	
복음	Gospel	
복음을 전하다	Share the Gospel	Preach the Gospel
믿음	Faith	
믿다	Believe	
신뢰	Trust	
신뢰하다	Trust in	
은혜로	By grace	
죄	Sin	
죄인	Sinner	
죄를 짓다	Commit sin	
죄를 고백하다	Confess one's sins	
회개	Repentance	
회개하다	Repent	
용서	Forgiveness	
용서하다	Forgive	
용서받다	Be forgiven	
속죄	Atonement	
대속	Redemption	
구속	Redemption	
구속하다	Redeem	
십자가	The Cross	
십자가에 못 박히다	Be crucified	
십자가를 지다	Take up one's cross	
부활	Resurrection	
부활하시다	Rise again	
죽음	Death	
영생	Eternal life	
영원한 생명	Everlasting life	
심판	Judgment	
심판하다	Judge	
의	Righteousness	
의롭다	Righteous	
칭의	Justification	
성화	Sanctification	
영화(구원의 완성)	Glorification	
거듭남	New birth	Regeneration
중생	Regeneration	
새로운 피조물	New creation	
언약	Covenant	
새 언약	New Covenant	
약속	Promise	
믿음으로 의롭게 되다	Be justified by faith	
하나님의 어린양	Lamb of God	
보혈	The blood of Christ	
속량	Ransom	Redemption
화목	Reconciliation	
성경	Bible	
하나님의 말씀	Word of God	
말씀	Scripture	The Word
본문	Scripture passage	Scripture Passage
본문 말씀	Today's Scripture	
구절	Verse	
장	Chapter	
절	Verse	
성경책	Book of the Bible	
구약성경	Old Testament	
신약성경	New Testament	
창세기	Genesis	
출애굽기	Exodus	
레위기	Leviticus	
민수기	Numbers	
신명기	Deuteronomy	
시편	Psalms	
잠언	Proverbs	
전도서	Ecclesiastes	
이사야	Isaiah	
예레미야	Jeremiah	
에스겔	Ezekiel	
다니엘	Daniel	
마태복음	Matthew	
마가복음	Mark	
누가복음	Luke	
요한복음	John	
사도행전	Acts	
로마서	Romans	
고린도전서	1 Corinthians	
고린도후서	2 Corinthians	
갈라디아서	Galatians	
에베소서	Ephesians	
빌립보서	Philippians	
골로새서	Colossians	
히브리서	Hebrews	
야고보서	James	
베드로전서	1 Peter	
요한일서	1 John	
요한계시록	Revelation	
예언	Prophecy	
예언자	Prophet	
사도	Apostle	
제자	Disciple	
복음서	Gospel	
비유	Parable	
계명	Commandment	
율법	Law	
지혜	Wisdom	
계시	Revelation	
교회	Church	
성도	Believer	Saint
신자	Believer	
그리스도인	Christian	
공동체	Community	
청년부	Young Adult Ministry	
청년	Young Adult	
목사	Pastor	
담임목사	Senior Pastor	
전도사	Associate Pastor	Ministry Intern*
장로	Elder	
권사	Senior Deaconess	
안수집사	Ordained Deacon	
집사	Deacon	Deaconess
리더	Leader	
셀리더	Small Group Leader	
소그룹	Small Group	
순모임	Life Group	Cell Group
교제	Fellowship	
친교	Fellowship	
섬김	Service	
섬기다	Serve	
사역	Ministry	
사역자	Minister	Ministry Leader
선교	Mission	Missions
선교사	Missionary	
전도	Evangelism	
전도하다	Evangelize	Share the Gospel
제자훈련	Discipleship Training	
제자도	Discipleship	
양육	Spiritual Nurture	
봉사	Volunteer Service	
헌신	Dedication	Commitment
헌신하다	Dedicate oneself	Commit Oneself
사명	Calling	Mission
소명	Calling	
은사	Spiritual Gift	
달란트	Talent	
은혜 나눔	Sharing Testimonies of Grace	
간증	Testimony	
새가족	Newcomer	
등록교인	Registered Member	
출석하다	Attend	
출석 교인	Attendee	
부흥	Revival	
부흥회	Revival Meeting	
수련회	Retreat	
성경공부	Bible Study	
양육 과정	Discipleship Course	
파송	Commissioning	
예배	Worship	
예배드리다	Worship	
주일예배	Sunday Worship Service	
새벽예배	Early Morning Prayer Service	
수요예배	Wednesday Worship Service	
금요기도회	Friday Prayer Meeting	
찬양	Praise	
찬양하다	Praise	
경배	Adoration	Worship
경배하다	Worship	Adore
찬송	Hymn	
찬송가	Hymnal	Hymn
찬양팀	Praise Team	
인도자	Worship Leader	
예배 인도	Leading Worship	
기도	Prayer	
기도하다	Pray	
기도회	Prayer Meeting	
중보기도	Intercessory Prayer	
중보하다	Intercede	
기도 제목	Prayer Request	Prayer Point
응답받은 기도	Answered Prayer	
감사기도	Prayer of Thanksgiving	
회개의 기도	Prayer of Repentance	
축도	Benediction	
축복기도	Prayer of Blessing	
대표기도	Pastoral Prayer	Representative Prayer
묵상기도	Meditative Prayer	
금식기도	Fasting Prayer	
금식	Fasting	
감사	Thanksgiving	Thankfulness
감사하다	Give Thanks	
감사드리다	Give Thanks to God	
헌금	Offering	
십일조	Tithe	
감사헌금	Thanksgiving Offering	
헌신예배	Dedication Service	
축복	Blessing	
축복하다	Bless	
아멘	Amen	
영광 돌리다	Give Glory to God	
임재	Presence	
하나님의 임재	God's Presence	
성령의 임재	The Presence of the Holy Spirit	
은혜를 받다	Receive Grace	
은혜 충만	Full of Grace	
평안	Peace	
감격	Deep Gratitude	Joyful Awe
신앙생활	Christian Life	
예수님을 따르다	Follow Jesus	
순종	Obedience	
순종하다	Obey	
불순종	Disobedience	
충성	Faithfulness	
충성하다	Be Faithful	
희생	Sacrifice	
희생하다	Sacrifice	
겸손	Humility	
겸손하다	Be Humble	
온유	Gentleness	
오래 참음	Patience	Longsuffering
절제	Self-control	
거룩한 삶	Holy Life	
경건	Godliness	
경건한 삶	Godly Life	
의로운 삶	Righteous Life	
성숙	Spiritual Maturity	
성장	Spiritual Growth	
변화	Transformation	
새사람	New Self	
옛사람	Old Self	
성령의 열매	Fruit of the Spirit	
희락	Joy	
화평	Peace	
양선	Goodness	
시험	Temptation	Trial
유혹	Temptation	
시험을 이기다	Overcome Temptation	
영적 싸움	Spiritual Battle	
영적 성장	Spiritual Growth	
믿음의 여정	Journey of Faith	
십자가의 삶	Life of the Cross	
성도의 삶	Life of a Believer	
본이 되다	Be an Example	
끝까지 견디다	Persevere to the End	
영적 전쟁	Spiritual Warfare	
성령의 역사	The Work of the Holy Spirit	
성령의 인도	The Leading of the Holy Spirit	
성령의 충만	The Fullness of the Holy Spirit	
성령 충만하다	Be Filled with the Holy Spirit	
성령의 능력	The Power of the Holy Spirit	
성령의 음성	The Voice of the Holy Spirit	
성령의 감동	The Prompting of the Holy Spirit	
성령의 은사	Spiritual Gifts	
분별	Discernment	
영적 분별력	Spiritual Discernment	
깨달음	Understanding	Insight
확신	Assurance	Conviction
담대함	Boldness	
담대하게	Boldly	
시험에 들다	Fall into Temptation	
고난	Suffering	
환난	Tribulation	
핍박	Persecution	
연단	Refinement	
연단받다	Be Refined	
사탄	Satan	
마귀	The Devil	
악한 영	Evil Spirit	
악	Evil	
죄의 유혹	The Temptation of Sin	
거짓	Falsehood	
거짓말	Lie	
속이다	Deceive	
미혹	Deception	
믿음의 방패	Shield of Faith	
구원의 투구	Helmet of Salvation	
진리의 허리띠	Belt of Truth	
의의 흉배	Breastplate of Righteousness	
평안의 복음의 신	Shoes of the Gospel of Peace	
성령의 검	Sword of the Spirit	
하나님의 전신갑주	Full Armor of God	
기도로 무장하다	Be Equipped with Prayer	
깨어 있다	Stay Alert	
깨어 기도하다	Watch and Pray	
승리	Victory	
승리하다	Overcome	Be Victorious
복음 전도자	Evangelist	
단기선교	Short-term Mission Trip	
해외선교	Overseas Missions	
국내선교	Local Missions	
파송하다	Commission	Send Out
증인	Witness	
증언하다	Testify	
간증하다	Share One's Testimony	
복음의 능력	The Power of the Gospel	
복음의 메시지	The Message of the Gospel	
복음 사역	Gospel Ministry	
하나님 나라	Kingdom of God	
하나님 나라를 세우다	Advance the Kingdom of God	
열방	The Nations	
민족	People Group	Nation
추수	Harvest	
추수할 일꾼	Workers for the Harvest	
제자를 삼다	Make Disciples	
세례	Baptism	
세례를 받다	Be Baptized	
침례	Baptism (침례교 문맥)	
회심	Conversion	
새신자	New Believer	
영접	Receiving Christ	
영접하다	Receive Christ	
초청	Invitation	
초청하다	Invite	
복음집회	Evangelistic Meeting	
선교지	Mission Field	
선교팀	Mission Team	
복음화	Evangelization	
중보선교	Intercessory Missions	
문화선교	Cultural Missions	
캠퍼스 선교	Campus Ministry	
교회 개척	Church Planting	
개척교회	Church Plant	
미전도종족	Unreached People Group	
선교 헌금	Mission Offering	
선교 비전	Mission Vision	
복음의 증인	Witness of the Gospel	
지상명령	The Great Commission	
설교	Sermon	
말씀을 전하다	Preach the Word	
설교하다	Preach	
오늘 본문	Today's Scripture	
말씀을 나누다	Share the Word	
주제	Theme	
핵심	Key Point	
적용	Application	
적용하다	Apply	
교훈	Lesson	
예화	Illustration	
예시	Example	
강조하다	Emphasize	
설명하다	Explain	
선포하다	Proclaim	
권면하다	Exhort	Encourage
도전하다	Challenge	
결단	Commitment	Decision
결단하다	Commit	Decide
순종의 결단	Commitment to Obedience	
삶의 적용	Life Application	
실천	Practice	
실천하다	Put into Practice	
묵상	Meditation	
묵상하다	Meditate	
나누다(말씀)	Share	
선포	Proclamation	
증거	Evidence	Testimony
증거하다	Bear Witness	
결론	Conclusion	
요약	Summary	
핵심 메시지	Main Message	
도입	Introduction	
마무리	Closing	
축복의 말씀	Words of Blessing	
권면의 말씀	Words of Exhortation	
초청의 말씀	Invitation	
기도로 마치다	Close in Prayer	
함께 기도하다	Pray Together	
아멘으로 화답하다	Respond with "Amen"	
삶을 돌아보다	Reflect on Your Life	
마음을 열다	Open Your Heart	
믿음으로 반응하다	Respond in Faith	
결단의 시간	Time of Commitment	
삶	Life	
인생	Life Journey	
일상	Daily Life	
습관	Habit	
선택	Choice	
결정	Decision	
자유의지	Free Will	
책임	Responsibility	
비전	Vision	
꿈	Dream	
목적	Purpose	
계획	Plan	
하나님의 계획	God's Plan	
하나님의 뜻	God's Will	
기다림	Waiting	
인도하심	Guidance	
시련	Trial	
위로	Comfort	
회복	Restoration	
치유	Healing	
용기	Courage	
두려움	Fear	
염려	Worry	Anxiety
불안	Anxiety	
관계	Relationship	
가정	Family	
부모	Parents	
형제자매	Brothers and Sisters	
친구	Friend	
이웃	Neighbor	
사랑하다	Love	
화해	Reconciliation	
나눔	Sharing	
격려	Encouragement	
위로하다	Comfort	
기도 부탁	Prayer Request	
하나님께 영광	Glory to God	`;

export const COMMUNITY_SERMON_GLOSSARY: GlossaryItem[] = RAW_COMMUNITY_GLOSSARY
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [korean, english, alternativesRaw = ""] = line.split("\t");
    const alternatives = alternativesRaw ? alternativesRaw.split("\x1f") : [];
    return {
      korean,
      english,
      ...(alternatives.length ? { alternatives } : {}),
      source: "lexicon" as const,
    };
  });

export const COMMUNITY_SERMON_GLOSSARY_SOURCE_COUNT = 500;
export const COMMUNITY_SERMON_GLOSSARY_UNIQUE_COUNT = COMMUNITY_SERMON_GLOSSARY.length;
