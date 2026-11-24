import {
  CATEGORY_BY_ID,
  EXCESS_TAG,
  MAX_COOKBOOK,
  MAX_TASTINGS,
  MAX_WORKSHOP_LOG,
  MENU_LIST_FRESHNESS,
  MENU_NOVELTY_DECAY,
  MENU_NOVELTY_FLOOR,
  PERSONA_IDS,
  REGULAR_BY_ID,
  REGULAR_SIGNATURE_BONUS,
  RND_CANCEL_REFUND,
  RND_TICKS,
  RND_TICKS_SPECIAL,
  SIGNATURE_IDX_CAP,
  SIGNATURE_IDX_DAILY,
  SLOT_KINDS,
  TAG_BY_ID,
  TASTING_TTL,
  WORKSHOP_INFO,
  comboKey,
  dishFitsCategory,
  menuSlots,
  rndCostOf,
  type CategoryGroup,
  type Dish,
  type IngredientInfo,
  type MallState,
  type PersonaId,
  type RndJob,
  type RndOutcome,
  type Shop,
  type SlotKind,
} from "@coidle/shared";
import { applyPersonaIndex } from "./events";
import type { GuestResult } from "./guests";
import {
  INGREDIENTS,
  INGREDIENT_BY_ID,
  RECIPES,
  RECIPE_BY_ID,
  RECIPE_REGULAR,
  type ClueCond,
  type IngredientData,
  type RecipeData,
  type Unlock,
} from "./recipes";
import type { Rng } from "./rng";
import { addLog, nextId } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Picks = Partial<Record<SlotKind, string>>;

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

// ───────── 素材解鎖與線索 ─────────

function unlocked(s: MallState, u: Unlock): boolean {
  switch (u.t) {
    case "start":
      return true;
    case "level":
      return s.level >= u.level;
    case "supplier": {
      const st = s.supply.suppliers.find((x) => x.id === u.id);
      return !!st && st.discovered && (u.rel === undefined || st.relationship >= u.rel);
    }
    case "regular": {
      const r = s.regulars.find((x) => x.id === u.id);
      return !!r && r.storyStage >= u.stage;
    }
    case "rival":
      return s.rivals.list.some((x) => x.id === u.id && x.intelUntil > 0);
    case "discoveries":
      return s.workshop.discovered.length >= u.n;
  }
}

function clueMet(s: MallState, c: ClueCond): boolean {
  switch (c.t) {
    case "regular": {
      const r = s.regulars.find((x) => x.id === c.id);
      return !!r && r.met && r.affinity >= c.affinity;
    }
    case "supplier": {
      const st = s.supply.suppliers.find((x) => x.id === c.id);
      return !!st && st.discovered && st.relationship >= c.rel;
    }
    case "rival":
      return s.rivals.list.some((x) => x.id === c.id && x.intelUntil > 0);
    case "level":
      return s.level >= c.level;
  }
}

function clueSource(c: ClueCond): string {
  if (c.t === "regular") return REGULAR_BY_ID[c.id]?.name ?? "常客";
  if (c.t === "supplier") return "供應商";
  if (c.t === "rival") return "商戰情報";
  return "市井傳聞";
}

/** 有沒有開這個配方相關的店（沒開的話線索沒有意義，先不給） */
function recipeRelevant(s: MallState, r: RecipeData): boolean {
  return s.shops.some((x) => x.mode === "direct" && (r.categories ? r.categories.includes(x.category) : CATEGORY_BY_ID[x.category]?.group === r.group));
}

function toInfo(d: IngredientData): IngredientInfo {
  return { id: d.id, group: d.group, slot: d.slot, name: d.name, icon: d.icon, cost: d.cost, desc: d.desc };
}

