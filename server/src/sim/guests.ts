import {
  CATEGORY_BY_ID,
  COMPLAINT_CAUSES,
  COMPLAINT_DEADLINE_TICKS,
  COMPLAINT_OPTIONS,
  GRIEVANCE_COOLDOWN_TICKS,
  LATE_PENALTY,
  MAX_OPEN_COMPLAINTS,
  MAX_OPEN_REVIEWS,
  MAX_REVIEW_LOG,
  PERSONA_IDS,
  PERSONA_TAG,
  REVIEW_DEADLINE_TICKS,
  REVIEW_REPLIES,
  REVIEW_TEXTS,
  WALK_COOLDOWN_TICKS,
  WALK_SITUATIONS,
  WALK_VOICE_TTL_TICKS,
  categoryHasStock,
  techFx,
  complaintCost,
  complaintIdx,
  defaultComplaintOption,
  reviewIdx,
  type ComplaintCause,
  type ComplaintTone,
  type InboxItem,
  type MallState,
  type PersonaId,
  type ReviewReplyId,
  type Shop,
  type WalkVoice,
} from "@coidle/shared";
import { applyPersonaIndex } from "./events";
import { flavor } from "./flavor";
import { createRng, hash32, type Rng } from "./rng";
import { addLog, nextId, shopCapacity } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 每個遊戲日最多收到幾則客訴（避免收件匣被洗版；多的不滿只會悶在心裡） */
export const MAX_COMPLAINTS_PER_DAY = 3;

export type GuestResult = { ok: true; note: string } | { ok: false; error: string };

// ───────── 客訴 ─────────

/** 某個客人遇到不愉快的事。累積到一定程度就變成一則客訴。 */
export function noteGrievance(s: MallState, rng: Rng, shop: Shop, persona: PersonaId, cause: ComplaintCause): void {
  const def = COMPLAINT_CAUSES[cause];
  const key = `${shop.id}:${cause}`;
  const cdKey = `griev:${key}`;
  if ((s.cooldowns[cdKey] ?? 0) > s.tick) return;
  const n = (s.grievances[key] ?? 0) + techFx(s.tech.done).complaintMult; // 機器人巡檢能提早處理，不滿累積得比較慢
  if (n < def.threshold) {
    s.grievances[key] = n;
    return;
  }
  s.grievances[key] = 0;
  s.cooldowns[cdKey] = s.tick + GRIEVANCE_COOLDOWN_TICKS;
  if (s.today.complaints >= MAX_COMPLAINTS_PER_DAY) return;
  if (s.inbox.filter((i) => i.kind === "complaint").length >= MAX_OPEN_COMPLAINTS) return;
  createComplaint(s, rng, shop, persona, cause);
}

function pickTone(rng: Rng, cause: ComplaintCause): ComplaintTone {
  const w = cause === "price" ? [0.4, 0.3, 0.3] : [0.5, 0.35, 0.15];
  return (["sincere", "angry", "demanding"] as const)[rng.weighted(w)] ?? "sincere";
}

function createComplaint(s: MallState, rng: Rng, shop: Shop, persona: PersonaId, cause: ComplaintCause): void {
  const tone = pickTone(rng, cause);
  const texts = COMPLAINT_CAUSES[cause].texts[tone];
  const text = (texts[rng.int(0, texts.length - 1)] ?? "").replaceAll("{shop}", shop.name);
  s.inbox.push({
    uid: nextId(s, "in"),
    kind: "complaint",
    createdTick: s.tick,
    deadlineTick: s.tick + COMPLAINT_DEADLINE_TICKS,
    shopId: shop.id,
    persona,
    text,
    cause,
    tone,
  });
  s.today.complaints++;
  addLog(s, "warn", `📣 「${shop.name}」收到一則客訴（${COMPLAINT_CAUSES[cause].label}）`);
}

/**
 * 這位是不是奧客：由種子與編號決定（不存進狀態，所以玩家無法從資料裡偷看；
 * 只能從「語氣」判斷）。
 */
export function isUnreasonable(s: MallState, item: InboxItem): boolean {
  const n = Number(item.uid.replace(/\D/g, ""));
  const roll = createRng(hash32(s.seed ^ 0x51ed, n)).next();
  const p = item.tone === "demanding" ? 0.7 : item.tone === "angry" ? 0.12 : 0.03;
  return roll < p;
}

// ───────── 收件匣處理（客訴／評價） ─────────

