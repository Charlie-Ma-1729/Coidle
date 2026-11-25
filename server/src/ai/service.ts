import { createHash } from "node:crypto";
import { CATEGORIES, EVENTS, REGULARS, registerEvents, registerRegulars, type EventDef, type RegularDef } from "@coidle/shared";
import type { Repo } from "../db/repo";
import type { BrandFlavor, FlavorGroup, FlavorMood, FlavorSource, FlavorTier } from "../sim/flavor";
import { checkBrand, checkDish, checkEvent, checkNews, checkRegular, checkReview, NEWS_MOODS, REVIEW_TIERS, type Checked } from "./content";
import { SIMILAR_LIMIT, textSimilarity } from "./validate";
import { chat, extractJson, LlmError, type ChatMessage, type ChatResult } from "./openrouter";
import { brandPrompt, dishPrompt, eventPrompt, newsPrompt, regularPrompt, reviewPrompt } from "./prompts";

// AI 內容服務：離線批次生成 → 嚴格驗證 → 內容池。
// 絕不在玩家操作當下呼叫模型；預算耗盡或沒有金鑰就什麼都不做，遊戲照常用手寫內容。

export interface AiConfig {
  apiKey: string | null;
  model: string;
  /** 每 30 天的預算上限（美元）。實際用到上限的 85% 就停（留安全餘裕） */
  budgetUsd: number;
  /** 新事件是否自動上線（預設 false：要人工核准，因為事件會影響數值） */
  autoApproveEvents: boolean;
  /** 每 24 小時最多呼叫幾次 */
  dailyCallCap: number;
  /** 預算視窗的起點（ISO 時間轉成毫秒）；沒設就從第一次用到的那一刻起算 */
  budgetStart?: number | null;
  /** 這個視窗內已經在別處（例如開發機）花掉的金額，會一併計入 */
  spentElsewhereUsd?: number;
}

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const SAFETY = 0.85;
/** 單日花費上限：每月預算的 8%（避免一天燒掉大半） */
const DAILY_SHARE = 0.08;
/** 內容池目標數量 */
export const TARGETS = { newsPerMood: 12, reviewsPerTier: 12, eventsOpen: 4, eventsMax: 40, brandsTotal: 168, dishesTotal: 120, regularsOpen: 2, regularsMax: 12 } as const;

export type ChatFn = (o: Parameters<typeof chat>[0]) => Promise<ChatResult>;
export type ContentKind = "news" | "review" | "event" | "brand" | "dish" | "regular";

export interface BudgetStatus {
  windowStart: number;
  windowEnd: number;
  spentUsd: number;
  capUsd: number;
  remainingUsd: number;
  calls24h: number;
  spent24hUsd: number;
}

export interface GenResult {
  kind: ContentKind;
  ok: boolean;
  asked: number;
  accepted: number;
  rejected: string[];
  costUsd: number;
  error?: string;
}

const hashOf = (kind: string, text: string) => createHash("sha1").update(kind + "\n" + text).digest("hex");

export class ContentService {
  private news: Record<FlavorMood, string[]> = { good: [], bad: [], neutral: [], season: [] };
  private reviews: Record<FlavorTier, string[]> = { high: [], mid: [], low: [] };
  /** 招商品牌名：依業態 id 分類，簡介描述的就是那種店 */
  private brands: Record<string, BrandFlavor[]> = {};
  /** 原創商品名：依業態 id 分類，只有同業態的店會用到 */
  private dishes: Record<string, string[]> = {};
  private busy = false;

  constructor(
    private readonly repo: Repo,
    private readonly cfg: AiConfig,
    private readonly now: () => number = Date.now,
    private readonly chatFn: ChatFn = chat,
  ) {
    this.reload();
  }

  get enabled(): boolean {
    return !!this.cfg.apiKey;
  }

  // ───────── 預算 ─────────
  /** 預算視窗：第一次用到的那一刻起算 30 天，之後每 30 天一個視窗 */
  budget(): BudgetStatus {
    const t = this.now();
    let start = this.cfg.budgetStart ?? Number(this.repo.getMeta("ai_window_start") ?? 0);
    if (!start) {
      start = t;
      this.repo.setMeta("ai_window_start", String(start));
    }
    const len = WINDOW_DAYS * DAY;
    if (t >= start + len) {
      start += Math.floor((t - start) / len) * len;
      this.repo.setMeta("ai_window_start", String(start));
    }
    const spent = this.repo.ledgerSpent(start, start + len) + (this.cfg.spentElsewhereUsd ?? 0);
    const cap = this.cfg.budgetUsd * SAFETY;
    return {
      windowStart: start,
      windowEnd: start + len,
      spentUsd: spent,
      capUsd: cap,
      remainingUsd: Math.max(0, cap - spent),
      calls24h: this.repo.ledgerCalls(t - DAY, t + 1),
      spent24hUsd: this.repo.ledgerSpent(t - DAY, t + 1),
    };
  }