/** 把達成條件的素材與線索加進玩家的筆記（只增不減，可重複呼叫） */
export function syncWorkshop(s: MallState): void {
  const ws = s.workshop;
  const silent = ws.ingredients.length === 0;
  const known = new Set(ws.ingredients.map((x) => x.id));
  for (const d of INGREDIENTS) {
    if (known.has(d.id) || !unlocked(s, d.unlock)) continue;
    ws.ingredients.push(toInfo(d));
    if (!silent) {
      addLog(s, "info", `🧪 認識了新素材：${d.icon}「${d.name}」（${WORKSHOP_INFO[d.group].name}）`);
      note(s, `認識了新素材「${d.name}」`);
    }
  }
  const have = new Set(ws.clues.map((c) => c.id));
  for (const r of RECIPES) {
    if (!recipeRelevant(s, r)) continue;
    r.clues.forEach((c, i) => {
      const id = `${r.id}:${i}`;
      if (have.has(id) || !clueMet(s, c.cond)) return;
      ws.clues.push({ id, tick: s.tick, source: clueSource(c.cond), text: c.text, solved: ws.discovered.includes(r.id) });
      if (!silent) addLog(s, "info", `💡 新線索（${clueSource(c.cond)}）：${c.text}`);
    });
  }
}

// ───────── 判定（純函式，可重現） ─────────

export interface EvalResult {
  outcome: RndOutcome;
  recipe: RecipeData | null;
  quality: number;
  appeal: Partial<Record<PersonaId, number>>;
  /** 突出的特性 */
  tags: string[];
  totals: Record<string, number>;
  feedback: string[];
  clue: string | null;
}

export function chefLevel(s: MallState, shop: Shop): number {
  return shop.level + Math.floor((s.workshop.skill[shop.id] ?? 0) / 4);
}

export function tagTotals(picks: Picks): Record<string, number> {
  const t: Record<string, number> = {};
  for (const k of SLOT_KINDS) {
    const id = picks[k];
    const d = id ? INGREDIENT_BY_ID[id] : undefined;
    if (!d) continue;
    for (const [tag, v] of Object.entries(d.tags)) t[tag] = (t[tag] ?? 0) + v;
  }
  return t;
}

function matchScore(r: RecipeData, picks: Picks, totals: Record<string, number>): { score: number; broken: boolean; weakest: string | null; excess: string | null } {
  const needs = Object.entries(r.need);
  let sum = 0;
  let weakest: string | null = null;
  let worst = 2;
  for (const [tag, need] of needs) {
    const ratio = Math.min(1, (totals[tag] ?? 0) / need);
    sum += ratio;
    if (ratio < worst) {
      worst = ratio;
      weakest = tag;
    }
  }
  let broken = false;
  let excess: string | null = null;
  for (const [tag, max] of Object.entries(r.avoid ?? {})) {
    if ((totals[tag] ?? 0) > max) {
      broken = true;
      excess = tag;
    }
  }
  if (r.method && (!picks.method || !r.method.includes(picks.method))) broken = true;
  return { score: sum / needs.length, broken, weakest: worst < 1 ? weakest : null, excess };
}

function autoName(group: CategoryGroup, picks: Picks): string {
  const w = (k: SlotKind) => (picks[k] ? INGREDIENT_BY_ID[picks[k]!]?.word ?? "" : "");
  return `${w("season")}${w("method")}${w("base")}${WORKSHOP_INFO[group].suffix}`;
}

