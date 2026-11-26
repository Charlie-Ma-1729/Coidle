import {
  INSURANCE,
  LATE_DAMAGES_RATE,
  LEGAL_COOLDOWN_DAYS,
  LEGAL_KINDS,
  LEGAL_STAGES,
  MAX_CLOSED_KEPT,
  MAX_OPEN_CASES,
  MEDIATION_NOSHOW_FINE,
  MEMBER_PRIVACY_MIN,
  TICKS_PER_DAY,
  SMALL_CLAIM_LIMIT,
  defaultLegalOption,
  insurancePayout,
  issueEvidencePenalty,
  issueLegalHazard,
  judgmentOdds,
  lawyerFee,
  legalKindsFor,
  legalOptions,
  plaintiffStrength,
  settleChance,
  stageDeadline,
  type ClosedCase,
  type ComplaintCause,
  type ComplaintTone,
  type LawsuitCase,
  type LegalKind,
  type LegalState,
  type LegalStage,
  type MallState,
  type Shop,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import { regularHelp, recordHelp } from "./regulars";
import { createRng, hash32, type Rng } from "./rng";
import { addLog, nextId } from "./state";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;
const digits = (uid: string) => Number(uid.replace(/\D/g, "")) || 0;

export type LegalResult = { ok: true; note: string } | { ok: false; error: string };

export function newLegalState(): LegalState {
  return { cases: [], closed: [], insurance: 0, nextAt: 0, totalPaid: 0, totalInsured: 0 };
}

/** 舊存檔沒有 legal：第一次用到時補上（可選欄位，不用升存檔版本） */
export function legalOf(s: MallState): LegalState {
  if (!s.legal) s.legal = newLegalState();
  return s.legal;
}

function note(s: MallState, text: string): void {
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
}

// ───────── 原告占不占理（隱藏，由種子與語氣決定） ─────────

/** 0–1：對方「真正有多占理」。玩家看不到，只能從客訴語氣猜；律師與證據只影響判決，不影響這個真相。 */
export function faultOf(s: MallState, c: Pick<LawsuitCase, "uid" | "tone">): number {
  const r = createRng(hash32(s.seed ^ 0x1a77, digits(c.uid))).next();
  const [lo, hi] = c.tone === "demanding" ? [0.1, 0.6] : c.tone === "angry" ? [0.35, 0.8] : c.tone === "sincere" ? [0.55, 0.95] : [0.45, 0.95];
  return lo + r * (hi - lo);
}

function strength(s: MallState, c: LawsuitCase): number {
  return plaintiffStrength(faultOf(s, c), c.evidence, c.lawyer);
}

/** 我方證據力：清潔、設備、合規分數與店面狀態（成立當下的快照） */
function evidenceOf(s: MallState, shop: Shop | null): number {
  const comp = s.inspections?.compliance ?? 60;
  const fresh = shop ? (shop.freshness - 50) * 0.1 : 0;
  // 還沒處理的巡店問題（髒、過期、設備不良……）會讓你在法庭上很難看
  const issues = shop ? issueEvidencePenalty(s.patrol, shop.id) : 0;
  return clamp(Math.round(20 + 0.3 * s.cleanliness + 0.2 * s.equipment + 0.25 * comp + fresh - issues), 10, 95);
}

// ───────── 成立案件 ─────────

export function openCaseCount(s: MallState): number {
  return s.legal?.cases.length ?? 0;
}

/**
 * 惹上官司。同時最多 MAX_OPEN_CASES 件，且兩件之間有冷卻；成立回傳案件，否則 null。
 * rng 只用來決定請求金額與原告姓名（原告占不占理由案件編號決定）。
 */
export function openCase(s: MallState, rng: Rng, shop: Shop, kind: LegalKind, tone: ComplaintTone | null): LawsuitCase | null {
  const lg = legalOf(s);
  if (lg.cases.length >= MAX_OPEN_CASES || s.tick < lg.nextAt) return null;
  const def = LEGAL_KINDS[kind];
  const [lo, hi] = def.claim;
  const scale = 0.8 + 0.15 * Math.max(1, shop.level);
  const claim = Math.max(10_000, Math.round((lo + rng.next() * (hi - lo)) * scale / 10_000) * 10_000);
  const plaintiff = `${def.plaintiffs[rng.int(0, def.plaintiffs.length - 1)] ?? "田島"}${rng.chance(0.5) ? "さん" : "様"}`;
  // 老主顧肯出來說話（作證、說情）：證據力加分，並記在那些熟客的貢獻裡
  const help = regularHelp(s, shop);
  const c: LawsuitCase = {
    uid: nextId(s, "lw"),
    kind,
    shopId: shop.id,
    shopName: shop.name,
    plaintiff,
    claim,
    stage: "demand",
    createdTick: s.tick,
    stageTick: s.tick,
    deadlineTick: s.tick + stageDeadline("demand", claim),
    evidence: clamp(evidenceOf(s, shop) + Math.min(9, Math.round(3 * help)), 10, 100),
    lawyer: false,
    insured: lg.insurance,
    tone,
    history: [{ tick: s.tick, text: `${plaintiff}から「${shop.name}」宛てに内容証明郵便が届いた：${def.label}、請求額 ${money(claim)}。` }],
  };
  if (help > 0) {
    recordHelp(s, shop);
    c.history.push({ tick: s.tick, text: "幾位老主顧聽說了這件事，表示願意為店裡說句話（證據力提高）。" });
  }
  lg.cases.push(c);
  lg.nextAt = s.tick + LEGAL_COOLDOWN_DAYS * TICKS_PER_DAY;
  const text = `⚖️ 「${shop.name}」收到${plaintiff}的請求書：${def.label}，請求 ${money(claim)}。要在 ${LEGAL_STAGES.demand.days} 天內回應。`;
  addLog(s, "warn", text);
  note(s, text);
  return c;
}

/** 指定業態可能遇到的糾紛（沒有就回傳空陣列） */
function kindsOfShop(shop: Shop): LegalKind[] {
  return legalKindsFor(shop.category);
}

// ───────── 觸發 ─────────

/** 事件效果：有機率（p）讓一間符合該糾紛種類的直營店惹上官司 */
export function applyLegalRisk(s: MallState, kind: LegalKind, p: number, rng: Rng): void {
  if (!(kind in LEGAL_KINDS) || !rng.chance(clamp(p, 0, 0.9))) return;
  const shops = s.shops.filter((x) => x.mode === "direct" && x.tenant === null && kindsOfShop(x).includes(kind));
  const shop = shops[rng.int(0, shops.length - 1)];
  if (shop) openCase(s, rng, shop, kind, null);
}

const CAUSE_KINDS: Partial<Record<ComplaintCause, LegalKind[]>> = {
  dirty: ["food_poison", "injury"],
  facility: ["injury", "lodging"],
  quality: ["food_poison", "allergy", "defect", "malpractice", "contract"],
  price: ["misleading", "contract"],
};

/** 客訴處理完之後：處理不當的嚴重客訴，有機率升級成法律糾紛 */
export function maybeEscalateComplaint(s: MallState, args: { uid: string; shopId: string | null; cause: ComplaintCause | undefined; tone: ComplaintTone | undefined; option: string; byDefault: boolean; unreasonable: boolean }): void {
  const shop = s.shops.find((x) => x.id === args.shopId);
  if (!shop || shop.mode !== "direct" || !args.cause) return;
  const pool = (CAUSE_KINDS[args.cause] ?? []).filter((k) => kindsOfShop(shop).includes(k));
  if (pool.length === 0) return;
  const toneP = args.tone === "demanding" ? 0.04 : args.tone === "angry" ? 0.022 : 0.006;
  const optP = args.option === "decline" ? 2.5 : args.option === "refund" ? 0.35 : args.option === "comp" ? 0.5 : 1;
  const p = clamp((toneP * optP * (args.byDefault ? 1.5 : 1) * (args.unreasonable ? 1.3 : 1)) / (1 + 0.25 * regularHelp(s, shop)), 0, 0.5);
  const rng = createRng(hash32(s.seed ^ 0x1e9a1, digits(args.uid) * 13 + 1));
  if (!rng.chance(p)) return;
  openCase(s, rng, shop, pool[rng.int(0, pool.length - 1)]!, args.tone ?? null);
}

// ───────── 每天 ─────────

/** 每日：收保險費；管理不善的商場有機率直接收到請求書（髒、設備差、合規分數低都會拉高） */
export function legalDaily(s: MallState): void {
  const lg = legalOf(s);
  const direct = s.shops.filter((x) => x.mode === "direct");
  const prem = (INSURANCE[lg.insurance] ?? INSURANCE[0]!).premium * direct.length;
  if (prem > 0) {
    s.funds -= prem;
    s.today.fixed += prem;
  }
  if (lg.cases.length >= MAX_OPEN_CASES || s.tick < lg.nextAt || direct.length === 0) return;
  const comp = s.inspections?.compliance ?? 60;
  const dirty = Math.max(0, (45 - s.cleanliness) / 45);
  const worn = Math.max(0, (45 - s.equipment) / 45);
  const lax = Math.max(0, (50 - comp) / 50);
  const rng = createRng(hash32(s.seed ^ 0x1eca, s.tick));
  // 會員資料是個資：人數越多，外洩的風險越高
  const memberCount = s.members?.count ?? 0;
  if (memberCount >= MEMBER_PRIVACY_MIN) {
    const holders = direct.filter((sh) => kindsOfShop(sh).includes("privacy"));
    if (holders.length > 0 && rng.chance(0.00004 * Math.sqrt(memberCount))) {
      openCase(s, rng, holders[rng.int(0, holders.length - 1)]!, "privacy", null);
      return;
    }
  }
  // 巡店沒處理的問題（見 shared/patrol.ts）也會拉高這間店的官司風險，而且糾紛的種類跟問題對得上
  const hazards = direct.map((sh) => issueLegalHazard(s.patrol, sh.id));
  const weights = direct.map((sh, i) => (kindsOfShop(sh).length > 0 ? 0.0004 + 0.0025 * dirty + 0.0025 * worn + 0.0018 * lax + hazards[i]!.total : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || !rng.chance(clamp(total, 0, 0.5))) return;
  const at = rng.weighted(weights);
  const shop = direct[at];
  if (!shop) return;
  const kinds = kindsOfShop(shop);
  const h = hazards[at]!;
  // 這間店有相關的問題時，多半就是它惹的禍
  const fromIssue = h.kinds.length > 0 && rng.chance(h.total / weights[at]!) ? h.kinds[rng.weighted(h.kinds.map((x) => x[1]))]?.[0] : undefined;
  openCase(s, rng, shop, fromIssue && kinds.includes(fromIssue) ? fromIssue : kinds[rng.int(0, kinds.length - 1)]!, null);
}

export function resolveLegalDeadlines(s: MallState): void {
  if (!s.legal || s.legal.cases.length === 0) return;
  for (const c of s.legal.cases.slice()) {
    if (c.deadlineTick <= s.tick) resolveLegal(s, c.uid, null);
  }
}

// ───────── 玩家處理 ─────────

export function setInsurance(s: MallState, level: number): LegalResult {
  if (!Number.isInteger(level) || level < 0 || level >= INSURANCE.length) return { ok: false, error: "保險等級無效" };
  const lg = legalOf(s);
  if (lg.insurance === level) return { ok: false, error: "已經是這個保險方案了" };
  lg.insurance = level;
  addLog(s, "info", `🛡️ 賠償責任保險改為「${INSURANCE[level]!.name}」。已成立的案件仍照成立當時的投保等級給付。`);
  return { ok: true, note: `已改為「${INSURANCE[level]!.name}」。` };
}

function history(s: MallState, c: LawsuitCase, text: string): void {
  c.history.push({ tick: s.tick, text });
  if (c.history.length > 14) c.history.shift();
}

/** 賠償金／和解金：保險先給付，剩下的自己付。回傳實際自付 */
function payDamages(s: MallState, c: LawsuitCase, amount: number): { net: number; payout: number } {
  const payout = Math.round(insurancePayout(c.insured, amount));
  const net = Math.max(0, Math.round(amount) - payout);
  spend(s, net);
  const lg = legalOf(s);
  lg.totalInsured += payout;
  return { net, payout };
}

/** 律師費、過料這類不能申請保險的支出 */
function payCost(s: MallState, amount: number): void {
  spend(s, Math.round(amount));
}

function spend(s: MallState, amount: number): void {
  if (amount <= 0) return;
  s.funds -= amount;
  s.today.repairs += amount;
  s.today.legalCost = (s.today.legalCost ?? 0) + amount;
  legalOf(s).totalPaid += amount;
}

function closeCase(s: MallState, c: LawsuitCase, outcome: ClosedCase["outcome"], result: string, paid: number, insurer: number, fee: number): void {
  const lg = legalOf(s);
  lg.cases = lg.cases.filter((x) => x.uid !== c.uid);
  lg.closed.unshift({ uid: c.uid, kind: c.kind, shopName: c.shopName, plaintiff: c.plaintiff, claim: c.claim, paid, insurer, lawyerFee: fee, closedTick: s.tick, result, outcome });
  if (lg.closed.length > MAX_CLOSED_KEPT) lg.closed.length = MAX_CLOSED_KEPT;
  history(s, c, result);
  addLog(s, outcome === "lost" || outcome === "partial" ? "warn" : "info", `⚖️ ${c.shopName}・${LEGAL_KINDS[c.kind].label}：${result}`);
}

function toStage(s: MallState, c: LawsuitCase, stage: LegalStage, text: string): void {
  c.stage = stage;
  c.stageTick = s.tick;
  c.deadlineTick = s.tick + stageDeadline(stage, c.claim);
  history(s, c, text);
  const label = stage === "trial" ? (c.claim <= SMALL_CLAIM_LIMIT ? "少額訴訟" : "訴訟") : LEGAL_STAGES[stage].label;
  const line = `⚖️ 「${c.shopName}」的糾紛進入「${label}」，要在 ${Math.round((c.deadlineTick - s.tick) / TICKS_PER_DAY)} 天內決定怎麼應對。`;
  addLog(s, "warn", line);
  note(s, line);
}

function forceInspection(s: MallState, c: LawsuitCase): void {
  const kind = LEGAL_KINDS[c.kind].inspection;
  if (!kind || !s.inspections) return;
  const cur = s.inspections.nextAt[kind];
  const soon = s.tick + 144;
  if (cur === undefined || cur > soon) s.inspections.nextAt[kind] = soon;
}

/**
 * 處理一件糾紛。optionId 為 null＝逾期，依「客訴處理偏好」自動選；
 * 自動處理時錢不夠，退回不用花錢的選項。亂數由 (seed, 案件, 階段) 決定，所以和處理的時間點無關。
 */
export function resolveLegal(s: MallState, uid: string, optionId: string | null): LegalResult {
  const c = legalOf(s).cases.find((x) => x.uid === uid);
  if (!c) return { ok: false, error: "這件案子已經結束了" };
  const byDefault = optionId === null;
  const options = legalOptions(c);
  let opt = options.find((o) => o.id === (optionId ?? defaultLegalOption(c.stage, s.guestPrefs.complaintStance)));
  if (!opt) return { ok: false, error: "處理方式無效" };
  if (opt.cost > s.funds) {
    if (!byDefault) return { ok: false, error: "資金不足" };
    opt = options.find((o) => o.cost === 0) ?? opt; // 逾期又沒錢：退回不花錢的選項
    if (opt.cost > s.funds) opt = options[options.length - 1]!;
  }
  const stageIdx = c.stage === "demand" ? 0 : c.stage === "mediation" ? 1 : 2;
  const rng = createRng(hash32(s.seed ^ 0x1e9a1, digits(c.uid) * 7 + stageIdx));
  const tag = byDefault ? "（逾期，依處理偏好自動處理）" : "";
  const claim = c.claim;
  let fee = 0;
  if (opt.id === "lawyer" && !c.lawyer) {
    fee = lawyerFee(claim);
    payCost(s, fee);
    c.lawyer = true;
    history(s, c, `委任律師（律師費 ${money(fee)}）。`);
  }
  const x = strength(s, c);
  const finish = (outcome: ClosedCase["outcome"], text: string, amount: number): LegalResult => {
    const { net, payout } = payDamages(s, c, amount);
    const extra = payout > 0 ? `，保險給付 ${money(payout)}` : "";
    const result = `${text}（賠償 ${money(amount)}${extra}，自付 ${money(net)}${fee ? `，另付律師費 ${money(fee)}` : ""}）`;
    closeCase(s, c, outcome, result, net, payout, fee);
    return { ok: true, note: `${result}${tag}` };
  };

  if (c.stage === "demand") {
    if (opt.id === "settle") return finish("settled", "簽下示談書，案件結束", claim * 0.8);
    if (opt.id === "negotiate" || opt.id === "lawyer") {
      const chance = settleChance(x, 0.2, opt.id === "lawyer" ? 0.2 : 0);
      if (rng.next() < chance) return finish("settled", `${opt.id === "lawyer" ? "律師交涉" : "當面協商"}後達成和解`, claim * (opt.id === "lawyer" ? 0.3 : 0.35));
      toStage(s, c, "mediation", `${opt.id === "lawyer" ? "律師交涉" : "協商"}破局，${c.plaintiff}向簡易裁判所聲請民事調停。`);
      return { ok: true, note: `協商破局，對方聲請了民事調停。${tag}` };
    }
    toStage(s, c, "mediation", `拒絕請求，${c.plaintiff}向簡易裁判所聲請民事調停。`);
    return { ok: true, note: `拒絕了請求，對方聲請了民事調停。${tag}` };
  }

  if (c.stage === "mediation") {
    if (opt.id === "settle") return finish("mediated", "接受調停條件，調停成立", claim * 0.5);
    if (opt.id === "skip") {
      payCost(s, MEDIATION_NOSHOW_FINE);
      applyIndexDelta(s, "localRep", -0.1);
      toStage(s, c, "trial", `無故缺席調停被處過料 ${money(MEDIATION_NOSHOW_FINE)}，調停不成立，${c.plaintiff}提起訴訟。`);
      return { ok: true, note: `缺席被罰 ${money(MEDIATION_NOSHOW_FINE)}，對方提起了訴訟。${tag}` };
    }
    const chance = settleChance(x, 0.1, opt.id === "lawyer" ? 0.2 : 0);
    if (rng.next() < chance) return finish("mediated", `${opt.id === "lawyer" ? "律師陪同" : "出席"}調停，調停成立`, claim * (opt.id === "lawyer" ? 0.3 : 0.35));
    toStage(s, c, "trial", `調停不成立，${c.plaintiff}提起${claim <= SMALL_CLAIM_LIMIT ? "少額訴訟" : "訴訟"}。`);
    return { ok: true, note: `調停不成立，對方提起了訴訟。${tag}` };
  }

  // 訴訟
  if (opt.id === "settle") return finish("settled", "法官勸諭下達成和解，案件結束", claim * 0.5);
  const odds = judgmentOdds(x);
  const roll = rng.next();
  if (roll < odds.dismiss) {
    applyIndexDelta(s, "localRep", 0.4);
    return finish("dismissed", "法院判決駁回原告請求，還了店家清白", 0);
  }
  if (roll < odds.dismiss + odds.partial) {
    applyIndexDelta(s, "localRep", -0.6);
    applyIndexDelta(s, "touristHeat", -0.3);
    return finish("partial", "法院部分認可原告請求，判決賠償一部分", claim * (0.35 + rng.next() * 0.3));
  }
  applyIndexDelta(s, "localRep", -1.6);
  applyIndexDelta(s, "touristHeat", -0.8);
  forceInspection(s, c);
  const res = finish("lost", "敗訴，判決全額賠償並加計遲延損害金，新聞也報導了", claim * (1 + LATE_DAMAGES_RATE));
  if (LEGAL_KINDS[c.kind].inspection) addLog(s, "warn", "⚖️ 敗訴後主管機關可能很快上門稽查。");
  return res;
}
