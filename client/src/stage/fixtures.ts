import type { Archetype, AttentionItem, ShopFlag, StageLot, StageModel, StageShop } from "./model";

let slotSeq = 0;

function shop(p: {
  name: string;
  category: string;
  archetype: Archetype;
  color: number;
  level?: number;
  mode?: "direct" | "lease";
  state?: StageShop["state"];
  price?: number;
  stock?: number;
  freshness?: number;
  rev?: number;
  groups?: number;
  flags?: ShopFlag[];
  progress?: number;
}): StageShop {
  const slot = ++slotSeq;
  return {
    id: `s${slot}`,
    slot,
    name: p.name,
    category: p.category,
    archetype: p.archetype,
    color: p.color,
    level: p.level ?? 1,
    mode: p.mode ?? "direct",
    state: p.state ?? "open",
    price: p.price ?? 480,
    stock: p.stock ?? 60,
    freshness: p.freshness ?? 72,
    todayRevenue: p.rev ?? 0,
    todayGroups: p.groups ?? 0,
    flags: p.flags ?? [],
    progress: p.progress,
  };
}

function empty(): { slot: number; shop: null } {
  return { slot: ++slotSeq, shop: null };
}

function lot(s: StageShop) {
  return { slot: s.slot, shop: s };
}

const b1 = [
  lot(shop({ name: "昭和拉麵", category: "拉麵店", archetype: "counter", color: 0xd9534f, level: 2, price: 980, stock: 18, freshness: 81, rev: 64200, groups: 41, flags: ["regular"] })),
  lot(shop({ name: "夜航咖啡", category: "咖啡館", archetype: "cafe", color: 0xb07a4a, level: 1, price: 520, stock: 4, freshness: 38, rev: 28600, groups: 33, flags: ["stockout", "stale"] })),
  lot(shop({ name: "章魚燒橫丁", category: "小吃攤", archetype: "counter", color: 0xf0a030, level: 1, price: 640, stock: 52, freshness: 66, rev: 31200, groups: 38 })),
  lot(shop({ name: "炭火串燒", category: "居酒屋", archetype: "counter", color: 0xc0504d, state: "building", progress: 0.55 })),
  lot(shop({ name: "港口壽司", category: "壽司店", archetype: "counter", color: 0x3a8fb0, level: 2, price: 1280, stock: 36, freshness: 74, rev: 52400, groups: 29 })),
  lot(shop({ name: "糖果舖", category: "零食店", archetype: "shelf", color: 0xe05fa2, level: 1, price: 280, stock: 80, freshness: 58, rev: 14600, groups: 31 })),
  lot(shop({ name: "甜點工房", category: "甜點店", archetype: "cafe", color: 0xe8a0c0, level: 1, price: 680, stock: 26, freshness: 71, rev: 19800, groups: 21 })),
  lot(shop({ name: "關東煮屋台", category: "小吃攤", archetype: "counter", color: 0xf0c040, level: 1, price: 420, stock: 44, freshness: 63, rev: 16200, groups: 26 })),
  empty(),
  empty(),
  empty(),
  empty(),
];

const f1: StageLot[] = [
  lot(shop({ name: "霓虹書房", category: "書店", archetype: "shelf", color: 0x4f8fe3, level: 2, price: 1480, stock: 40, freshness: 77, rev: 42800, groups: 22 })),
  lot(shop({ name: "梅花雜貨", category: "雜貨店", archetype: "shelf", color: 0x52b788, level: 1, price: 380, stock: 70, freshness: 60, rev: 18900, groups: 27, flags: ["complaint"] })),
  lot(shop({ name: "街角服飾", category: "服飾店", archetype: "rack", color: 0xe05fa2, level: 1, price: 2980, stock: 28, freshness: 55, rev: 36400, groups: 14 })),
  lot(shop({ name: "電玩橫丁", category: "遊戲中心", archetype: "arcade", color: 0x8a5ff0, level: 2, price: 300, stock: 99, freshness: 84, rev: 58100, groups: 52, mode: "lease" })),
  lot(shop({ name: "茶香堂", category: "茶舖", archetype: "cafe", color: 0x6fae5e, level: 1, price: 450, stock: 33, freshness: 70, rev: 15200, groups: 19 })),
  lot(shop({ name: "小熊玩具", category: "玩具店", archetype: "shelf", color: 0xf0c040, level: 1, price: 880, stock: 0, freshness: 48, rev: 9800, groups: 8, state: "closed", flags: ["broken"] })),
  empty(), // 下面改成被「電玩橫丁」吸收的墓碑（示範 2 格寬的大店）
  empty(),
];
f1[6] = { slot: f1[6]!.slot, shop: null, into: f1[3]!.slot };