export function evaluate(category: string, picks: Picks, skill: number, rng: Rng, discovered: string[]): EvalResult {
  const group = CATEGORY_BY_ID[category]?.group ?? "food";
  const tagDefs = TAG_BY_ID[group];
  const totals = tagTotals(picks);
  const base = { recipe: null as RecipeData | null, totals, clue: null as string | null };
  const top = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v >= 3)
    .map(([k]) => k);

  const cands = RECIPES.filter((r) => r.group === group && (!r.categories || r.categories.includes(category)));
  const scored = cands.map((r) => ({ r, m: matchScore(r, picks, totals) }));
  const full = scored.filter((x) => x.m.score >= 0.999 && !x.m.broken && !discovered.includes(x.r.id)).sort((a, b) => b.r.quality - a.r.quality)[0];
  if (full) {
    const r = full.r;
    const ok = rng.chance(clamp(0.6 + 0.07 * skill, 0.5, 0.95));
    if (!ok) {
      return { ...base, outcome: "almost", quality: 0, appeal: {}, tags: [], feedback: ["配方的方向沒錯！只是火候差了一點點——再試一次，說不定就成了。"] };
    }
    return {
      ...base,
      outcome: "signature",
      recipe: r,
      quality: clamp(Math.round(r.quality + Math.min(6, skill * 1.5) + rng.gauss() * 1.5), 50, 98),
      appeal: { ...r.appeal },
      tags: Object.keys(r.need),
      feedback: ["試吃的人都愣住了——這就是那個「傳說中的味道」！"],
    };
  }

  // 失衡：某個特性太過頭
  const over = Object.entries(totals).find(([, v]) => v > EXCESS_TAG);
  if (over) {
    return { ...base, outcome: "flop", quality: 0, appeal: {}, tags: [], feedback: [tagDefs[over[0]]?.much ?? "搭配失衡"] };
  }
  if (rng.chance(clamp(0.16 - 0.025 * skill, 0.04, 0.16))) {
    return { ...base, outcome: "burnt", quality: 0, appeal: {}, tags: [], feedback: ["手一滑，整份報銷了。這次只能怪運氣。"] };
  }

  // 普通創作
  const grades = SLOT_KINDS.reduce((a, k) => a + ((picks[k] && INGREDIENT_BY_ID[picks[k]!]?.grade) || 1) - 1, 0);
  const quality = clamp(Math.round(36 + 4 * Math.min(4, top.length) + 3 * grades + 2 * skill + rng.gauss() * 2), 30, 68);
  const appeal: Partial<Record<PersonaId, number>> = {};
  for (const p of PERSONA_IDS) {
    let a = 0;
    for (const [tag, v] of Object.entries(totals)) a += Math.min(1, v / 5) * (tagDefs[tag]?.appeal[p] ?? 0) * 0.5;
    if (a >= 0.08) appeal[p] = Math.min(0.45, Math.round(a * 100) / 100);
  }
  const feedback = top.slice(0, 2).map((t) => tagDefs[t]?.good ?? "").filter(Boolean);
  if (top.length === 0) feedback.push("平淡無奇，客人大概吃過就忘了。");

  // 接近某個還沒發現的配方：給方向
  const near = scored.filter((x) => !discovered.includes(x.r.id) && x.m.score >= 0.6 && x.m.score < 0.999).sort((a, b) => b.m.score - a.m.score)[0];
  let clue: string | null = null;
  if (near?.m.weakest) clue = `隱約有種接近某個隱藏風味的感覺——${tagDefs[near.m.weakest]?.lack ?? "還差一點"}。`;
  else if (near?.m.excess) clue = `隱約有種接近某個隱藏風味的感覺——但${tagDefs[near.m.excess]?.much ?? "有個特性太過頭了"}。`;
  else if (near && near.m.broken) clue = "隱約有種接近某個隱藏風味的感覺——也許換一種手法？";
  if (scored.some((x) => discovered.includes(x.r.id) && x.m.score >= 0.999 && !x.m.broken)) feedback.push("味道和你的招牌很像，沒什麼新意。");
  return { ...base, outcome: "original", quality, appeal, tags: top.slice(0, 3), feedback, clue };
}

// ───────── 研發 ─────────

function pickData(s: MallState, group: CategoryGroup, picks: Picks): { ok: true; list: IngredientData[] } | { ok: false; error: string } {
  const known = new Set(s.workshop.ingredients.map((x) => x.id));
  const list: IngredientData[] = [];
  for (const k of SLOT_KINDS) {
    const id = picks[k];
    if (!id) {
      if (k !== "special") return { ok: false, error: `還沒選${WORKSHOP_INFO[group].slots[k]}` };
      continue;
    }
    const d = INGREDIENT_BY_ID[id];
    if (!d || !known.has(id) || d.slot !== k || d.group !== group) return { ok: false, error: "素材無效或你還不認識它" };
    list.push(d);
  }
  return { ok: true, list };
}

