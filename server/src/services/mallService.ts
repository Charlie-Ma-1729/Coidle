import { randomInt } from "node:crypto";
import {
  CATEGORY_BY_ID,
  EVENT_BY_ID,
  INSPECTIONS,
  PRESENCE_WINDOW_MS,
  PROMO_BY_ID,
  REGULAR_BY_ID,
  ROLE_IDS,
  isPaused,
  reanchor,
  speedPreset,
  tickAt,
  tickFromRealMs,
  type MallState,
  type MemberInfo,
  type PublicMallState,
  type RoleId,
  type ServerMessage,
  type SpeedId,
} from "@coidle/shared";
import { newInviteCode } from "../auth/password";
import type { Repo } from "../db/repo";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command, type CommandResult } from "../sim";

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Broadcast = (mallId: number, msg: ServerMessage) => void;

/** 事件導致暫停時要「跳通知」。實際的推播實作在 push.ts，這裡只依賴介面。 */
export interface Notifier {
  notify(mallId: number, payload: { title: string; body: string }): void;
}

export function toPublic(s: MallState): PublicMallState {
  const { seed: _seed, cooldowns: _cooldowns, grievances: _grievances, ...rest } = s;
  return rest;
}

/** 把指令轉成給隊友看的動態文字 */
export function describeCommand(s: MallState, cmd: Command, actor: string): string | null {
  const shopName = (id: string) => s.shops.find((x) => x.id === id)?.name ?? "某間店";
  switch (cmd.type) {
    case "touch":
      return null;
    case "setPrice":
      return `${actor} 調整了「${shopName(cmd.shopId)}」的售價`;
    case "setHours":
      return `${actor} 把營業時間改為 ${cmd.open}:00–${cmd.close}:00`;
    case "setRestock":
      return `${actor} 修改了「${shopName(cmd.shopId)}」的自動補貨規則`;
    case "orderStock":
      return `${actor} 為「${shopName(cmd.shopId)}」手動進貨 ${cmd.qty} 份`;
    case "setCleaning":
      return `${actor} 把清潔等級調到 ${cmd.level}`;
    case "setMaintenance":
      return `${actor} 把設備維護等級調到 ${cmd.level}`;
    case "buildShop":
      return `${actor} 開始興建「${CATEGORY_BY_ID[cmd.category]?.name ?? "新店"}」`;
    case "upgradeShop":
      return `${actor} 讓「${shopName(cmd.shopId)}」開始翻新`;
    case "refreshShop":
      return `${actor} 幫「${shopName(cmd.shopId)}」換了新菜單`;
    case "resolveEvent":
      return `${actor} 處理了一個待決事件`;
    case "resolveAllDefault":
      return `${actor} 把待決事件全部採預設處理`;
    case "setLease":
      return `${actor} 調整了「${shopName(cmd.shopId)}」的出租設定`;
    case "resolveInbox": {
      const item = s.inbox.find((i) => i.uid === cmd.uid);
      return item?.kind === "review" ? `${actor} 回覆了一則評價` : `${actor} 處理了一則客訴`;
    }
    case "walkFloor":
      return `${actor} 巡了一圈場`;
    case "walkAct":
      return null; // 巡場中的小動作不洗版團隊動態
    case "setGuestPrefs":
      return `${actor} 調整了客人互動的處理偏好`;
    case "schedulePromo": {
      const name = PROMO_BY_ID[cmd.defId]?.name ?? "活動";
      return cmd.startTick === undefined || cmd.startTick <= s.tick ? `${actor} 開辦了「${name}」` : `${actor} 排程了「${name}」`;
    }
    case "cancelPromo": {
      const sc = s.promos.scheduled.find((x) => x.uid === cmd.uid);
      return `${actor} 取消了排程的「${(sc && PROMO_BY_ID[sc.defId]?.name) ?? "活動"}」`;
    }
    case "prepareInspection": {
      const n = s.inspections.pending.find((x) => x.uid === cmd.uid);
      const kind = n ? INSPECTIONS[n.kind].name : "稽查";
      return `${actor} 為${kind}做了準備（${{ none: "照常營業", basic: "例行整理", full: "全力備戰" }[cmd.level]}）`;
    }
    case "regularAction": {
      const name = REGULAR_BY_ID[cmd.regularId]?.name ?? "常客";
      const verb = { greet: "聊了聊", remember: "記住了喜好", gift: "送了小禮", reserve: "保留了專屬座位", unreserve: "取消了專屬座位" }[cmd.action];
      return `${actor} 和常客「${name}」${cmd.action === "greet" ? verb : `：${verb}`}`;
    }
  }
}