  /** 呼叫前的保守估價（假設輸入 $1／百萬 token、輸出 $5／百萬 token，約為實際用的模型的 10 倍） */
  private estimate(messages: ChatMessage[], maxTokens: number): number {
    const inTok = messages.reduce((a, m) => a + m.content.length, 0) / 1.5;
    return (inTok * 1 + maxTokens * 5) / 1e6;
  }

  private allowed(est: number): string | null {
    if (!this.cfg.apiKey) return "沒有設定 OPENROUTER_API_KEY";
    const b = this.budget();
    if (b.spentUsd + est > b.capUsd) return "本月預算已用完（保留 15% 安全餘裕）";
    if (b.spent24hUsd + est > this.cfg.budgetUsd * DAILY_SHARE) return "今天的花費上限到了";
    if (b.calls24h >= this.cfg.dailyCallCap) return "今天的呼叫次數上限到了";
    const failUntil = Number(this.repo.getMeta("ai_fail_until") ?? 0);
    if (this.now() < failUntil) return "剛失敗過，稍後再試";
    return null;
  }

  // ───────── 內容池 → 遊戲 ─────────
  /** 把資料庫裡「上線中」的內容載入記憶體（風味文字）並註冊已核准的事件 */
  reload(): void {
    for (const m of NEWS_MOODS) this.news[m] = [];
    for (const t of REVIEW_TIERS) this.reviews[t] = [];
    for (const row of this.repo.contentList("news", "active", 1000)) {
      const p = row.payload as { mood: FlavorMood; text: string };
      this.news[p.mood]?.push(p.text);
    }
    for (const row of this.repo.contentList("review", "active", 1000)) {
      const p = row.payload as { tier: FlavorTier; text: string };
      this.reviews[p.tier]?.push(p.text);
    }
    this.brands = {};
    this.dishes = {};
    for (const row of this.repo.contentList("brand", "active", 1000)) {
      const p = row.payload as { category?: string; name: string; blurb: string };
      if (p.category) (this.brands[p.category] ??= []).push({ name: p.name, blurb: p.blurb }); // 舊格式（只有大類）的不再使用
    }
    for (const row of this.repo.contentList("dish", "active", 1000)) {
      const p = row.payload as { category?: string; name: string };
      if (p.category) (this.dishes[p.category] ??= []).push(p.name); // 舊格式（沒有業態）的名字不再使用
    }
    registerRegulars(this.repo.contentList("regular", "active", 100).map((r) => r.payload as RegularDef));
    const events = this.repo.contentList("event", "active", 200).map((r) => r.payload as EventDef);
    const retired = this.repo.contentList("event", "retired", 200).map((r) => ({ ...(r.payload as EventDef), weight: 0 }));
    registerEvents([...events, ...retired]);
  }

  flavorSource(): FlavorSource {
    return { news: (m) => this.news[m], reviews: (t) => this.reviews[t], brands: (c) => this.brands[c] ?? [], dishes: (c) => this.dishes[c] ?? [] };
  }

  /** 玩家端需要知道的事件定義（含已下架的，因為還可能有進行中的待決事件） */
  publicEvents(): EventDef[] {
    return EVENTS.filter((e) => e.id.startsWith("ai_") || e.id.startsWith("ov_"));
  }

  /** 玩家端需要知道的新常客（名字、簡介與故事） */
  publicRegulars(): RegularDef[] {
    return REGULARS.filter((r) => r.id.startsWith("ai_"));
  }