export function startRnd(s: MallState, shopId: string, picks: Picks): GuestResult {
  const shop = s.shops.find((x) => x.id === shopId);
  const cat = shop && CATEGORY_BY_ID[shop.category];
  if (!shop || !cat) return { ok: false, error: "找不到這間店" };
  if (shop.mode !== "direct") return { ok: false, error: "出租的店由租戶自己研發" };
  if (s.workshop.jobs.some((j) => j.shopId === shopId)) return { ok: false, error: "這間店正在研發，等完成再開始下一件" };
  const pd = pickData(s, cat.group, picks);
  if (!pd.ok) return pd;
  const sig = comboKey(shop.category, picks);
  const prev = s.workshop.tried[sig];
  if (prev === "signature") return { ok: false, error: "這個組合已經做出招牌了，直接去食譜本上架吧" };
  if (prev === "original") return { ok: false, error: "這個組合你試過了（做出的是普通創作），換個搭配吧" };
  if (prev === "flop") return { ok: false, error: "這個組合你試過了（搭配失衡），換個搭配吧" };
  const cost = rndCostOf(cat.group, pd.list.map((d) => d.cost));
  if (s.funds < cost) return { ok: false, error: "資金不足" };
  s.funds -= cost;
  s.today.purchases += cost;
  const ticks = picks.special ? RND_TICKS_SPECIAL : RND_TICKS;
  const job: RndJob = { uid: nextId(s, "rnd"), shopId, picks: { ...picks }, startTick: s.tick, endTick: s.tick + ticks, cost, sig };
  s.workshop.jobs.push(job);
  addLog(s, "info", `🧪 「${shop.name}」開始${WORKSHOP_INFO[cat.group].verb}。`);
  return { ok: true, note: `開始研發（花 ${cost}）` };
}

export function cancelRnd(s: MallState, shopId: string): GuestResult {
  const i = s.workshop.jobs.findIndex((j) => j.shopId === shopId);
  const job = s.workshop.jobs[i];
  if (!job) return { ok: false, error: "這間店沒有進行中的研發" };
  const refund = Math.round(job.cost * RND_CANCEL_REFUND);
  s.funds += refund;
  s.workshop.jobs.splice(i, 1);
  return { ok: true, note: `取消研發，退回 ${refund}` };
}

function revealTraits(s: MallState, picks: Picks, rng: Rng): { ingredientId: string; tag: string }[] {
  const out: { ingredientId: string; tag: string }[] = [];
  for (const k of SLOT_KINDS) {
    const id = picks[k];
    const d = id ? INGREDIENT_BY_ID[id] : undefined;
    if (!id || !d) continue;
    const have = s.workshop.learned[id] ?? [];
    const rest = Object.entries(d.tags)
      .filter(([t]) => !have.includes(t))
      .sort((a, b) => b[1] - a[1]);
    if (rest.length === 0 || !rng.chance(0.75)) continue;
    const best = rest.filter((x) => x[1] === rest[0]![1]);
    const tag = best[rng.int(0, best.length - 1)]![0];
    s.workshop.learned[id] = [...have, tag];
    out.push({ ingredientId: id, tag });
  }
  return out;
}

function resolveJob(s: MallState, job: RndJob, rng: Rng): void {
  const ws = s.workshop;
  const shop = s.shops.find((x) => x.id === job.shopId);
  const cat = shop && CATEGORY_BY_ID[shop.category];
  if (!shop || !cat) return;
  const first = !(job.sig in ws.tried);
  const res = evaluate(shop.category, job.picks, chefLevel(s, shop), rng, ws.discovered);
  ws.tried[job.sig] = res.outcome;
  ws.skill[shop.id] = (ws.skill[shop.id] ?? 0) + 1;
  const learned = first && res.outcome !== "burnt" ? revealTraits(s, job.picks, rng) : [];

  let dishId: string | null = null;
  let dishName: string | null = null;
  if (res.outcome === "signature" || res.outcome === "original") {
    const sigDish = res.outcome === "signature" && res.recipe;
    const r = res.recipe;
    const icon = (sigDish && r ? r.icon : (job.picks.special && INGREDIENT_BY_ID[job.picks.special]?.icon) || INGREDIENT_BY_ID[job.picks.method ?? ""]?.icon) || "🍽️";
    const dish: Dish = {
      id: nextId(s, "dish"),
      name: sigDish && r ? r.name : autoName(cat.group, job.picks),
      icon,
      group: cat.group,
      categories: sigDish && r ? r.categories : undefined,
      recipeId: sigDish && r ? r.id : null,
      signature: !!sigDish,
      quality: res.quality,
      appeal: res.appeal,
      tags: res.tags,
      desc: sigDish && r ? r.desc : "自己摸索出來的搭配。",
      madeTick: s.tick,
      madeAt: shop.name,
      picks: { ...job.picks },
      novelty: 100,
      listedCount: 0,
    };
    // 食譜本滿了就丟掉最舊、沒上架的原創品
    const listed = new Set(s.shops.flatMap((x) => x.menu.map((e) => e.dishId)));
    while (ws.dishes.length >= MAX_COOKBOOK) {
      const idx = ws.dishes.findIndex((d) => !d.signature && !listed.has(d.id));
      if (idx < 0) break;
      ws.dishes.splice(idx, 1);
    }
    ws.dishes.push(dish);
    dishId = dish.id;
    dishName = dish.name;
    if (sigDish && r) {
      ws.discovered.push(r.id);
      for (const c of ws.clues) if (c.id.startsWith(`${r.id}:`)) c.solved = true;
      addLog(s, "info", `🌟 研發成功！「${shop.name}」做出了招牌「${r.name}」！`);
      note(s, `「${shop.name}」研發出招牌「${r.name}」`);
    } else {
      addLog(s, "info", `🧪 「${shop.name}」的研發完成：${dish.name}（普通創作）。`);
    }
  } else {
    addLog(s, "info", `🧪 「${shop.name}」的研發結果：${res.outcome === "flop" ? "搭配失衡，失敗了" : res.outcome === "burnt" ? "手滑報銷了" : "配方對了、火候差一點"}。`);
  }

  ws.tastings.push({
    uid: nextId(s, "tst"),
    shopId: shop.id,
    createdTick: s.tick,
    deadlineTick: s.tick + TASTING_TTL,
    outcome: res.outcome,
    dishId,
    picks: { ...job.picks },
    feedback: res.feedback,
    clue: res.clue,
    learned,
  });
  while (ws.tastings.length > MAX_TASTINGS) ws.tastings.shift();
  ws.log.push({ tick: s.tick, shopName: shop.name, picks: { ...job.picks }, outcome: res.outcome, dishName, feedback: [...res.feedback, ...(res.clue ? [res.clue] : [])] });
  while (ws.log.length > MAX_WORKSHOP_LOG) ws.log.shift();
  syncWorkshop(s);
}

