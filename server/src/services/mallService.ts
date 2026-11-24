import { randomInt } from "node:crypto";
import {
  CATEGORY_BY_ID,
  EVENT_BY_ID,
  INSPECTIONS,
  PRESENCE_WINDOW_MS,
  PROMO_BY_ID,
  REGULAR_BY_ID,
  RIVAL_BY_ID,
  SUPPLIER_BY_ID,
  TECH_BY_ID,
  ZONE_BY_ID,
  ROLE_IDS,
  mallScore,
  mallStars,
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
import { applyMail } from "../sim/mail";
import { WorldService } from "../world/world";
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
    case "expandZone":
      return `${actor} 擴建了「${ZONE_BY_ID[cmd.zone]?.name ?? "區域"}」`;
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
    case "chooseSupplier":
      return `${actor} 把${SUPPLIER_BY_ID[cmd.supplierId] ? `「${SUPPLIER_BY_ID[cmd.supplierId]!.name}」` : "供應商"}設為主力供應商`;
    case "signContract":
      return `${actor} 和「${SUPPLIER_BY_ID[cmd.supplierId]?.name ?? "供應商"}」簽了 ${cmd.days} 天長約`;
    case "cancelContract":
      return `${actor} 提前解除了與「${SUPPLIER_BY_ID[cmd.supplierId]?.name ?? "供應商"}」的長約`;
    case "setSupplyPrefs":
      return `${actor} 調整了供應商的自動備援設定`;
    case "rivalIntel":
      return `${actor} 派人打探了「${RIVAL_BY_ID[cmd.rivalId]?.name ?? "對手"}」`;
    case "rivalPact":
      return `${actor} 和「${RIVAL_BY_ID[cmd.rivalId]?.name ?? "對手"}」簽了合作協議`;
    case "rivalCounter":
      return `${actor} 針對「${RIVAL_BY_ID[cmd.rivalId]?.name ?? "對手"}」的活動發動了反制`;
    case "setRivalStance":
      return `${actor} 把商戰姿態改為「${{ defend: "防守", neutral: "對等", aggressive: "進攻" }[cmd.stance]}」`;
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
    case "contribute":
      return `${actor} 認領了團隊事件的一項任務`;
    case "guessPlace":
      return null;
    case "startTech":
      return `${actor} 開始研發科技「${TECH_BY_ID[cmd.id]?.name ?? "新科技"}」`;
    case "cancelTech":
      return `${actor} 取消了科技「${TECH_BY_ID[cmd.id]?.name ?? "新科技"}」的研發`;
    case "signTenant": {
      const c = s.leasing.candidates.find((x) => x.id === cmd.candidateId);
      return `${actor} 和品牌「${c?.brand ?? "新租戶"}」簽了租約`;
    }
    case "counterTenant":
      return `${actor} 向候選品牌還價`;
    case "declineTenant":
      return null;
    case "resolveRenewal":
      return `${actor} 處理了一份租約續約`;
    case "terminateLease":
      return `${actor} 提前解除了「${shopName(cmd.shopId)}」的租約`;
    case "startRnd":
      return `${actor} 讓「${shopName(cmd.shopId)}」開始研發新作品`;
    case "cancelRnd":
      return `${actor} 取消了「${shopName(cmd.shopId)}」的研發`;
    case "tastingAction":
      return `${actor} 處理了一份試吃結果`;
    case "listDish":
      return `${actor} 把新作品上架到「${shopName(cmd.shopId)}」的菜單`;
    case "unlistDish":
      return `${actor} 調整了「${shopName(cmd.shopId)}」的菜單`;
    case "discardDish":
      return null;
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
  /** 跨商場世界：公開名錄、賽季 */
  readonly world: WorldService;
  private lastDirectory = new Map<number, number>();

  constructor(
    readonly repo: Repo,
    private readonly now: () => number = Date.now,
    private notifier: Notifier | null = null,
  ) {
    this.world = new WorldService(repo, now);
  }

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
    this.refreshDirectory(mallId, state, nowMs, true);
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

  // ── 帳號與團隊管理
  private forget(mallId: number): void {
    this.cache.delete(mallId);
    this.lastEmittedTick.delete(mallId);
    this.connections.delete(mallId);
  }

  announceMembersOf(mallId: number): void {
    this.announceMembers(mallId);
  }

  private announceMembers(mallId: number): void {
    this.emit(mallId, { type: "members", mallId, members: this.repo.members(mallId) });
  }

  /** 離開商場：創辦人要先轉讓；最後一個人離開＝解散商場 */
  leaveMall(mallId: number, userId: number): { dissolved: boolean } {
    const m = this.repo.member(mallId, userId);
    if (!m) throw new ServiceError(404, "你不在這座商場裡");
    const count = this.repo.memberCount(mallId);
    if (m.is_owner && count > 1) throw new ServiceError(409, "你是創辦人，請先把創辦人轉讓給其他成員");
    if (count <= 1) {
      this.repo.deleteMall(mallId);
      this.forget(mallId);
      return { dissolved: true };
    }
    this.repo.removeMember(mallId, userId);
    this.announceMembers(mallId);
    return { dissolved: false };
  }

  kickMember(mallId: number, ownerId: number, targetId: number): void {
    const owner = this.repo.member(mallId, ownerId);
    if (!owner?.is_owner) throw new ServiceError(403, "只有創辦人可以請成員離開");
    if (ownerId === targetId) throw new ServiceError(400, "不能請自己離開，要走請用「離開商場」");
    if (!this.repo.member(mallId, targetId)) throw new ServiceError(404, "找不到這位成員");
    this.repo.removeMember(mallId, targetId);
    this.announceMembers(mallId);
  }

  transferOwner(mallId: number, ownerId: number, targetId: number): void {
    const owner = this.repo.member(mallId, ownerId);
    if (!owner?.is_owner) throw new ServiceError(403, "只有創辦人可以轉讓");
    if (ownerId === targetId) throw new ServiceError(400, "你已經是創辦人了");
    if (!this.repo.member(mallId, targetId)) throw new ServiceError(404, "找不到這位成員");
    this.repo.setOwner(mallId, ownerId, false);
    this.repo.setOwner(mallId, targetId, true);
    this.announceMembers(mallId);
  }

  renameMall(mallId: number, ownerId: number, name: string): void {
    if (!this.repo.member(mallId, ownerId)?.is_owner) throw new ServiceError(403, "只有創辦人可以改商場名稱");
    this.repo.renameMall(mallId, name);
    this.refreshDirectory(mallId, this.load(mallId), this.now(), true);
    this.announceMembers(mallId);
  }

  /** 刪除帳號：自己是唯一成員的商場一併解散；還有別人的商場要先轉讓 */
  deleteAccount(userId: number): void {
    for (const m of this.repo.mallsOfUser(userId)) {
      const count = this.repo.memberCount(m.id);
      if (m.is_owner === 1 && count > 1) throw new ServiceError(409, `「${m.name}」還有其他成員，請先轉讓創辦人或離開商場`);
    }
    for (const m of this.repo.mallsOfUser(userId)) this.leaveMall(m.id, userId);
    this.repo.deleteUser(userId);
  }

  /** 管理用：商場的簡要狀況（不推進時間，只讀目前的快取或存檔） */
  summary(mallId: number): { level: number; funds: number; tick: number; day: number; flags: Record<string, boolean> } | null {
    try {
      const s = this.load(mallId);
      return { level: s.level, funds: Math.round(s.funds), tick: s.tick, day: Math.floor((s.tick - s.meta.startTick) / 288), flags: s.flags };
    } catch {
      return null;
    }
  }

  /** 管理用：解散商場 */
  dissolveMall(mallId: number): void {
    this.repo.deleteMall(mallId);
    this.forget(mallId);
  }

  /** 管理用：強制刪除使用者；他創辦且還有別人的商場，先把創辦人轉給最早加入的其他成員 */
  adminDeleteUser(userId: number): void {
    for (const m of this.repo.mallsOfUser(userId)) {
      if (m.is_owner === 1) {
        const next = this.repo.members(m.id).find((x) => x.userId !== userId);
        if (next) {
          this.repo.setOwner(m.id, next.userId, true);
          this.repo.setOwner(m.id, userId, false);
        }
      }
      this.leaveMall(m.id, userId);
    }
    this.repo.deleteUser(userId);
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
    // 團隊事件需要知道有幾位成員
    const size = Math.max(1, this.repo.members(mallId).length);
    if (s.meta.team.size !== size) s.meta.team.size = size;

    // 跨商場的信件：到期的先交給商場（賽季獎勵等），再往下推進
    const due = this.repo.dueMail(mallId, nowMs);
    if (due.length > 0) {
      s = structuredClone(s);
      for (const m of due) applyMail(s, m);
      this.repo.markMailDelivered(due.map((m) => m.id));
    }

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

    this.refreshDirectory(mallId, s, nowMs);
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

  /** 更新這座商場在公開名錄裡的資料（最多每分鐘一次）；只寫公開欄位 */
  private refreshDirectory(mallId: number, s: MallState, nowMs: number, force = false): void {
    if (!force && nowMs - (this.lastDirectory.get(mallId) ?? 0) < 60_000) return;
    const row = this.repo.mallById(mallId);
    if (!row) return;
    this.lastDirectory.set(mallId, nowMs);
    const counts = new Map<string, number>();
    for (const sh of s.shops) counts.set(sh.category, (counts.get(sh.category) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const revenue30 = s.reports.slice(-30).reduce((a, r) => a + r.revenue + r.rentIncome, 0);
    this.repo.upsertDirectory({
      mallId,
      name: row.name,
      level: s.level,
      stars: mallStars(s),
      score: Math.round(mallScore(s) * 10) / 10,
      localRep: Math.round(s.localRep * 10) / 10,
      touristHeat: Math.round(s.touristHeat * 10) / 10,
      revenue30: Math.round(revenue30),
      shops: s.shops.length,
      topCategory: top ? CATEGORY_BY_ID[top]?.name ?? "" : "",
      createdAt: row.created_at,
      updatedAt: nowMs,
    });
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
    const result = applyCommand(current, cmd, { id: String(user.id), name: user.displayName });
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
    const ids = this.repo.allMallIds();
    const run = () => {
      for (const id of ids) {
        try {
          this.sync(id);
        } catch (e) {
          console.error(`tick failed for mall ${id}`, e);
        }
      }
    };
    run();
    try {
      // 賽季結算要用剛更新過的名錄；有發出獎勵就立刻讓各商場收下
      if (this.world.settleSeasons().length > 0) run();
    } catch (e) {
      console.error("season settlement failed", e);
    }
  }
}
