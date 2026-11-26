import type { RegularKind, VoiceTopic } from "./types";

// 熟客的「類型」、關係階段與他們會對你說的話。全部資料驅動：新增樓層／業態時，只要新熟客的最愛業態對得上就會出現。
// 原則（符合現實）：真實的店沒有「專屬座位」或「專屬菜單」；熟客是認得你、習慣來、會帶朋友、會直接給意見的人。

export interface RegularKindDef {
  label: string;
  icon: string;
  desc: string;
  /** 偏好的來店時段（遊戲小時 [起, 迄)）；在區間內來店機率 × peak、區間外 × off。沒寫＝全天一樣 */
  hours?: [number, number][];
  peak: number;
  off: number;
  /** 假日來店機率的額外倍率 */
  weekend: number;
  /** 帶朋友的機率倍率 */
  friend: number;
  /** 給意見的機率倍率 */
  voice: number;
  /** 館內清潔度低於這個值就不開心 */
  cleanBar: number;
  /** 危機時說情／作證的分量倍率 */
  help: number;
}

export const REGULAR_KINDS: Record<RegularKind, RegularKindDef> = {
  worker: { label: "上班族", icon: "💼", desc: "午休與下班後來，要快、不愛排隊；假日少見。", hours: [[11, 14], [17, 21]], peak: 1.5, off: 0.55, weekend: 0.5, friend: 1, voice: 0.8, cleanBar: 40, help: 1 },
  elder: { label: "鄰里長者", icon: "🧓", desc: "在這一帶住了一輩子，白天來、重人情，在地口碑與危機時最有分量。", hours: [[8, 12], [15, 18]], peak: 1.3, off: 0.7, weekend: 1, friend: 0.6, voice: 1.4, cleanBar: 55, help: 2 },
  foodie: { label: "品味客", icon: "🧐", desc: "挑品質、愛挑剔也愛稱讚，常直接告訴你哪裡可以更好。", peak: 1, off: 1, weekend: 1.2, friend: 0.8, voice: 1.8, cleanBar: 50, help: 1 },
  thrifty: { label: "精打細算", icon: "🧮", desc: "對價格很敏感，會比價；喜歡的店會呼朋引伴一起來。", peak: 1, off: 1, weekend: 1, friend: 1.5, voice: 1, cleanBar: 40, help: 1 },
  fan: { label: "同好", icon: "🎮", desc: "為了興趣而來，假日與活動日最勤，喜歡拉同好一起。", peak: 1, off: 1, weekend: 1.5, friend: 1.3, voice: 0.8, cleanBar: 40, help: 1 },
  family: { label: "家庭客", icon: "👨‍👩‍👧", desc: "週末與傍晚全家一起來，在意乾淨與安全。", hours: [[10, 14], [17, 19]], peak: 1.3, off: 0.7, weekend: 1.8, friend: 1.2, voice: 1.1, cleanBar: 55, help: 1 },
  pro: { label: "業界人士", icon: "🧳", desc: "懂行情的人：採購、評論、地方人士。出了事他的一句話很有用。", peak: 1, off: 1, weekend: 0.8, friend: 0.7, voice: 1.2, cleanBar: 45, help: 2 },
  creator: { label: "創作者", icon: "📸", desc: "會拍照、發文、帶朋友；對氣氛與賣相很敏感。", peak: 1, off: 1, weekend: 1.2, friend: 1.4, voice: 1, cleanBar: 50, help: 1 },
};

export const REGULAR_KIND_ORDER = Object.keys(REGULAR_KINDS) as RegularKind[];

/** 「記住喜好」之後，他覺得被重視：來得更勤、關係成長更快 */
export const KNOWN_VISIT_MULT = 1.15;
export const KNOWN_GAIN_MULT = 1.25;

// ───────── 關係階段 ─────────
export interface RegularTierDef {
  id: "new" | "face" | "regular" | "patron" | "friend";
  min: number;
  label: string;
  icon: string;
  perk: string;
}
export const REGULAR_TIERS: RegularTierDef[] = [
  { id: "new", min: 0, label: "初見", icon: "🙂", perk: "剛認識，還在觀察你的店。" },
  { id: "face", min: 15, label: "面熟", icon: "😊", perk: "認得你了，會比較常來。" },
  { id: "regular", min: 35, label: "熟客", icon: "🏮", perk: "會帶朋友一起來，偶爾直接給你意見。" },
  { id: "patron", min: 60, label: "老主顧", icon: "🎎", perk: "口碑推薦（每日人氣小加成）；稽查、客訴、官司時肯幫你說話。" },
  { id: "friend", min: 85, label: "摯友", icon: "🤝", perk: "把你的店當自己的店：說話更有分量，人生大事也會跟你分享。" },
];
export function regularTier(affinity: number): RegularTierDef {
  let t = REGULAR_TIERS[0]!;
  for (const x of REGULAR_TIERS) if (affinity >= x.min) t = x;
  return t;
}