export interface ClockPatch {
  speed?: SpeedId;
  paused?: boolean;
  pauseOnEvents?: boolean;
  /** 1–14 天；null＝關閉 */
  idlePauseDays?: number | null;
}

/**
 * 商場服務：把「真實時間 → 這座商場的 tick」「模擬引擎」「資料庫」「即時推播」串起來。
 * 所有操作都是同步的（node:sqlite），所以同一座商場不會有交錯的競態。
 */
export class MallService {
  private cache = new Map<number, MallState>();
  private lastEmittedTick = new Map<number, number>();
  private listeners = new Set<Broadcast>();
  /** 每座商場目前有幾個 WebSocket 連線（用來判斷「有沒有人在場」） */
  private connections = new Map<number, number>();

  constructor(
    readonly repo: Repo,
    private readonly now: () => number = Date.now,
    private notifier: Notifier | null = null,
  ) {}

  setNotifier(n: Notifier | null): void {
    this.notifier = n;
  }

  subscribe(fn: Broadcast): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(mallId: number, msg: ServerMessage): void {
    for (const fn of this.listeners) fn(mallId, msg);
  }

  /** WebSocket 連線數增減 */
  addConnection(mallId: number, delta: 1 | -1): void {
    const n = Math.max(0, (this.connections.get(mallId) ?? 0) + delta);
    if (n === 0) this.connections.delete(mallId);
    else this.connections.set(mallId, n);
  }

  /** 沒有連線，而且最近一段時間也沒有任何成員操作過 */
  private nobodyPresentFor(mallId: number, s: MallState): boolean {
    return (this.connections.get(mallId) ?? 0) === 0 && this.now() - s.clock.lastVisitRealMs > PRESENCE_WINDOW_MS;
  }

  // ── 建立／加入
  createMall(userId: number, name: string, inviteCodeOverride?: string): { mallId: number; inviteCode: string } {
    const seed = randomInt(1, 2 ** 31);
    const code = inviteCodeOverride ?? newInviteCode();
    const nowMs = this.now();
    const mallId = this.repo.createMall(name, code, seed, nowMs);
    this.repo.addMember(mallId, userId, "gm", true, nowMs);
    const state = createInitialState(seed, tickFromRealMs(nowMs), nowMs);
    this.cache.set(mallId, state);
    this.persist(mallId, state);
    return { mallId, inviteCode: code };
  }

  joinMall(code: string, userId: number, role: RoleId | undefined, maxMembers: number): number {
    const mall = this.repo.mallByCode(code.trim().toUpperCase());
    if (!mall) throw new ServiceError(404, "邀請碼不存在");
    if (this.repo.member(mall.id, userId)) throw new ServiceError(409, "你已經在這座商場裡了");
    if (this.repo.memberCount(mall.id) >= maxMembers) throw new ServiceError(409, "這座商場的成員已滿");
    const r = role && ROLE_IDS.includes(role) ? role : "ops";
    this.repo.addMember(mall.id, userId, r, false, this.now());
    this.emit(mall.id, { type: "members", mallId: mall.id, members: this.repo.members(mall.id) });
    return mall.id;
  }

  members(mallId: number): MemberInfo[] {
    return this.repo.members(mallId);
  }