/** 每個 tick：完成到期的研發、處理逾時的試吃（有空欄位就自動上架） */
export function workshopTick(s: MallState, rng: Rng): void {
  const ws = s.workshop;
  if (ws.jobs.length === 0 && ws.tastings.length === 0) return;
  if (ws.jobs.some((j) => j.endTick <= s.tick)) {
    const due = ws.jobs.filter((j) => j.endTick <= s.tick);
    ws.jobs = ws.jobs.filter((j) => j.endTick > s.tick);
    for (const j of due) resolveJob(s, j, rng);
  }
  if (ws.tastings.some((t) => t.deadlineTick <= s.tick)) {
    const expired = ws.tastings.filter((t) => t.deadlineTick <= s.tick);
    ws.tastings = ws.tastings.filter((t) => t.deadlineTick > s.tick);
    for (const t of expired) {
      const shop = s.shops.find((x) => x.id === t.shopId);
      if (!shop || !t.dishId) continue;
      if (shop.menu.length < menuSlots(shop.level)) {
        const r = listDish(s, shop.id, t.dishId);
        if (r.ok) addLog(s, "info", `🍽️ 沒人處理試吃結果，「${shop.name}」自動把新作品上架了。`);
      }
    }
  }
}

// ───────── 菜單 ─────────

export function listDish(s: MallState, shopId: string, dishId: string, slotIndex?: number): GuestResult {
  const shop = s.shops.find((x) => x.id === shopId);
  const dish = s.workshop.dishes.find((d) => d.id === dishId);
  if (!shop || !dish) return { ok: false, error: "找不到這間店或這道作品" };
  if (shop.mode !== "direct") return { ok: false, error: "出租的店由租戶決定菜單" };
  if (!dishFitsCategory(dish, shop.category)) return { ok: false, error: "這道作品不適合這間店" };
  if (shop.menu.some((e) => e.dishId === dishId)) return { ok: false, error: "已經在這間店的菜單上了" };
  const slots = menuSlots(shop.level);
  let idx = slotIndex;
  if (idx === undefined) {
    if (shop.menu.length >= slots) return { ok: false, error: "菜單滿了，請選一道換掉" };
    idx = shop.menu.length;
  }
  if (!Number.isInteger(idx) || idx < 0 || idx >= slots || idx > shop.menu.length) return { ok: false, error: "欄位無效" };
  if (idx < shop.menu.length) unlistDish(s, shopId, idx);
  shop.menu.splice(Math.min(idx, shop.menu.length), 0, {
    dishId: dish.id,
    name: dish.name,
    icon: dish.icon,
    signature: dish.signature,
    recipeId: dish.recipeId,
    quality: dish.quality,
    appeal: dish.appeal,
    novelty: dish.novelty,
    listedTick: s.tick,
  });
  if (dish.listedCount === 0) {
    shop.freshness = Math.min(100, shop.freshness + MENU_LIST_FRESHNESS[dish.signature ? "signature" : "original"]);
    const regId = dish.recipeId ? RECIPE_REGULAR[dish.recipeId] : undefined;
    const reg = regId ? s.regulars.find((x) => x.id === regId) : undefined;
    if (reg?.met) {
      reg.affinity = Math.min(100, reg.affinity + REGULAR_SIGNATURE_BONUS);
      addLog(s, "info", `💞 「${REGULAR_BY_ID[reg.id]?.name}」嚐到了那道念念不忘的味道，開心得不得了！`);
    }
  }
  dish.listedCount++;
  return { ok: true, note: `「${dish.name}」上架了` };
}