/** optionId 為 null＝逾期，依處理偏好自動處理 */
export function resolveInbox(s: MallState, uid: string, optionId: string | null): GuestResult {
  const at = s.inbox.findIndex((i) => i.uid === uid);
  const item = s.inbox[at];
  if (!item) return { ok: false, error: "這件事已經處理過了" };
  const byDefault = optionId === null;

  if (item.kind === "complaint") {
    const shop = s.shops.find((x) => x.id === item.shopId);
    const price = shop?.price ?? 1000;
    let opt = optionId ?? defaultComplaintOption(item.tone ?? "sincere", s.guestPrefs.complaintStance);
    if (!COMPLAINT_OPTIONS.some((o) => o.id === opt)) return { ok: false, error: "處理方式無效" };
    let cost = complaintCost(opt, price);
    if (cost > s.funds) {
      if (!byDefault) return { ok: false, error: "資金不足" };
      opt = "apologize"; // 自動處理時錢不夠，退回免費的道歉
      cost = 0;
    }
    const unreasonable = isUnreasonable(s, item);
    let delta = complaintIdx(opt, unreasonable);
    if (byDefault) delta -= LATE_PENALTY;
    s.funds -= cost;
    s.today.purchases += cost;
    applyPersonaIndex(s, item.persona, delta);
    s.inbox.splice(at, 1);
    const label = COMPLAINT_OPTIONS.find((o) => o.id === opt)?.label ?? opt;
    addLog(s, "info", `客訴${byDefault ? "（逾期，依偏好自動處理）" : ""}：「${shop?.name ?? "某店"}」→ ${label}${cost ? `（花 ${cost.toLocaleString("en-US")}）` : ""}`);
    return { ok: true, note: unreasonable && !byDefault ? `${label}。（事後才發現對方可能是來鬧的……）` : `${label}。` };
  }

  // 評價
  const stars = item.stars ?? 3;
  let reply: ReviewReplyId | "auto" | null;
  if (byDefault) reply = s.guestPrefs.autoReplyReviews ? "auto" : null;
  else if (REVIEW_REPLIES.some((r) => r.id === optionId)) reply = optionId as ReviewReplyId;
  else return { ok: false, error: "回覆方式無效" };
  if (reply !== null) applyPersonaIndex(s, item.persona, reviewIdx(reply, stars));
  s.inbox.splice(at, 1);
  s.reviewLog.unshift({
    tick: s.tick,
    persona: item.persona,
    stars,
    text: item.text,
    shopName: s.shops.find((x) => x.id === item.shopId)?.name ?? null,
    reply,
  });
  if (s.reviewLog.length > MAX_REVIEW_LOG) s.reviewLog.length = MAX_REVIEW_LOG;
  return { ok: true, note: reply === "ignore" || reply === null ? "沒有回覆。" : "回覆已送出。" };
}

export function resolveInboxDeadlines(s: MallState): void {
  for (const item of s.inbox.slice()) {
    if (item.deadlineTick <= s.tick) resolveInbox(s, item.uid, null);
  }
}

// ───────── 每日評價 ─────────

/** 日結算前：把今天客人的感受變成幾則線上評價 */
export function generateDailyReviews(s: MallState): void {
  const d = s.today;
  if (s.shops.length === 0 || d.groups === 0) return;
  const rng = createRng(hash32(s.seed ^ 0x7a31, s.tick));
  const count = clamp(Math.round(d.groups / 200), 1, 5);
  const weights = PERSONA_IDS.map((p) => (d.satN[p] > 0 ? d.groupsByPersona[p] : 0));

  for (let i = 0; i < count; i++) {
    const pi = rng.weighted(weights);
    const persona = PERSONA_IDS[pi];
    if (!persona) break;
    const avg = d.satSum[persona] / d.satN[persona];
    const stars = clamp(Math.round(avg * 6 + rng.gauss() * 0.8), 1, 5);
    const bucket = stars >= 4 ? "high" : stars === 3 ? "mid" : "low";
    const shopW = s.shops.map((sh) => (bucket === "low" ? sh.day.stockouts + sh.day.lost + 1 : sh.day.revenue + 1));
    const shop = s.shops[rng.weighted(shopW)];
    // 一半的評價用 AI 內容池裡的句子（有的話），其餘用手寫的，風格才不會一成不變
    const pooled = flavor().reviews(bucket);
    const texts = pooled.length > 0 && rng.chance(0.5) ? pooled : REVIEW_TEXTS[bucket];
    const text = `${(texts[rng.int(0, texts.length - 1)] ?? "").replaceAll("{shop}", shop?.name ?? "這裡")}（${PERSONA_TAG[persona]}）`;
    // 收件匣太滿時，最舊的先依偏好自動處理掉
    while (s.inbox.filter((x) => x.kind === "review").length >= MAX_OPEN_REVIEWS) {
      const oldest = s.inbox.find((x) => x.kind === "review");
      if (!oldest) break;
      resolveInbox(s, oldest.uid, null);
    }
    s.inbox.push({
      uid: nextId(s, "in"),
      kind: "review",
      createdTick: s.tick,
      deadlineTick: s.tick + REVIEW_DEADLINE_TICKS,
      shopId: shop?.id ?? null,
      persona,
      text,
      stars,
    });
    d.reviews++;
    d.starsSum += stars;
  }
}