  // ───────── 生成 ─────────
  async generate(kind: ContentKind, count?: number): Promise<GenResult> {
    const res: GenResult = { kind, ok: false, asked: 0, accepted: 0, rejected: [], costUsd: 0 };
    if (this.busy) return { ...res, error: "另一個生成工作正在進行" };
    const n = count ?? (kind === "event" ? 4 : kind === "regular" ? 3 : 12);
    const messages =
      kind === "news"
        ? newsPrompt(n, this.recentTexts("news"))
        : kind === "review"
          ? reviewPrompt(n, this.recentTexts("review"))
          : kind === "brand"
            ? brandPrompt(this.thinnest(this.brands), 2)
            : kind === "dish"
              ? dishPrompt(this.dishTargets(), 2)
              : kind === "regular"
                ? regularPrompt(n, this.knownRegulars(), this.uncoveredFavs())
                : eventPrompt(n, this.titles());
    const maxTokens = kind === "event" || kind === "regular" ? 2400 : 1400;
    const why = this.allowed(this.estimate(messages, maxTokens));
    if (why) return { ...res, error: why };

    this.busy = true;
    try {
      let r: ChatResult;
      try {
        r = await this.chatFn({ apiKey: this.cfg.apiKey!, model: this.cfg.model, messages, maxTokens, json: true });
      } catch (e) {
        const msg = e instanceof LlmError ? e.message : "未知錯誤";
        this.repo.addLedger({ ts: this.now(), purpose: kind, model: this.cfg.model, promptTokens: 0, completionTokens: 0, costUsd: 0, ok: false, note: msg.slice(0, 200) });
        this.repo.setMeta("ai_fail_until", String(this.now() + 3_600_000)); // 失敗後休息一小時
        return { ...res, error: msg };
      }
      const cost = r.costUsd ?? this.estimate(messages, r.completionTokens || maxTokens);
      res.costUsd = cost;
      let items: unknown[] = [];
      try {
        const j = extractJson(r.text) as { items?: unknown[] };
        items = Array.isArray(j?.items) ? j.items : [];
      } catch (e) {
        res.error = e instanceof LlmError ? e.message : "解析失敗";
      }
      res.asked = items.length;
      const seen = kind === "news" || kind === "review" ? this.recentTexts(kind, 400) : [];
      for (const raw of items) {
        const c = this.check(kind, raw);
        if (!c.ok) {
          res.rejected.push(c.reason);
          continue;
        }
        if (kind === "news" || kind === "review") {
          const text = (c.value as { text: string }).text;
          if (!seen.includes(text) && seen.some((t) => textSimilarity(t, text) >= SIMILAR_LIMIT)) {
            res.rejected.push("太像已有的");
            continue;
          }
          seen.push(text);
        }
        if (this.store(kind, c.value)) res.accepted++;
        else res.rejected.push("重複");
      }
      res.ok = res.accepted > 0;
      this.repo.addLedger({
        ts: this.now(),
        purpose: kind,
        model: r.model,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        costUsd: cost,
        ok: res.ok,
        note: `收 ${res.accepted}／要 ${n}／拒 ${res.rejected.length}${res.error ? "／" + res.error : ""}`,
      });
      if (res.accepted > 0) this.reload();
      return res;
    } finally {
      this.busy = false;
    }
  }

  private check(kind: ContentKind, raw: unknown): Checked<unknown> {
    switch (kind) {
      case "news":
        return checkNews(raw);
      case "review":
        return checkReview(raw);
      case "brand":
        return checkBrand(raw);
      case "dish":
        return checkDish(raw);
      case "regular":
        return checkRegular(raw);
      default:
        return checkEvent(raw);
    }
  }

  private store(kind: ContentKind, value: unknown): boolean {
    const text =
      kind === "event"
        ? (value as EventDef).title + (value as EventDef).text
        : kind === "regular"
          ? (value as RegularDef).name
          : kind === "brand" || kind === "dish"
            ? (value as { name: string }).name
            : (value as { text: string }).text;
    // 事件會影響數值、常客是有名有姓的角色：預設要人工核准才上線
    const status = (kind === "event" || kind === "regular") && !this.cfg.autoApproveEvents ? "pending" : "active";
    return this.repo.addContent(kind, status, hashOf(kind, text), value, this.cfg.model, this.now());
  }

  /** 還沒有任何常客以它為最愛的店種（最多 10 種；起點隨時間輪替，讓各區都有機會被補到） */
  private uncoveredFavs(): { id: string; name: string }[] {
    const covered = new Set(REGULARS.map((r) => r.fav));
    const open = CATEGORIES.filter((c) => !covered.has(c.id));
    const start = open.length > 10 ? Math.floor(this.now() / 3_600_000) % (open.length - 9) : 0;
    return open.slice(start, start + 10).map((c) => ({ id: c.id, name: c.name }));
  }

  /** 已經有的常客（含還在等審核的），讓模型避開雷同 */
  private knownRegulars(): { name: string; persona: string; fav: string }[] {
    const pending = this.repo.contentList("regular", "pending", 50).map((r) => r.payload as RegularDef);
    return [...REGULARS, ...pending].map((r) => ({ name: r.name, persona: r.persona, fav: r.fav }));
  }

