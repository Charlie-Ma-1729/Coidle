import { randomInt } from "node:crypto";
import {
  CATEGORY_BY_ID,
  ROLE_IDS,
  type MallState,
  type MemberInfo,
  type PublicMallState,
  type RoleId,
  type ServerMessage,
} from "@coidle/shared";
import { newInviteCode } from "../auth/password";
import type { Repo } from "../db/repo";
import { advanceTo, applyCommand, createInitialState, tickFromRealMs, type Command, type CommandResult } from "../sim";

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Broadcast = (mallId: number, msg: ServerMessage) => void;

export function toPublic(s: MallState): PublicMallState {
  const { seed: _seed, cooldowns: _cooldowns, ...rest } = s;
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
    case "setLease":
      return `${actor} 調整了「${shopName(cmd.shopId)}」的出租設定`;
  }
}

/**
 * 商場服務：把「真實時間 → 遊戲 tick」「模擬引擎」「資料庫」「即時推播」串起來。
 * 所有操作都是同步的（node:sqlite），所以同一座商場不會有交錯的競態。
 */
export class MallService {
  private cache = new Map<number, MallState>();
  private lastEmittedTick = new Map<number, number>();
  private listeners = new Set<Broadcast>();

  constructor(
    readonly repo: Repo,
    private readonly now: () => number = Date.now,
  ) {}

  subscribe(fn: Broadcast): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(mallId: number, msg: ServerMessage): void {
    for (const fn of this.listeners) fn(mallId, msg);
  }

  currentTick(): number {
    return tickFromRealMs(this.now());
  }

  // ── 建立／加入
  createMall(userId: number, name: string, inviteCodeOverride?: string): { mallId: number; inviteCode: string } {
    const seed = randomInt(1, 2 ** 31);
    const code = inviteCodeOverride ?? newInviteCode();
    const mallId = this.repo.createMall(name, code, seed, this.now());
    this.repo.addMember(mallId, userId, "gm", true, this.now());
    const state = createInitialState(seed, this.currentTick());
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
    const s = JSON.parse(json) as MallState;
    this.cache.set(mallId, s);
    return s;
  }

  private persist(mallId: number, s: MallState): void {
    this.repo.saveState(mallId, s.tick, JSON.stringify(s), this.now());
  }

  /** 把商場推進到「現在」；有進展就存檔並廣播 */
  sync(mallId: number): MallState {
    const before = this.load(mallId);
    const after = advanceTo(before, this.currentTick());
    if (after !== before) {
      this.cache.set(mallId, after);
      this.persist(mallId, after);
      if (this.lastEmittedTick.get(mallId) !== after.tick) {
        this.lastEmittedTick.set(mallId, after.tick);
        this.emit(mallId, { type: "state", mallId, state: toPublic(after) });
      }
    }
    return after;
  }

  /** 玩家開啟畫面：算「有在照顧」 */
  getState(mallId: number, touch: boolean): PublicMallState {
    const s = this.sync(mallId);
    if (touch) s.lastActionTick = s.tick;
    return toPublic(s);
  }

  runCommand(mallId: number, user: { id: number; displayName: string }, cmd: Command): CommandResult & { publicState?: PublicMallState } {
    const current = this.sync(mallId);
    const result = applyCommand(current, cmd);
    if (!result.ok) return result;
    this.cache.set(mallId, result.state);
    this.persist(mallId, result.state);
    this.emit(mallId, { type: "state", mallId, state: toPublic(result.state) });
    const text = describeCommand(current, cmd, user.displayName);
    if (text) {
      const entry = this.repo.addActivity(mallId, this.now(), user.displayName, text);
      this.emit(mallId, { type: "activity", mallId, entry });
    }
    return { ...result, publicState: toPublic(result.state) };
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