export function unlistDish(s: MallState, shopId: string, slotIndex: number): GuestResult {
  const shop = s.shops.find((x) => x.id === shopId);
  const e = shop?.menu[slotIndex];
  if (!shop || !e) return { ok: false, error: "這個欄位沒有東西" };
  const dish = s.workshop.dishes.find((d) => d.id === e.dishId);
  if (dish) dish.novelty = e.novelty; // 收起來的新鮮度帶著走，不能靠下架再上架洗新
  shop.menu.splice(slotIndex, 1);
  return { ok: true, note: `「${e.name}」下架了` };
}

export function discardDish(s: MallState, dishId: string): GuestResult {
  const i = s.workshop.dishes.findIndex((d) => d.id === dishId);
  const dish = s.workshop.dishes[i];
  if (!dish) return { ok: false, error: "找不到這道作品" };
  if (dish.signature) return { ok: false, error: "招牌不能丟掉" };
  if (s.shops.some((x) => x.menu.some((e) => e.dishId === dishId))) return { ok: false, error: "還在菜單上，請先下架" };
  s.workshop.dishes.splice(i, 1);
  return { ok: true, note: `丟掉了「${dish.name}」` };
}

export function tastingAction(s: MallState, uid: string, action: "list" | "keep" | "discard", slotIndex?: number): GuestResult {
  const i = s.workshop.tastings.findIndex((t) => t.uid === uid);
  const t = s.workshop.tastings[i];
  if (!t) return { ok: false, error: "這份試吃結果已經處理過了" };
  if (action === "list") {
    if (!t.dishId) return { ok: false, error: "沒有可以上架的成品" };
    const r = listDish(s, t.shopId, t.dishId, slotIndex);
    if (!r.ok) return r;
    s.workshop.tastings.splice(i, 1);
    return r;
  }
  if (action === "discard" && t.dishId) {
    const r = discardDish(s, t.dishId);
    if (!r.ok) return r;
  }
  s.workshop.tastings.splice(i, 1);
  return { ok: true, note: action === "keep" ? "收進食譜本了" : "處理好了" };
}

// ───────── 日結算 ─────────

export function workshopDaily(s: MallState): void {
  const listed = new Set<string>();
  const hot: { persona: PersonaId }[] = [];
  for (const shop of s.shops) {
    for (const e of shop.menu) {
      listed.add(e.dishId);
      e.novelty = Math.max(MENU_NOVELTY_FLOOR, e.novelty - MENU_NOVELTY_DECAY[e.signature ? "signature" : "original"]);
      if (e.signature && e.novelty >= 40) {
        const best = Object.entries(e.appeal).sort((a, b) => b[1] - a[1])[0];
        if (best) hot.push({ persona: best[0] as PersonaId });
      }
    }
  }
  // 沒上架的作品慢慢回復新鮮度（收起來一陣子再推出，客人又覺得新鮮）
  for (const d of s.workshop.dishes) if (!listed.has(d.id)) d.novelty = Math.min(100, d.novelty + 3);
  // 招牌帶來的口碑（有上限）
  let budget = SIGNATURE_IDX_CAP;
  for (const h of hot) {
    const amt = Math.min(SIGNATURE_IDX_DAILY, budget);
    if (amt <= 0) break;
    applyPersonaIndex(s, h.persona, amt);
    budget -= amt;
  }
}