  /** 已上線的快訊／評價文字（新的在後面），用來提示模型避開、並擋掉太像的 */
  private recentTexts(kind: "news" | "review", limit = 25): string[] {
    const pool = kind === "news" ? Object.values(this.news).flat() : Object.values(this.reviews).flat();
    return pool.slice(-limit);
  }

  private dishTotal(): number {
    return Object.values(this.dishes).reduce((a, l) => a + l.length, 0);
  }

  private brandTotal(): number {
    return Object.values(this.brands).reduce((a, l) => a + l.length, 0);
  }

  /** 這一輪替哪些業態想名字：目前名字最少的 6 種（同樣多時照資料順序），所以長期下來每種店都會有 */
  private thinnest(pool: Record<string, unknown[]>): { id: string; name: string; group: FlavorGroup }[] {
    return CATEGORIES.map((c, i) => ({ id: c.id, name: c.name, group: c.group as FlavorGroup, n: pool[c.id]?.length ?? 0, i }))
      .sort((a, b) => a.n - b.n || a.i - b.i)
      .slice(0, 6)
      .map(({ id, name, group }) => ({ id, name, group }));
  }

  private dishTargets(): { id: string; name: string; group: FlavorGroup }[] {
    return this.thinnest(this.dishes);
  }

  private titles(): string[] {
    return EVENTS.map((e) => e.title).slice(-40);
  }

  /** 排程呼叫：內容池不足就補一批（一次最多補一種，慢慢來） */
  async topUp(): Promise<GenResult | null> {
    if (!this.enabled) return null;
    if (NEWS_MOODS.some((m) => this.news[m].length < TARGETS.newsPerMood)) return this.generate("news", 12);
    if (REVIEW_TIERS.some((t) => this.reviews[t].length < TARGETS.reviewsPerTier)) return this.generate("review", 12);
    if (this.brandTotal() < TARGETS.brandsTotal) return this.generate("brand");
    if (this.dishTotal() < TARGETS.dishesTotal) return this.generate("dish");
    const pending = this.repo.contentCount("event", "pending");
    const total = this.repo.contentCount("event", "active") + pending;
    if (pending < TARGETS.eventsOpen && total < TARGETS.eventsMax) return this.generate("event", 4);
    const rp = this.repo.contentCount("regular", "pending");
    const rt = this.repo.contentCount("regular", "active") + rp;
    if (rp < TARGETS.regularsOpen && rt < TARGETS.regularsMax) return this.generate("regular", 3);
    return null;
  }

  // ───────── 管理 ─────────
  /** 事件或新常客（待審）核准上線 */
  approveEvent(id: number): boolean {
    const row = [...this.repo.contentList("event", null, 500), ...this.repo.contentList("regular", null, 500)].find((r) => r.id === id);
    if (!row || row.status !== "pending") return false;
    this.repo.setContentStatus(id, "active");
    this.reload();
    return true;
  }

  /** 待審的直接拒絕；已上線的改為「下架」（權重歸零，進行中的待決事件仍能處理） */
  rejectEvent(id: number): boolean {
    const row = [...this.repo.contentList("event", null, 500), ...this.repo.contentList("regular", null, 500)].find((r) => r.id === id);
    if (!row) return false;
    if (row.status === "pending") this.repo.setContentStatus(id, "rejected");
    else if (row.status === "active" && row.kind === "event") this.repo.setContentStatus(id, "retired");
    else return false;
    this.reload();
    return true;
  }

  /** Overseer 親手寫的事件：驗證後直接上線（不需要核准） */
  addManualEvent(raw: unknown): { id: number; def: EventDef } {
    const c = checkEvent(raw, { trusted: true });
    if (!c.ok) throw new Error(c.reason);
    const ok = this.repo.addContent("event", "active", hashOf("event", c.value.title + c.value.text), c.value, "overseer", this.now());
    if (!ok) throw new Error("已經有一模一樣的事件了（標題與內文相同）");
    this.reload();
    const row = this.repo.contentList("event", "active", 5).find((r) => (r.payload as EventDef).id === c.value.id);
    return { id: row?.id ?? 0, def: c.value };
  }

  /** 下架（active→retired）的事件重新上線 */
  activateEvent(id: number): boolean {
    const row = this.repo.contentList("event", null, 500).find((r) => r.id === id);
    if (!row || row.status !== "retired") return false;
    this.repo.setContentStatus(id, "active");
    this.reload();
    return true;
  }

  removeText(id: number): boolean {
    const ok = this.repo.setContentStatus(id, "rejected");
    if (ok) this.reload();
    return ok;
  }
}