  // ── 狀態
  private load(mallId: number): MallState {
    const cached = this.cache.get(mallId);
    if (cached) return cached;
    const json = this.repo.loadState(mallId);
    if (!json) throw new ServiceError(404, "商場不存在");
    const s = migrateState(JSON.parse(json), this.now());
    this.cache.set(mallId, s);
    return s;
  }

  private persist(mallId: number, s: MallState): void {
    this.repo.saveState(mallId, s.tick, JSON.stringify(s), this.now());
  }

  /** 依這座商場的時鐘，把狀態推進到「現在」 */
  private advanceNow(mallId: number, s: MallState, atMs: number): MallState {
    const target = tickAt(s.clock, atMs);
    return advanceTo(s, target, { nobodyPresent: this.nobodyPresentFor(mallId, s) });
  }

  /**
   * 把商場推進到「現在」；有進展就存檔並廣播。
   * 處理兩種自動暫停：沒人在場時遇到重要事件（在 advanceTo 內攔下）、全員久未上線。
   */
  sync(mallId: number): MallState {
    const before = this.load(mallId);
    const nowMs = this.now();
    let s = before;

    // 久未上線：在「最後一次造訪 + N 天」那個精確時間點暫停
    const days = s.clock.idlePauseDays;
    if (days !== null && !isPaused(s.clock) && (this.connections.get(mallId) ?? 0) === 0) {
      const threshold = s.clock.lastVisitRealMs + days * 86_400_000;
      if (nowMs > threshold) {
        s = this.advanceNow(mallId, s, threshold);
        if (!isPaused(s.clock)) {
          s = structuredClone(s);
          s.clock.holds.idle = true;
          reanchor(s.clock, s.tick, threshold);
        }
      }
    }
    if (!isPaused(s.clock)) s = this.advanceNow(mallId, s, nowMs);

    if (s !== before) {
      this.cache.set(mallId, s);
      this.persist(mallId, s);
      this.announceNewHolds(mallId, before, s);
      if (this.lastEmittedTick.get(mallId) !== s.tick) {
        this.lastEmittedTick.set(mallId, s.tick);
        this.emit(mallId, { type: "state", mallId, state: toPublic(s) });
      }
    }
    return s;
  }

  /** 新出現的「事件暫停」→ 跳通知 */
  private announceNewHolds(mallId: number, before: MallState, after: MallState): void {
    const known = new Set(before.clock.holds.events);
    for (const uid of after.clock.holds.events) {
      if (known.has(uid)) continue;
      const pending = after.pending.find((p) => p.uid === uid);
      const def = pending ? EVENT_BY_ID[pending.defId] : undefined;
      const notice = after.inspections.pending.find((p) => p.uid === uid);
      const title = def?.title ?? (notice ? `${INSPECTIONS[notice.kind].name}預告` : null);
      if (!title) continue;
      this.notifier?.notify(mallId, { title: `⏸ 商場已暫停：${title}`, body: "有一件重要的事需要你決定，處理後時間會自動繼續。" });
    }
  }

  /** 玩家開啟畫面：記下造訪；若是因為久未上線而暫停，現在恢復（不補算暫停期間） */
  private visit(mallId: number, s: MallState): MallState {
    const nowMs = this.now();
    s.clock.lastVisitRealMs = nowMs;
    if (s.clock.holds.idle) {
      s.clock.holds.idle = false;
      if (!isPaused(s.clock)) reanchor(s.clock, s.tick, nowMs);
      s.log.push({ tick: s.tick, kind: "info", text: "歡迎回來！時間從你離開的地方繼續。" });
      this.cache.set(mallId, s);
      this.persist(mallId, s);
      this.emit(mallId, { type: "state", mallId, state: toPublic(s) });
    }
    return s;
  }

  getState(mallId: number, touch: boolean): PublicMallState {
    let s = this.sync(mallId);
    if (touch) s = this.visit(mallId, s);
    return toPublic(s);
  }