/** 熟客階段以上才會帶朋友 */
export const FRIEND_MIN_AFFINITY = 35;
/** 老主顧以上才會說情／作證 */
export const HELP_MIN_AFFINITY = 60;

// ───────── 熟客的話：意見與人生大事 ─────────
export const VOICE_DEADLINE_TICKS = 288 * 2;
export const VOICE_MIN_AFFINITY = 25;
/** 同時最多幾則未回應的話 */
export const MAX_OPEN_VOICES = 4;

export const VOICE_TOPICS: Record<VoiceTopic, { label: string; icon: string; lines: string[] }> = {
  dirty: { label: "環境意見", icon: "🧹", lines: ["最近覺得「{shop}」附近有點髒，桌面也黏黏的。", "「{shop}」的洗手間好像沒人整理了……"] },
  stockout: { label: "缺貨意見", icon: "📦", lines: ["我最愛的那一樣，「{shop}」常常賣完，白跑好幾次了。", "怎麼又沒貨了？「{shop}」是不是進貨不夠？"] },
  price: { label: "價格意見", icon: "💴", lines: ["「{shop}」好像又變貴了，常來的人會有感覺的。", "同樣的東西，「{shop}」現在比以前貴不少耶。"] },
  queue: { label: "排隊意見", icon: "⏳", lines: ["「{shop}」尖峰時間人好多，常常排很久。", "每次去「{shop}」都要等，能不能想想辦法？"] },
  stale: { label: "新鮮感意見", icon: "✨", lines: ["「{shop}」的菜單和擺設好久沒變了，有點膩。", "常來「{shop}」，希望偶爾有點新花樣。"] },
  wish: { label: "想要的東西", icon: "💡", lines: ["如果「{shop}」能多一種我喜歡的選擇就好了。", "我一直希望「{shop}」有更多適合我的品項。"] },
  life: { label: "人生大事", icon: "🎊", lines: [] },
};

export interface LifeEventDef {
  id: string;
  label: string;
  /** 意見卡上的說明，{name} 是這位熟客 */
  text: string;
  giftLabel: string;
}
export const LIFE_EVENTS: LifeEventDef[] = [
  { id: "move", label: "要搬家了", text: "{name}說下個月要搬到別的區了，以後可能沒辦法常常來。", giftLabel: "送上餞別禮" },
  { id: "marry", label: "結婚了", text: "{name}開心地說：「我要結婚了！」", giftLabel: "送上賀禮" },
  { id: "baby", label: "新生命", text: "{name}說他們家剛添了寶寶，最近手忙腳亂。", giftLabel: "送上祝福小禮" },
  { id: "promo", label: "升遷了", text: "{name}說工作上有了不錯的升遷，心情特別好。", giftLabel: "送上小小的慶祝" },
  { id: "retire", label: "退休了", text: "{name}說他終於退休了，以後有更多時間可以到處走走。", giftLabel: "送上紀念品" },
  { id: "sick", label: "身體不舒服", text: "{name}說最近身體不太舒服，需要休息一陣子。", giftLabel: "送上慰問品" },
];
export const LIFE_EVENT_BY_ID = Object.fromEntries(LIFE_EVENTS.map((e) => [e.id, e])) as Record<string, LifeEventDef>;
export const LIFE_GIFT_COST = 5_000;

/** 採納意見的內容（引擎與畫面共用） */
export const VOICE_ADOPT: Record<Exclude<VoiceTopic, "life">, { label: string; cost: number; desc: string }> = {
  dirty: { label: "馬上整理", cost: 6_000, desc: "請人徹底打掃一次，館內清潔度 +8。" },
  stockout: { label: "緊急補貨", cost: 0, desc: "立刻追加 100 份進貨（照一般進貨價，不另收費）。" },
  price: { label: "調回合理價位", cost: 0, desc: "把標價降到參考價的 1.1 倍以內。" },
  queue: { label: "加派人手", cost: 4_000, desc: "尖峰時段多請臨時工，口碑小加分。" },
  stale: { label: "換新花樣", cost: 10_000, desc: "做一次小改版，這間店的新鮮感 +10。" },
  wish: { label: "記下來研究", cost: 0, desc: "把他的需求寫進小本子，之後研發新品的靈感來源。" },
};
export const VOICE_AFFINITY = { adopt: 4, thanks: 1.5, ignore: -1.5, gift: 5, wish: 2, skip: -1 } as const;

/** 每種類型的熟客，這則話出現的「來店時段」加成 */
export function kindHourMult(kind: RegularKind | undefined, hour: number, offDay: boolean): number {
  if (!kind) return 1;
  const def = REGULAR_KINDS[kind];
  let m = 1;
  if (def.hours) m = def.hours.some(([a, b]) => hour >= a && hour < b) ? def.peak : def.off;
  return m * (offDay ? def.weekend : 1);
}