// ───────── 巡場 ─────────

interface Candidate {
  shop: Shop;
  situation: string;
  weight: number;
}

function candidatesFor(s: MallState, shop: Shop): Candidate[] {
  const cat = CATEGORY_BY_ID[shop.category];
  if (!cat) return [];
  const out: Candidate[] = [];
  const stocked = categoryHasStock(cat) && shop.mode === "direct";
  if (stocked && shop.stock < 30) out.push({ shop, situation: "stockout", weight: shop.stock < 1 ? 5 : 3 });
  if (shop.day.lost > 0) out.push({ shop, situation: "queue", weight: 3 });
  else if (shop.served >= shopCapacity(shop, s) * 0.7) out.push({ shop, situation: "queue", weight: 2 });
  if (s.cleanliness < 55) out.push({ shop, situation: "dirty", weight: 2 });
  if (shop.price > cat.refPrice * 1.2) out.push({ shop, situation: "pricey", weight: 2 });
  out.push({ shop, situation: "happy", weight: shop.freshness > 50 ? 2 : 0.5 });
  out.push({ shop, situation: "lost", weight: 0.8 });
  return out;
}

export function walkFloor(s: MallState, rng: Rng, open: boolean): GuestResult {
  if (!open) return { ok: false, error: "商場打烊中，店裡沒有客人可以聊" };
  if (s.tick < s.walk.nextTick) return { ok: false, error: "剛巡過場，客人還沒換一批，等一下再來" };
  const shops = s.shops.filter((x) => x.closedUntilTick <= s.tick);
  if (shops.length === 0) return { ok: false, error: "現在沒有營業中的店" };

  const pool = shops.flatMap((sh) => candidatesFor(s, sh));
  const voices: WalkVoice[] = [];
  const perShop = new Map<string, number>();
  const want = rng.int(3, 5);
  while (voices.length < want && pool.length > 0) {
    const i = rng.weighted(pool.map((c) => c.weight));
    const c = pool.splice(i, 1)[0];
    if (!c) break;
    if ((perShop.get(c.shop.id) ?? 0) >= 2) continue;
    perShop.set(c.shop.id, (perShop.get(c.shop.id) ?? 0) + 1);
    const sit = WALK_SITUATIONS[c.situation];
    if (!sit) continue;
    const personaW = PERSONA_IDS.map((p) => s.today.groupsByPersona[p] + 1);
    const persona = c.situation === "lost" ? "tourist" : (PERSONA_IDS[rng.weighted(personaW)] ?? "local");
    voices.push({
      id: nextId(s, "wv"),
      shopId: c.shop.id,
      persona,
      mood: sit.mood,
      situation: sit.id,
      text: (sit.texts[rng.int(0, sit.texts.length - 1)] ?? "").replaceAll("{shop}", c.shop.name),
      expireTick: s.tick + WALK_VOICE_TTL_TICKS,
    });
  }
  s.walk = { nextTick: s.tick + WALK_COOLDOWN_TICKS, voices };
  return { ok: true, note: `聽到 ${voices.length} 位客人的心聲` };
}

export function walkAct(s: MallState, voiceId: string, optionId: string): GuestResult {
  const at = s.walk.voices.findIndex((v) => v.id === voiceId);
  const voice = s.walk.voices[at];
  if (!voice) return { ok: false, error: "這位客人已經離開了" };
  if (voice.expireTick < s.tick) {
    s.walk.voices.splice(at, 1);
    return { ok: false, error: "這位客人已經離開了" };
  }
  const opt = WALK_SITUATIONS[voice.situation]?.options.find((o) => o.id === optionId);
  if (!opt) return { ok: false, error: "做法無效" };
  if (opt.cost > s.funds) return { ok: false, error: "資金不足" };
  s.funds -= opt.cost;
  s.today.purchases += opt.cost;
  applyPersonaIndex(s, voice.persona, opt.idx);
  if (opt.clean) s.cleanliness = clamp(s.cleanliness + opt.clean, 0, 100);
  s.walk.voices.splice(at, 1);
  return { ok: true, note: opt.label };
}