  runCommand(mallId: number, user: { id: number; displayName: string }, cmd: Command): CommandResult & { publicState?: PublicMallState } {
    let current = this.sync(mallId);
    current = this.visit(mallId, current);
    const result = applyCommand(current, cmd);
    if (!result.ok) return result;
    const after = result.state;
    // 處理完重要事件、時鐘從暫停回到運轉：錨點移到現在，暫停期間不補算
    if (isPaused(current.clock) && !isPaused(after.clock)) reanchor(after.clock, after.tick, this.now());
    this.cache.set(mallId, after);
    this.persist(mallId, after);
    this.emit(mallId, { type: "state", mallId, state: toPublic(after) });
    const text = describeCommand(current, cmd, user.displayName);
    if (text) this.logActivity(mallId, user.displayName, text);
    return { ...result, state: after, publicState: toPublic(after) };
  }

  /** 調整時間流速、暫停、遇事暫停、久未上線暫停（任何成員都可以） */
  setClock(mallId: number, user: { id: number; displayName: string }, patch: ClockPatch): PublicMallState {
    let s = this.sync(mallId);
    s = this.visit(mallId, s);
    const nowMs = this.now();
    const next = structuredClone(s);
    const notes: string[] = [];

    if (patch.speed !== undefined) {
      const preset = speedPreset(patch.speed);
      if (!preset) throw new ServiceError(400, "流速檔位無效");
      next.clock.speed = preset.mult;
      next.clock.holds.manual = false; // 選了速度就是要讓時間走
      notes.push(`把時間流速調成「${preset.name}」（真實 ${preset.realHoursPerDay} 小時＝1 遊戲日）`);
    }
    if (patch.paused !== undefined) {
      next.clock.holds.manual = patch.paused;
      notes.push(patch.paused ? "暫停了時間" : "恢復了時間");
    }
    if (patch.pauseOnEvents !== undefined) {
      next.clock.pauseOnEvents = patch.pauseOnEvents;
      notes.push(patch.pauseOnEvents ? "開啟了「遇到重要事件自動暫停」" : "關閉了「遇到重要事件自動暫停」");
    }
    if (patch.idlePauseDays !== undefined) {
      const d = patch.idlePauseDays;
      if (d !== null && (!Number.isInteger(d) || d < 1 || d > 14)) throw new ServiceError(400, "天數需在 1–14 之間");
      next.clock.idlePauseDays = d;
      notes.push(d === null ? "關閉了「久未上線自動暫停」" : `設定「全員 ${d} 天沒上線就自動暫停」`);
    }
    if (notes.length === 0) throw new ServiceError(400, "沒有要變更的設定");

    next.clock.holds.idle = false;
    reanchor(next.clock, next.tick, nowMs);
    this.cache.set(mallId, next);
    this.persist(mallId, next);
    this.emit(mallId, { type: "state", mallId, state: toPublic(next) });
    this.logActivity(mallId, user.displayName, `${user.displayName} ${notes.join("、")}`);
    return toPublic(next);
  }

  private logActivity(mallId: number, actor: string, text: string): void {
    const entry = this.repo.addActivity(mallId, this.now(), actor, text);
    this.emit(mallId, { type: "activity", mallId, entry });
  }

  /** 開發用：設定功能／區域旗標（需 ADMIN_TOKEN） */
  setFlag(mallId: number, flag: string, value: boolean): PublicMallState {
    const s = structuredClone(this.sync(mallId));
    s.flags[flag] = value;
    this.cache.set(mallId, s);
    this.persist(mallId, s);
    this.emit(mallId, { type: "state", mallId, state: toPublic(s) });
    return toPublic(s);
  }

  /** 排程呼叫：把所有商場推進到現在（離線期間也會賺錢的關鍵） */
  tickAll(): void {
    for (const id of this.repo.allMallIds()) {
      try {
        this.sync(id);
      } catch (e) {
        console.error(`tick failed for mall ${id}`, e);
      }
    }
  }
}
