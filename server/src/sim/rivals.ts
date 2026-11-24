import {
  CAMPAIGNS,
  MAX_RIVAL_NEWS,
  PERSONA_IDS,
  RIVAL_AUTO_AGGRESSIVE_COST,
  RIVAL_AUTO_DEFENSE_COST,
  RIVAL_BY_ID,
  RIVAL_COUNTER_COST,
  RIVAL_INTEL_COST,
  RIVAL_INTEL_TICKS,
  RIVAL_MEAN_DAYS,
  RIVAL_PACT_COST,
  RIVAL_PACT_TICKS,
  rivalTarget,
  type MallState,
  type RivalCampaign,
  type RivalCampaignKind,
  type RivalState,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import type { GuestResult } from "./guests";
import { createRng, hash32, type Rng } from "./rng";
import { addLog } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

function pushNews(s: MallState, text: string): void {
  s.rivals.news.unshift({ tick: s.tick, text });
  if (s.rivals.news.length > MAX_RIVAL_NEWS) s.rivals.news.length = MAX_RIVAL_NEWS;
  addLog(s, "info", `📰 ${text}`);
}

function nextGap(rng: Rng): number {
  return Math.round(RIVAL_MEAN_DAYS * 288 * (0.6 + 0.8 * rng.next()));
}

/** 每個 tick：結束到期的活動，輪到的對手出招 */
export function rivalsTick(s: MallState, rng: Rng): void {
  for (const r of s.rivals.list) {
    const def = RIVAL_BY_ID[r.id];
    if (!def) continue;

    if (r.campaign && r.campaign.endTick <= s.tick) {
      const c = CAMPAIGNS[r.campaign.kind];
      r.campaign = null;
      addLog(s, "info", `📰 「${def.name}」的${c.name}告一段落了。`);
    }
    if (r.campaign) continue;

    const due = s.rivals.nextAt[r.id] ?? s.tick + RIVAL_MEAN_DAYS * 288;
    if (s.tick < due) continue;
    // 簽了合作協議的對手，協議期間不會找你麻煩
    if (r.pactUntil > s.tick) {
      s.rivals.nextAt[r.id] = r.pactUntil + nextGap(rng);
      continue;
    }
    s.rivals.nextAt[r.id] = s.tick + nextGap(rng);

    const kinds: RivalCampaignKind[] = rng.chance(0.1) ? ["scandal"] : def.campaigns;
    const kind = kinds[rng.int(0, kinds.length - 1)] ?? "grand_opening";
    startCampaign(s, r, kind, rng);
  }
}

function startCampaign(s: MallState, r: RivalState, kind: RivalCampaignKind, rng: Rng): void {
  const def = RIVAL_BY_ID[r.id]!;
  const c = CAMPAIGNS[kind];
  const campaign: RivalCampaign = {
    kind,
    startTick: s.tick,
    endTick: s.tick + rng.int(c.ticks[0], c.ticks[1]),
    boost: { ...c.boost },
    factor: 1,
  };
  r.campaign = campaign;
  const text = c.news.replaceAll("{rival}", def.name);
  pushNews(s, text);
  note(s, text);

  // 醜聞是對手自己的事；其餘依你的「商戰姿態」自動應對
  if (kind === "scandal") return;
  const stance = s.rivals.stance;
  if (stance === "defend" && s.funds >= RIVAL_AUTO_DEFENSE_COST) {
    s.funds -= RIVAL_AUTO_DEFENSE_COST;
    s.today.purchases += RIVAL_AUTO_DEFENSE_COST;
    campaign.factor = 0.5;
    addLog(s, "info", `🛡 依「防守」姿態自動推出應對方案（花 ${money(RIVAL_AUTO_DEFENSE_COST)}），衝擊減半。`);
  } else if (stance === "aggressive" && s.funds >= RIVAL_AUTO_AGGRESSIVE_COST) {
    s.funds -= RIVAL_AUTO_AGGRESSIVE_COST;
    s.today.purchases += RIVAL_AUTO_AGGRESSIVE_COST;
    campaign.factor = 0.5;
    applyIndexDelta(s, "localRep", 0.3);
    applyIndexDelta(s, "touristHeat", 0.3);
    addLog(s, "info", `⚔️ 依「進攻」姿態自動發動反擊廣告（花 ${money(RIVAL_AUTO_AGGRESSIVE_COST)}），衝擊減半，還順便打響了名號。`);
  }
}

/** 每天：對手的實力慢慢向「與你的等級相稱」的水準靠攏，帶一點隨機起伏 */
export function rivalsDaily(s: MallState): void {
  const rng = createRng(hash32(s.seed ^ 0x51a1, s.tick));
  for (const r of s.rivals.list) {
    const def = RIVAL_BY_ID[r.id];
    if (!def) continue;
    const target = rivalTarget(def, s.level);
    for (const p of PERSONA_IDS) {
      const goal = target * (def.profile[p] ?? 1);
      r.appeal[p] = clamp(Math.round((r.appeal[p] + (goal - r.appeal[p]) * 0.06 + rng.gauss() * 0.5) * 10) / 10, 10, 95);
    }
  }
}

// ───────── 玩家指令 ─────────

function findRival(s: MallState, id: string): RivalState | undefined {
  return s.rivals.list.find((r) => r.id === id);
}

export function rivalIntel(s: MallState, id: string): GuestResult {
  const r = findRival(s, id);
  const def = RIVAL_BY_ID[id];
  if (!r || !def) return { ok: false, error: "找不到這個對手" };
  if (r.intelUntil > s.tick) return { ok: false, error: "已經掌握他們的情報了" };
  if (s.funds < RIVAL_INTEL_COST) return { ok: false, error: "資金不足" };
  s.funds -= RIVAL_INTEL_COST;
  s.today.purchases += RIVAL_INTEL_COST;
  r.intelUntil = s.tick + RIVAL_INTEL_TICKS;
  return { ok: true, note: `派人混進「${def.name}」打探了一番。` };
}

export function rivalPact(s: MallState, id: string): GuestResult {
  const r = findRival(s, id);
  const def = RIVAL_BY_ID[id];
  if (!r || !def) return { ok: false, error: "找不到這個對手" };
  if (r.pactUntil > s.tick) return { ok: false, error: "已經有合作協議了" };
  if (r.campaign && r.campaign.kind !== "scandal") return { ok: false, error: "對方正在大張旗鼓辦活動，現在談不攏" };
  if (s.funds < RIVAL_PACT_COST) return { ok: false, error: "資金不足" };
  s.funds -= RIVAL_PACT_COST;
  s.today.purchases += RIVAL_PACT_COST;
  r.pactUntil = s.tick + RIVAL_PACT_TICKS;
  s.rivals.nextAt[id] = Math.max(s.rivals.nextAt[id] ?? 0, r.pactUntil);
  pushNews(s, `你與「${def.name}」簽下合作協議，雙方聯名宣傳、互相導客。`);
  return { ok: true, note: `和「${def.name}」握手言和。` };
}

export function rivalCounter(s: MallState, id: string): GuestResult {
  const r = findRival(s, id);
  const def = RIVAL_BY_ID[id];
  if (!r || !def) return { ok: false, error: "找不到這個對手" };
  const c = r.campaign;
  if (!c || c.endTick <= s.tick || c.kind === "scandal") return { ok: false, error: "對方現在沒有需要反制的活動" };
  if (c.factor < 1) return { ok: false, error: "已經反制過了" };
  if (s.funds < RIVAL_COUNTER_COST) return { ok: false, error: "資金不足" };
  s.funds -= RIVAL_COUNTER_COST;
  s.today.purchases += RIVAL_COUNTER_COST;
  c.factor = 0.5;
  addLog(s, "info", `🛡 針對「${def.name}」的${CAMPAIGNS[c.kind].name}推出反制，衝擊減半。`);
  return { ok: true, note: "反制方案上線，對方的攻勢被削弱了。" };
}