const f2 = [
  lot(shop({ name: "百合花店", category: "花店", archetype: "shelf", color: 0xe8a0c0, level: 1, price: 1200, stock: 24, freshness: 69, rev: 12400, groups: 9 })),
  lot(shop({ name: "月影酒吧", category: "酒吧", archetype: "counter", color: 0x6a4fa0, level: 1, price: 1100, stock: 30, freshness: 62, rev: 21800, groups: 12 })),
  empty(),
  empty(),
];

const idOf = (name: string): string => [...b1, ...f1, ...f2].find((l) => l.shop?.name === name)?.shop?.id ?? "";

export const DEMO_ATTENTION: AttentionItem[] = [
  { id: "a1", severity: "urgent", icon: "box", title: "「夜航咖啡」缺貨中", detail: "庫存剩 4 份，供應商今天出貨吃緊", cta: "補貨", target: { kind: "shop", shopId: idOf("夜航咖啡") } },
  { id: "a2", severity: "urgent", icon: "wrench", title: "「小熊玩具」故障停業", detail: "設備老舊，維修後才能營業", cta: "叫修", target: { kind: "shop", shopId: idOf("小熊玩具") } },
  { id: "a3", severity: "decision", icon: "face", title: "客訴：梅花雜貨排隊太久", detail: "放著不管會依你的處理偏好自動處理", cta: "處理", target: { kind: "shop", shopId: idOf("梅花雜貨") } },
  { id: "a4", severity: "decision", icon: "event", title: "颱風接近，要不要提早閉館？", detail: "還有 2 小時會自動套用預設選項", cta: "決定", target: { kind: "event", uid: "demo" } },
  { id: "a5", severity: "opportunity", icon: "lease", title: "有 2 個品牌想進駐洽談", detail: "到「開發 → 招商」看條件", cta: "看看", target: { kind: "hub", hub: "develop", tab: "leasing" } },
  { id: "a6", severity: "opportunity", icon: "quest", title: "新手任務 3／10：蓋第二間店", cta: "看清單", target: { kind: "menu", page: "help" } },
  { id: "a7", severity: "info", icon: "news", title: "昨日日報：口碑上升 0.8", cta: "閱讀", target: { kind: "hub", hub: "finance", tab: "reports" } },
];

export function buildDemoModel(): StageModel {
  return {
    mallName: "光之小路商場",
    floors: [
      { id: "b1", label: "B1", name: "地下美食街", lots: b1, links: ["rail"] },
      { id: "f1", label: "1F", name: "日常商店街", lots: f1, ground: true },
      { id: "f2", label: "2F", name: "雜貨與夜生活", lots: f2 },
    ],
    funds: 2_184_300,
    todayProfit: 86_400,
    todayRevenue: 322_500,
    todayGroups: 289,
    level: 3,
    stars: 3,
    localRep: 54.2,
    touristHeat: 38.7,
    cleanliness: 62,
    equipment: 47,
    minuteOfDay: 13 * 60 + 20,
    dateLabel: "04/07 週三",
    dateBadge: null,
    weekend: false,
    cleaningLevel: 1,
    weather: { kind: "clear", temp: 24 },
    tomorrow: { kind: "rain", temp: 19, window: [13, 22] },
    openHour: 10,
    closeHour: 22,
    attention: DEMO_ATTENTION,
  };
}
