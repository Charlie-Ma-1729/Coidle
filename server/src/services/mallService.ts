import { randomInt } from "node:crypto";
import {
  CATEGORY_BY_ID,
  CORPORATE_STAKE_CAP_PCT,
  CORPORATE_TOTAL_CAP_PCT,
  DISCLOSURE_PCT,
  corporateCap,
  corporateRoomValue,
  disclosureCrossing,
  financeBlocker,
  CLIMATES,
  LENDERS,
  LENDER_ORDER,
  PRODUCTS,
  PRODUCT_ORDER,
  creditClimate,
  underwrite,
  underwriteInput,
  type Climate,
  type FinanceView,
  MARKET_FEE_RATE,
  MARKET_TAX_RATE,
  buyQuote,
  corporateSellQuote,
  OPEN_PLAN_FLAG,
  openPlanEnabled,
  stockGroupOf,
  type CorporateAccount,
  type CorporateHolding,
  type CorporateView,
  type TradeResult,
  dayOfGstep,
  gstepAt,
  STEPS_PER_DAY,
  stepOfDayOf,
  EVENT_BY_ID,
  INSPECTIONS,
  PRESENCE_WINDOW_MS,
  PROMO_BY_ID,
  REGULAR_BY_ID,
  RIVAL_BY_ID,
  SUPPLIER_BY_ID,
  LEVELS,
  STARTER_QUESTS,
  TECHS,
  TECH_BY_ID,
  ZONES,
  ZONE_BY_ID,
  FACILITY_BY_KIND,
  ROLE_IDS,
  categoryHasStock,
  publicPatrol,
  mallScore,
  mallStars,
  isPaused,
  reanchor,
  DEFAULT_CATCHUP_SPEED,
  DEFAULT_SERVER_CLOCK,
  REAL_HOURS_PER_GAME_DAY,
  SLOWEST_SPEED,
  TICKS_PER_DAY,
  RELATED_TAIL_MS,
  BUYBACK_MAX_CASH_PCT,
  EQUITY_MIN_ACTIVE_DAYS,
  EQUITY_MIN_MALL_REVENUE,
  equityBlocker,
  dayOfTick,
  CONTROLLER_TITLE,
  DIVIDEND_COOLDOWN_MS,
  DIVIDEND_MAX_CASH_PCT,
  DIVIDEND_MIN,
  FOUNDING_COST,
  INITIAL_FUNDS,
  INITIAL_SHARES,
  MAX_TOTAL_SHARES,
  OFFER_TTL_MS,
  RELATED_STAKE_PCT,
  buybackPrice,
  clampToAnchor,
  mallBookValue,
  isBigStake,
  isControlling,
  issuePrice,
  sharePct,
  sharesForCapital,
  splitDividend,
  stakeValue,
  type CapitalRequestView,
  type HoldingsView,
  type LedgerKind,
  type PersonalEquityView,
  type ShareOfferView,
  type WealthView,
  CONCEPT_BY_ID,
  type ConceptId,
  interactBlocker,
  hoursRangeLabel,
  presetOfSpeed,
  speedPreset,
  tickAt,
  type MallState,
  type ServerClock,
  type MemberInfo,
  type PublicMallState,
  FACILITY_DEFS,
  type RoleId,
  type ServerMessage,
  type SpeedId,
} from "@coidle/shared";
import { newInviteCode } from "../auth/password";
import { applyMail } from "../sim/mail";
import { WorldService } from "../world/world";
import { AllianceService } from "../world/alliances";
import { TradeService } from "../world/trade";
import { CompeteService } from "../world/compete";
import { NpcActor } from "../world/npcActor";
import { MarketService } from "../world/market";
import { ServiceError } from "./errors";
import { balanceRow } from "./balance";
import type { Repo } from "../db/repo";
import { advanceTo, applyCommand, createInitialState, migrateState, type Command, type CommandResult } from "../sim";

export { ServiceError };

export type Broadcast = (mallId: number, msg: ServerMessage) => void;

/** 事件導致暫停時要「跳通知」。實際的推播實作在 push.ts，這裡只依賴介面。 */
export interface Notifier {
  notify(mallId: number, payload: { title: string; body: string }): void;
}

export function toPublic(s: MallState, serverTick?: number): PublicMallState {
  const { seed: _seed, cooldowns: _cooldowns, grievances: _grievances, patrol, ...rest } = s;
  // 巡店：還沒被發現的問題不能外流；只有線索的問題不透露種類與嚴重度
  const open = patrol ? { ...rest, patrol: publicPatrol(patrol) } : rest;
  return serverTick === undefined ? open : { ...open, serverTick };
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
      return `${actor} 把營業時間改為 ${hoursRangeLabel(cmd.open, cmd.close)}`;
    case "setConcept":
      return `${actor} 把商場的定位改為「${CONCEPT_BY_ID[cmd.id as ConceptId]?.name ?? "新定位"}」`;
    case "setRestock":
      return `${actor} 修改了「${shopName(cmd.shopId)}」的自動補貨規則`;
    case "setRestockMany":
      return `${actor} 批次修改了 ${cmd.shopIds.length} 間店的自動補貨規則`;
    case "orderStock":
      return `${actor} 為「${shopName(cmd.shopId)}」${cmd.rush ? "急件" : "手動"}進貨 ${cmd.qty} 份`;
    case "setCleaning":
      return `${actor} 把清潔等級調到 ${cmd.level}`;
    case "setMaintenance":
      return `${actor} 把設備維護等級調到 ${cmd.level}`;
    case "buildShop":
      return `${actor} 開始興建「${CATEGORY_BY_ID[cmd.category]?.name ?? "新店"}」`;
    case "demolishShop":
      return `${actor} 拆除了「${shopName(cmd.shopId)}」`;
    case "expandZone":
      return `${actor} 擴建了「${ZONE_BY_ID[cmd.zone]?.name ?? "區域"}」`;
    case "buildFacility":
      return `${actor} 開始興建「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」的下一${FACILITY_BY_KIND[cmd.kind]?.unit ?? "單位"}`;
    case "setFacilityOps":
      return `${actor} 調整了「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」的營運設定`;
    case "maintainFacility":
      return `${actor} 維護了「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」`;
    case "acceptFacilityOffer":
      return `${actor} 把「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」交給營運商經營`;
    case "declineFacilityOffer":
      return `${actor} 婉拒了「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」的營運商`;
    case "counterFacilityOffer":
      return `${actor} 向「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」的營運商還價`;
    case "resolveFacilityRenewal":
      return `${actor} 處理了「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」的續約`;
    case "endFacilityLease":
      return `${actor} 收回「${FACILITY_BY_KIND[cmd.kind]?.name ?? "設施"}」自營`;
    case "upgradeShop":
      return `${actor} 讓「${shopName(cmd.shopId)}」開始翻新`;
    case "moveShop":
      return `${actor} 讓「${shopName(cmd.shopId)}」開始搬遷`;
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
    case "patrolStart":
      return `${actor} 開始巡店`;
    case "patrolInspect":
    case "patrolChat":
    case "patrolDeepen":
      return null; // 巡店中的檢查動作不洗版團隊動態
    case "patrolFix":
      return `${actor} 處理了一個巡店發現的問題`;
    case "patrolEnd":
      return `${actor} 結束了巡店`;
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
    case "regularVoice":
      return `${actor} 回應了熟客的一則話`;
    case "setMembership":
      return `${actor} 調整了會員點數的回饋率`;
    case "legalAction":
      return `${actor} 處理了一件法律糾紛`;
    case "setInsurance":
      return `${actor} 調整了賠償責任保險`;
    case "takeLoan":
      return `${actor} 向金融機構申請了「${PRODUCTS[cmd.product]?.name ?? "貸款"}」`;
    case "repayLoan":
      return `${actor} 還了一筆貸款`;
    case "setBizInsurance":
      return `${actor} 調整了營業中斷險`;
    case "setSupplyPrefs":
      return `${actor} 調整了供應商的自動備援${cmd.backup ? "與首選備用供應商" : ""}設定`;
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
    case "techExperiment":
      return `${actor} 處理了一個科研實驗事件`;
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
    case "renameShop":
      return `${actor} 把「${shopName(cmd.shopId)}」改名為「${String(cmd.name).slice(0, 12)}」`;
    case "closeShop":
      return `${actor} 讓「${shopName(cmd.shopId)}」歇業了`;
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
      const verb = { greet: "聊了聊", remember: "記住了喜好", gift: "送了小禮" }[cmd.action];
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
  /** 商場 → 成員 → 目前連線數（只含真的成員，旁觀的 Overseer 不算） */
  private presence = new Map<number, Map<number, number>>();
  /** 跨商場世界：公開名錄、賽季 */
  readonly world: WorldService;
  /** 聯名協議（跨商場合作） */
  readonly alliances: AllianceService;
  /** 貿易（調貨與支援） */
  readonly trade: TradeService;
  /** 商戰搶客 */
  readonly compete: CompeteService;
  /** NPC 商場的自動出手與回覆 */
  readonly npcActor: NpcActor;
  /** 股票市場：玩家用個人錢包買賣虛構集團的股票（和商場無關） */
  readonly market: MarketService;
  private lastSnapshotDay = -1;
  private lastDirectory = new Map<number, number>();

  constructor(
    readonly repo: Repo,
    private readonly now: () => number = Date.now,
    private notifier: Notifier | null = null,
  ) {
    this.initServerClock();
    this.market = new MarketService(repo, now, () => this.serverClock);
    this.market.setCorporateSink((mallId, gross, exempt, note) => {
      this.mutate(mallId, (s) => {
        // 配息不當場扣稅：全額入公司資金、算進今天的投資損益；益金不算入的部分決算時不課稅
        s.funds += gross;
        s.today.invest = (s.today.invest ?? 0) + gross;
        s.today.investExempt = (s.today.investExempt ?? 0) + exempt;
      });
      this.logActivity(mallId, "投資", note);
    });
    this.world = new WorldService(repo, now);
    this.alliances = new AllianceService(repo, this.world, now, {
      snapshot: (id) => {
        const s = this.sync(id);
        return { level: s.level, score: Math.round(mallScore(s) * 10) / 10, funds: s.funds };
      },
      spend: (id, amount) => this.spend(id, amount),
      deliver: (id) => {
        this.sync(id);
      },
      assertCanInteract: (id) => this.assertCanInteract(id),
      related: (a, b) => this.related(a, b),
    });
    this.compete = new CompeteService(repo, this.world, now, {
      snapshot: (id) => ({ level: this.sync(id).level }),
      spend: (id, amount) => this.spend(id, amount),
      deliver: (id) => {
        this.sync(id);
      },
      assertCanInteract: (id) => this.assertCanInteract(id),
      related: (a, b) => this.related(a, b),
    });
    this.trade = new TradeService(
      repo,
      now,
      {
        peek: (id) => this.sync(id),
        mutate: (id, fn) => this.mutate(id, fn),
        deliver: (id) => {
          this.sync(id);
        },
        assertCanInteract: (id) => this.assertCanInteract(id),
        related: (a, b) => this.related(a, b),
      },
      (id) => this.repo.mallById(id)?.name ?? "友好商場",
      (npcId) => (this.world.npc.isHidden(npcId) ? null : this.world.npc.entryAny(npcId)?.name ?? null),
    );
    this.npcActor = new NpcActor(repo, this.world, this.alliances, this.compete, now, {
      peek: (id) => this.sync(id),
      deliver: (id) => {
        this.sync(id);
      },
    });
  }

  /**
   * 第一次啟動時決定伺服器基準時鐘。新資料庫用預設錨點；已經有商場的舊資料庫，
   * 把伺服器時間設在「最前面那座商場的 tick」——沒有商場領先，其他商場就是落後、會自動加速追趕。
   */
  private initServerClock(): void {
    if (this.repo.hasServerClock()) return;
    const max = this.repo.maxMallTick();
    this.repo.setServerClock(max === null ? DEFAULT_SERVER_CLOCK : { anchorRealMs: this.now(), anchorTick: max });
  }

  /** 伺服器基準時鐘 */
  get serverClock(): ServerClock {
    return this.repo.serverClock();
  }

  /** 目前的伺服器基準 tick */
  serverTick(): number {
    return this.repo.serverTick(this.now());
  }

  /** 給玩家的狀態：附上「這一刻」的伺服器 tick，畫面才能算出商場與伺服器差多少（測試商場不受夾限，不附） */
  private pub(mallId: number, s: MallState): PublicMallState {
    return toPublic(s, this.serverFor(mallId) ? this.serverTick() : undefined);
  }

  /** 這座商場套用的伺服器時鐘；測試商場也一樣受夾限（只是不進名錄／賽季／聯名／貿易／搶客，也不記平衡數據），
   * 否則暫停久了時間脫鉤，測試的行為（離線追趕、落後擋住的操作）就和真實商場不一樣 */
  private serverFor(_mallId: number): ServerClock | undefined {
    return this.serverClock;
  }

  /** 發起跨商場互動前的共用檢查：落後伺服器基準時間太多就擋下 */
  assertCanInteract(mallId: number): void {
    const s = this.sync(mallId);
    const why = interactBlocker(this.serverTick() - s.tick);
    if (why) throw new ServiceError(400, why);
  }

  /**
   * 兩座商場是不是關係企業：有同一位玩家是現任成員，或最近（一個賽季內）離開過。
   * 關係企業之間不能聯名、貿易、搶客，擋掉左手轉右手的作帳、掏空與刷榜。
   */
  related(a: number, b: number): boolean {
    return this.repo.areRelated(a, b, this.now() - RELATED_TAIL_MS);
  }

  /** 這座商場的所有關係企業編號（給畫面標示用） */
  relatedMalls(mallId: number): number[] {
    return this.repo.relatedMalls(mallId, this.now() - RELATED_TAIL_MS);
  }

  /** 商場多了一位經營者之後：和它變成關係企業的商場，既有的聯名協議一律結束 */
  private afterMemberAdded(mallId: number): void {
    this.alliances.endRelated(mallId);
  }

  /** 對商場做一次同步修改（複製→修改→存檔→廣播）；fn 丟出錯誤就整個取消 */
  private mutate(mallId: number, fn: (s: MallState) => void): void {
    const next = structuredClone(this.sync(mallId));
    fn(next);
    this.cache.set(mallId, next);
    this.persist(mallId, next);
    this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, next) });
  }

  /** 從商場扣款（同步、原子，給伺服器層的跨商場行動用）；錢不夠回傳 false */
  private spend(mallId: number, amount: number): boolean {
    const s = this.sync(mallId);
    if (s.funds < amount) return false;
    const next = structuredClone(s);
    next.funds -= amount;
    next.today.purchases += amount;
    this.cache.set(mallId, next);
    this.persist(mallId, next);
    this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, next) });
    return true;
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
  /** 目前有人在場（非旁觀連線）的商場數 */
  presentMalls(): number {
    return this.connections.size;
  }

  /** 管理用：每座商場目前的連線人數 */
  connectionsOf(mallId: number): number {
    return this.connections.get(mallId) ?? 0;
  }

  /**
   * 成員在場紀錄：某位玩家連上「這座」商場（WebSocket）才算在場；開著別座商場、或只在世界頁都不算。
   * 同一人開多個分頁以連線數計，最後一個關掉才算離開。
   */
  memberConnected(mallId: number, userId: number): void {
    let room = this.presence.get(mallId);
    if (!room) this.presence.set(mallId, (room = new Map()));
    const n = room.get(userId) ?? 0;
    room.set(userId, n + 1);
    this.repo.touchMember(mallId, userId, this.now());
    if (n === 0) this.emit(mallId, { type: "members", mallId, members: this.members(mallId) });
  }

  /** 還連著的時候定期記一筆（伺服器當機或斷網時，「上次在場」不會差太多） */
  memberBeat(mallId: number, userId: number): void {
    try {
      this.repo.touchMember(mallId, userId, this.now());
    } catch {
      // 同上：關閉中的資料庫就算了
    }
  }

  memberDisconnected(mallId: number, userId: number): void {
    const room = this.presence.get(mallId);
    const n = (room?.get(userId) ?? 0) - 1;
    if (!room) return;
    if (n > 0) room.set(userId, n);
    else room.delete(userId);
    if (room.size === 0) this.presence.delete(mallId);
    try {
      this.repo.touchMember(mallId, userId, this.now());
      if (n <= 0) this.emit(mallId, { type: "members", mallId, members: this.members(mallId) });
    } catch {
      // 伺服器關閉時連線才陸續斷開，資料庫可能已經先關了；在場紀錄只是參考，不影響其他事
    }
  }

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
    this.repo.setAllShares(mallId, userId, INITIAL_SHARES); // 創辦人起初持有全部股份
    this.repo.bumpFounded(userId);
    const state = createInitialState(seed, this.repo.serverTick(nowMs), nowMs);
    state.clock.speed = DEFAULT_CATCHUP_SPEED; // 落後時自動全速追趕；已追上就是 1×
    state.clock.lag = 0;
    this.cache.set(mallId, state);
    this.persist(mallId, state);
    this.refreshDirectory(mallId, state, nowMs, true);
    return { mallId, inviteCode: code };
  }

  /**
   * 管理指令用：替某位使用者開一座「全開」的測試商場——最高等級、所有區域與功能旗標開放、
   * 所有科技完成、新手任務全部完成、資金充足。是一座全新的商場（伺服器的快取裡還沒有它），
   * 所以可以在伺服器執行中直接建立，下次有人連線時才會被載入。
   */
  adminCreateTestMall(userId: number, name: string): { mallId: number; inviteCode: string } {
    const made = this.createMall(userId, name);
    const s = structuredClone(this.load(made.mallId));
    const top = LEVELS[LEVELS.length - 1]!;
    s.level = top.level;
    s.totalRevenue = Math.max(s.totalRevenue, top.minRevenue);
    s.localRep = Math.max(s.localRep, 75);
    s.touristHeat = Math.max(s.touristHeat, 75);
    s.funds = Math.max(s.funds, 100_000_000);
    for (const z of ZONES) s.flags[`zone:${z.id}`] = true;
    s.flags["feature:lease"] = true;
    // 全開：大型設施也全部蓋好（方便直接看各設施樓層與營運設定）
    s.facilities = FACILITY_DEFS.map((d) => ({ kind: d.kind, units: d.units.length }));
    s.tech.done = TECHS.map((t) => t.id);
    s.tech.jobs = [];
    for (const q of STARTER_QUESTS) s.meta.achievements[q.id] ??= s.tick;
    this.cache.set(made.mallId, s);
    this.persist(made.mallId, s);
    this.refreshDirectory(made.mallId, s, this.now(), true);
    return made;
  }

  /**
   * 管理用：把一座商場變成「獨立測試商場」——不進名錄／排行／賽季、不能聯名／貿易／搶客、
   * 擁有者換成 Overseer、其他成員全部移除。沒給編號就新開一座全開商場。
   */
  adminMakeSandbox(ownerId: number, mallId?: number): { mallId: number; name: string; created: boolean; removed: string[] } {
    let created = false;
    if (mallId === undefined) {
      mallId = this.adminCreateTestMall(ownerId, "測試全開商場").mallId;
      created = true;
    }
    const id = mallId;
    // 先同步到現在，再把速度改成 1×、錨點移到現在（時間不跳動；測試商場一樣受伺服器時鐘夾限，會自己追趕）
    this.mutate(id, (s) => {
      s.clock.speed = 1;
      delete s.clock.lag;
      reanchor(s.clock, s.tick, this.now());
    });
    if (!this.repo.member(id, ownerId)) this.repo.addMember(id, ownerId, "gm", true, this.now());
    const removed: string[] = [];
    for (const m of this.repo.members(id)) {
      if (m.userId === ownerId) continue;
      this.repo.removeMember(id, m.userId);
      removed.push(m.displayName);
    }
    this.repo.setOwner(id, ownerId, true);
    this.repo.setAllShares(id, ownerId, INITIAL_SHARES);
    this.repo.setSandbox(id, true);
    this.repo.removeDirectory(id);
    this.alliances.dropMall(id);
    this.lastDirectory.delete(id);
    this.announceMembers(id);
    return { mallId: id, name: this.repo.mallById(id)?.name ?? "", created, removed };
  }

  joinMall(code: string, userId: number, role: RoleId | undefined, maxMembers: number): number {
    const mall = this.repo.mallByCode(code.trim().toUpperCase());
    if (!mall) throw new ServiceError(404, "邀請碼不存在");
    if (this.repo.isSandbox(mall.id)) throw new ServiceError(403, "這是測試商場，不開放加入");
    if (this.repo.member(mall.id, userId)) throw new ServiceError(409, "你已經在這座商場裡了");
    if (this.repo.memberCount(mall.id) >= maxMembers) throw new ServiceError(409, "這座商場的成員已滿");
    const r = role && ROLE_IDS.includes(role) ? role : "ops";
    this.repo.addMember(mall.id, userId, r, false, this.now());
    this.afterMemberAdded(mall.id);
    this.emit(mall.id, { type: "members", mallId: mall.id, members: this.members(mall.id) });
    return mall.id;
  }

  /** 成員名單（含此刻是否在這座商場）；給玩家看的一律走這裡 */
  members(mallId: number): MemberInfo[] {
    const room = this.presence.get(mallId);
    return this.repo.members(mallId).map((m) => ({ ...m, online: (room?.get(m.userId) ?? 0) > 0 }));
  }

  // ── 帳號與團隊管理
  private forget(mallId: number): void {
    this.cache.delete(mallId);
    this.lastEmittedTick.delete(mallId);
    this.connections.delete(mallId);
    this.presence.delete(mallId);
  }

  announceMembersOf(mallId: number): void {
    this.announceMembers(mallId);
  }

  private announceMembers(mallId: number): void {
    this.emit(mallId, { type: "members", mallId, members: this.members(mallId) });
  }

  /** 離開商場：創辦人要先轉讓；最後一個人離開＝解散商場 */
  leaveMall(mallId: number, userId: number): { dissolved: boolean } {
    const m = this.repo.member(mallId, userId);
    if (!m) throw new ServiceError(404, "你不在這座商場裡");
    const count = this.repo.memberCount(mallId);
    if (m.is_owner && count > 1) throw new ServiceError(409, "你是創辦人，請先把創辦人轉讓給其他成員");
    if (count <= 1) {
      this.alliances.dropMall(mallId);
      this.repo.deleteMall(mallId);
      this.forget(mallId);
      return { dissolved: true };
    }
    // 退出要結清：股份先賣給其他股東或請商場回購，不能帶著股份走（被請出的才會留著股份）
    if (this.repo.sharesOf(mallId, userId) > 0) throw new ServiceError(409, "離開前要先處理你的股份：賣給其他股東，或請商場回購");
    const before = this.controllerOf(mallId);
    this.repo.dropPendingOf(mallId, userId);
    this.repo.removeMember(mallId, userId, this.now());
    this.noteControl(mallId, before);
    this.announceMembers(mallId);
    return { dissolved: false };
  }

  /**
   * 現在管事的人：持股過半的實際控制人（要還是現任成員）；沒有就是創辦人。
   * 請成員離開、轉讓創辦人頭銜、改名、換邀請碼、發股利、核准注資都歸他。
   */
  authorityOf(mallId: number): number | null {
    const members = this.repo.members(mallId);
    return (members.find((m) => m.isController) ?? members.find((m) => m.isOwner))?.userId ?? null;
  }

  /** 要有權限才能做：有實際控制人就是他，沒有就是創辦人 */
  private assertAuthority(mallId: number, userId: number, what: string): void {
    if (this.authorityOf(mallId) === userId) return;
    const hasController = this.repo.members(mallId).some((m) => m.isController);
    throw new ServiceError(403, hasController ? `只有${CONTROLLER_TITLE}可以${what}` : `只有創辦人可以${what}`);
  }

  kickMember(mallId: number, ownerId: number, targetId: number): void {
    this.assertAuthority(mallId, ownerId, "請成員離開");
    if (ownerId === targetId) throw new ServiceError(400, "不能請自己離開，要走請用「離開商場」");
    if (!this.repo.member(mallId, targetId)) throw new ServiceError(404, "找不到這位成員");
    this.repo.dropPendingOf(mallId, targetId);
    this.repo.removeMember(mallId, targetId, this.now());
    this.announceMembers(mallId);
  }

  /** 轉讓創辦人頭銜：管事的人（實際控制人或創辦人）可以轉，創辦人自己也可以把頭銜交出去 */
  transferOwner(mallId: number, userId: number, targetId: number): void {
    const founder = this.repo.members(mallId).find((m) => m.isOwner);
    if (this.authorityOf(mallId) !== userId && founder?.userId !== userId) this.assertAuthority(mallId, userId, "轉讓創辦人頭銜");
    if (founder?.userId === targetId) throw new ServiceError(400, "他已經是創辦人了");
    if (!this.repo.member(mallId, targetId)) throw new ServiceError(404, "找不到這位成員");
    if (founder) this.repo.setOwner(mallId, founder.userId, false);
    this.repo.setOwner(mallId, targetId, true);
    this.announceMembers(mallId);
  }

  renameMall(mallId: number, ownerId: number, name: string): void {
    this.assertAuthority(mallId, ownerId, "改商場名稱");
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
    this.handOverShares(userId); // 錢包的錢隨帳號一起消失
    for (const m of this.repo.mallsOfUser(userId)) this.leaveMall(m.id, userId);
    this.repo.deleteUser(userId);
  }

  /** 這個人離開遊戲（刪帳號）：他握有的股份歸還給各商場現在管事的人，總股數不變、股份不會憑空消失 */
  private handOverShares(userId: number): void {
    for (const h of this.repo.holdingsOfUser(userId)) {
      const others = this.repo.members(h.mallId).filter((x) => x.userId !== userId);
      const heir = others.find((x) => x.isController) ?? others.find((x) => x.isOwner) ?? others[0];
      if (!heir) continue; // 唯一成員：商場一起解散
      const before = this.controllerOf(h.mallId);
      this.repo.setShares(h.mallId, userId, 0);
      this.repo.setShares(h.mallId, heir.userId, this.repo.sharesOf(h.mallId, heir.userId) + h.shares);
      this.noteControl(h.mallId, before);
    }
  }

  // ── 股權
  /** 持股過半的人（不論是不是成員）；沒有就是 null */
  private controllerOf(mallId: number): number | null {
    const total = this.outstanding(mallId);
    return this.repo.holdingsOfMall(mallId).find((h) => isControlling(h.shares, total))?.userId ?? null;
  }

  /** 股份動過之後：實際控制人換人了就記進動態、通知成員 */
  private noteControl(mallId: number, before: number | null): void {
    const after = this.controllerOf(mallId);
    if (after !== before) {
      if (after !== null) {
        const name = this.repo.userById(after)?.display_name ?? "股東";
        this.logActivity(mallId, name, `${name} 持股過半，成為${CONTROLLER_TITLE}`);
      } else {
        this.logActivity(mallId, "商場", `沒有人持股過半了，由創辦人管事`);
      }
    }
    this.announceMembers(mallId);
  }

  /** 持股比例掉到關係企業門檻以下的那一刻要留下紀錄，一個賽季內仍算——不然可以「兩邊都持股 → 互相貿易 → 立刻賣掉」 */
  private trailIfDropped(mallId: number, userId: number, before: number, after: number, totalBefore: number, totalAfter: number): void {
    if (isBigStake(before, totalBefore) && !isBigStake(after, totalAfter)) this.repo.addTrail(mallId, userId, this.now());
  }

  /** 流通在外的股數＝已發行 − 商場自己持有的庫藏股。持股比例、控制權、股利、帳面價值、價格全都用它算 */
  private outstanding(mallId: number): number {
    return Math.max(1, this.repo.totalSharesOf(mallId) - this.repo.treasuryOf(mallId));
  }

  private cashOf(mallId: number): number {
    return Math.round(this.summary(mallId)?.funds ?? 0);
  }

  /**
   * 商場的股權估值（淨資產＋獲利溢價，再夾進前一個遊戲日收盤估值的 ±10%，見 valuation.ts）。
   * 回購、注資換股、出價、持股價值都用它；股利與回購的「上限」仍以現金為準。不推進時間；傳 s 就用那份已同步的狀態。
   */
  private valueOf(mallId: number, s?: MallState): number {
    try {
      const st = s ?? this.load(mallId);
      return clampToAnchor(mallBookValue(st), st.valuationAnchor);
    } catch {
      return 0;
    }
  }

  private assertEquityMall(mallId: number): void {
    if (!this.repo.mallById(mallId)) throw new ServiceError(404, "找不到這座商場");
    if (this.repo.isSandbox(mallId)) throw new ServiceError(403, "測試商場沒有股權");
  }

  private static wholeShares(n: unknown, what = "股數"): number {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new ServiceError(400, `${what}要是 1 以上的整數`);
    return n;
  }

  /** 這座商場的股權表：所有股東（含被請出的），持股多的在前；也帶出回購、股利、注資要用的價格 */
  holdings(mallId: number): HoldingsView {
    const total = this.outstanding(mallId);
    const cash = this.cashOf(mallId);
    const value = this.valueOf(mallId);
    const last = this.repo.lastDividendAt(mallId);
    const readyAt = last > 0 ? last + DIVIDEND_COOLDOWN_MS : 0;
    const ready = this.now() >= readyAt;
    const holders = this.repo.holdingsOfMall(mallId);
    const people = new Map<number, { userId: number; displayName: string; isMember: boolean }>();
    for (const m of this.repo.members(mallId)) people.set(m.userId, { userId: m.userId, displayName: m.displayName, isMember: true });
    for (const h of holders) if (!people.has(h.userId)) people.set(h.userId, { userId: h.userId, displayName: h.displayName, isMember: h.isMember });
    return {
      total,
      relatedAt: Math.ceil(total * RELATED_STAKE_PCT),
      holders: holders.map((h) => ({ ...h, pct: sharePct(h.shares, total), isController: isControlling(h.shares, total) })),
      people: [...people.values()],
      treasury: this.repo.treasuryOf(mallId),
      mallCash: cash,
      equityValue: value,
      sharePrice: Math.round(issuePrice(value, total) * 100) / 100,
      dividendMax: ready ? Math.max(0, Math.floor(cash * DIVIDEND_MAX_CASH_PCT)) : 0,
      dividendReadyAt: ready ? 0 : readyAt,
    };
  }

  /** 股權變現門檻（轉讓、出價、同意買進、撤資）：帳號夠老、且在某座商場真的有在營運。who 是錯誤訊息的主詞 */
  equityBlockerOf(userId: number): string | null {
    return equityBlocker(this.repo.equityStanding(userId, { days: EQUITY_MIN_ACTIVE_DAYS, revenue: EQUITY_MIN_MALL_REVENUE }), this.now());
  }
  private assertEquityEligible(userId: number, who: string): void {
    const why = this.equityBlockerOf(userId);
    if (why) throw new ServiceError(403, who === "你" ? why : `${who}：${why}`);
  }

  /** 把自己的股份無償轉給這座商場的現任成員（整數股，不能轉給自己、不能超過持有） */
  transferShares(mallId: number, fromId: number, toId: number, shares: number): HoldingsView {
    this.assertEquityMall(mallId);
    MallService.wholeShares(shares);
    if (fromId === toId) throw new ServiceError(400, "不能轉給自己");
    const held = this.repo.sharesOf(mallId, fromId);
    if (held <= 0) throw new ServiceError(403, "你沒有這座商場的股份");
    if (shares > held) throw new ServiceError(400, `你只有 ${held.toLocaleString()} 股`);
    if (!this.repo.member(mallId, toId)) throw new ServiceError(404, "股份只能轉給這座商場的現任成員");
    this.assertEquityEligible(fromId, "你");
    this.assertEquityEligible(toId, "對方");
    const total = this.outstanding(mallId);
    const before = this.controllerOf(mallId);
    this.moveShares(mallId, fromId, toId, shares, total);
    const from = this.repo.userById(fromId)?.display_name ?? "股東";
    const to = this.repo.userById(toId)?.display_name ?? "成員";
    this.logActivity(mallId, from, `${from} 把 ${shares.toLocaleString()} 股（${sharePct(shares, total)}%）轉給了 ${to}`);
    this.noteControl(mallId, before);
    return this.holdings(mallId);
  }

  private moveShares(mallId: number, fromId: number, toId: number, shares: number, total: number): void {
    const held = this.repo.sharesOf(mallId, fromId);
    this.repo.setShares(mallId, fromId, held - shares);
    this.repo.setShares(mallId, toId, this.repo.sharesOf(mallId, toId) + shares);
    this.trailIfDropped(mallId, fromId, held, held - shares, total, total);
  }

  // ── 賣給其他股東（出價 → 對方同意且付得起才成交，照出價當下的帳面價值）
  offerShares(mallId: number, fromId: number, toId: number, shares: number): ShareOfferView[] {
    this.assertEquityMall(mallId);
    MallService.wholeShares(shares);
    if (fromId === toId) throw new ServiceError(400, "不能賣給自己");
    if (this.repo.sharesOf(mallId, fromId) < shares) throw new ServiceError(400, `你只有 ${this.repo.sharesOf(mallId, fromId).toLocaleString()} 股`);
    if (!this.repo.member(mallId, toId) && this.repo.sharesOf(mallId, toId) <= 0) throw new ServiceError(404, "只能賣給這座商場的成員或股東");
    this.assertEquityEligible(fromId, "你");
    this.assertEquityEligible(toId, "對方");
    if (this.repo.openOfferCount(mallId, fromId, this.now()) >= 5) throw new ServiceError(429, "你同時最多只能有 5 份出價，先取消幾份");
    const price = stakeValue(shares, this.valueOf(mallId), this.outstanding(mallId));
    this.repo.addOffer({ mallId, fromId, toId, shares, price, expiresAt: this.now() + OFFER_TTL_MS });
    return this.offers(mallId, fromId);
  }

  offers(mallId: number, userId: number): ShareOfferView[] {
    return this.repo.offersOfUser(mallId, userId, this.now()).map((o) => ({
      id: o.id,
      mallId,
      fromId: o.from_id,
      fromName: o.from_name,
      toId: o.to_id,
      toName: o.to_name,
      shares: o.shares,
      price: o.price,
      expiresAt: o.expires_at,
    }));
  }

  /** 買方同意：股份過去、錢（從買方錢包到賣方錢包）過來。任一方都可以取消或拒絕 */
  respondOffer(offerId: number, userId: number, accept: boolean): { mallId: number } {
    const o = this.repo.offerById(offerId);
    if (!o || o.expires_at <= this.now()) {
      if (o) this.repo.deleteOffer(offerId);
      throw new ServiceError(404, "這份出價不存在或已經過期");
    }
    if (o.from_id !== userId && o.to_id !== userId) throw new ServiceError(403, "這不是你的出價");
    if (!accept) {
      this.repo.deleteOffer(offerId);
      return { mallId: o.mall_id };
    }
    if (o.to_id !== userId) throw new ServiceError(403, "要由被出價的人同意");
    const mallId = o.mall_id;
    this.assertEquityMall(mallId);
    this.assertEquityEligible(o.from_id, "賣方");
    this.assertEquityEligible(userId, "你");
    if (this.repo.sharesOf(mallId, o.from_id) < o.shares) {
      this.repo.deleteOffer(offerId);
      throw new ServiceError(409, "賣方已經沒有這麼多股份了，出價作廢");
    }
    if (this.repo.walletOf(userId) < o.price) throw new ServiceError(402, `你的錢包只有 ${this.repo.walletOf(userId).toLocaleString()}，不夠付 ${o.price.toLocaleString()}`);
    const total = this.outstanding(mallId);
    const before = this.controllerOf(mallId);
    const mallName = this.mallNameOf(mallId);
    this.repo.addCash(userId, -o.price, this.ledger("share_buy", `${mallName} ${o.shares.toLocaleString()} 股`));
    this.repo.addCash(o.from_id, o.price, this.ledger("share_sale", `${mallName} ${o.shares.toLocaleString()} 股`));
    this.moveShares(mallId, o.from_id, userId, o.shares, total);
    this.repo.deleteOffer(offerId);
    const seller = this.repo.userById(o.from_id)?.display_name ?? "股東";
    const buyer = this.repo.userById(userId)?.display_name ?? "股東";
    this.logActivity(mallId, buyer, `${buyer} 向 ${seller} 買下 ${o.shares.toLocaleString()} 股（${sharePct(o.shares, total)}%），價款 ${o.price.toLocaleString()}`);
    this.noteControl(mallId, before);
    return { mallId };
  }

  // ── 商場回購：股份變成庫藏股，錢從商場進個人錢包（帳面價值 9 折、一次最多動用商場現金的一半）
  buybackShares(mallId: number, userId: number, shares: number): HoldingsView {
    this.assertEquityMall(mallId);
    MallService.wholeShares(shares);
    const held = this.repo.sharesOf(mallId, userId);
    if (held < shares) throw new ServiceError(400, held > 0 ? `你只有 ${held.toLocaleString()} 股` : "你沒有這座商場的股份");
    this.assertEquityEligible(userId, "你");
    this.assertCanInteract(mallId);
    const total = this.outstanding(mallId);
    const holders = this.repo.holdingsOfMall(mallId);
    if (!holders.some((h) => (h.userId === userId ? held - shares : h.shares) > 0)) throw new ServiceError(409, "商場至少要留一位股東，不能把股份全部回購");
    const st = this.sync(mallId);
    const funds = Math.floor(st.funds);
    const price = buybackPrice(shares, this.valueOf(mallId, st), total);
    if (price <= 0) throw new ServiceError(409, "商場估值不足，沒辦法回購");
    if (price > funds * BUYBACK_MAX_CASH_PCT) throw new ServiceError(409, `一次回購最多只能動用商場現金的一半（約 ${Math.floor(funds * BUYBACK_MAX_CASH_PCT).toLocaleString()}）；請分次賣，或賣給其他股東`);
    const before = this.controllerOf(mallId);
    this.mutate(mallId, (s) => {
      if (s.funds < price) throw new ServiceError(409, "商場現金不足，沒辦法回購");
      s.funds -= price;
    });
    this.repo.addCash(userId, price, this.ledger("buyback", `${this.mallNameOf(mallId)} ${shares.toLocaleString()} 股`));
    this.repo.setShares(mallId, userId, held - shares);
    this.repo.setTreasury(mallId, this.repo.treasuryOf(mallId) + shares);
    this.trailIfDropped(mallId, userId, held, held - shares, total, total - shares);
    const name = this.repo.userById(userId)?.display_name ?? "股東";
    this.logActivity(mallId, name, `${name} 把 ${shares.toLocaleString()} 股（${sharePct(shares, total)}%）賣回給商場，商場付出 ${price.toLocaleString()}`);
    this.noteControl(mallId, before);
    return this.holdings(mallId);
  }

  // ── 股利：管事的人宣布，按持股分給每位股東，收到時扣所得稅；商場支出＝各股東稅前加總
  declareDividend(mallId: number, userId: number, amount: number): { view: HoldingsView; paid: number; tax: number } {
    this.assertEquityMall(mallId);
    this.assertAuthority(mallId, userId, "宣布發股利");
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < DIVIDEND_MIN) throw new ServiceError(400, `股利一次至少 ${DIVIDEND_MIN.toLocaleString()}（整數）`);
    this.assertCanInteract(mallId);
    const last = this.repo.lastDividendAt(mallId);
    if (last > 0 && this.now() < last + DIVIDEND_COOLDOWN_MS) throw new ServiceError(409, "還在冷卻中，兩次股利之間要隔 2 天（約 12 遊戲日）");
    const funds = Math.floor(this.sync(mallId).funds);
    const cap = Math.floor(funds * DIVIDEND_MAX_CASH_PCT);
    if (amount > cap) throw new ServiceError(409, `一次最多發商場現金的 30%（目前 ${cap.toLocaleString()}）`);
    const total = this.outstanding(mallId);
    const split = splitDividend(amount, total, this.repo.holdingsOfMall(mallId));
    if (split.paid <= 0) throw new ServiceError(409, "金額太小，分不到任何一位股東");
    this.mutate(mallId, (s) => {
      if (s.funds < split.paid) throw new ServiceError(409, "商場現金不足");
      s.funds -= split.paid;
    });
    const mallName = this.mallNameOf(mallId);
    for (const l of split.lines) this.repo.addCash(l.userId, l.net, this.ledger("dividend", `${mallName}（稅前 ${l.gross.toLocaleString()}，扣稅 ${l.tax.toLocaleString()}）`));
    this.repo.setLastDividendAt(mallId, this.now());
    const name = this.repo.userById(userId)?.display_name ?? "管理者";
    this.logActivity(mallId, name, `${name} 宣布發放股利 ${split.paid.toLocaleString()}（股東共扣所得稅 ${split.tax.toLocaleString()}）`);
    return { view: this.holdings(mallId), paid: split.paid, tax: split.tax };
  }

  // ── 注資換股：成員從個人錢包拿錢投入商場，照帳面價值每股的價格換股份
  capitalRequests(mallId: number): CapitalRequestView[] {
    const value = this.valueOf(mallId);
    const total = this.outstanding(mallId);
    return this.repo.capitalRequests(mallId, this.now()).map((r) => ({
      id: r.id,
      mallId,
      userId: r.user_id,
      userName: r.user_name,
      amount: r.amount,
      expiresAt: r.expires_at,
      estShares: sharesForCapital(r.amount, value, total).shares,
    }));
  }

  /** 申請注資；申請人自己就是管事的人，就直接成交。回傳是否已成交 */
  requestCapital(mallId: number, userId: number, amount: number): { applied: boolean; shares: number } {
    this.assertEquityMall(mallId);
    if (!this.repo.member(mallId, userId)) throw new ServiceError(403, "只有商場成員可以注資");
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) throw new ServiceError(400, "金額要是 1 以上的整數");
    if (this.repo.walletOf(userId) < amount) throw new ServiceError(402, `你的錢包只有 ${this.repo.walletOf(userId).toLocaleString()}，不夠投入 ${amount.toLocaleString()}`);
    const est = sharesForCapital(amount, this.valueOf(mallId), this.outstanding(mallId));
    if (est.shares < 1) throw new ServiceError(400, `這筆錢換不到 1 股（每股約 ${Math.ceil(est.price).toLocaleString()}）`);
    if (this.authorityOf(mallId) === userId) return { applied: true, shares: this.applyCapital(mallId, userId, amount) };
    this.repo.setCapitalRequest(mallId, userId, amount, this.now() + OFFER_TTL_MS);
    return { applied: false, shares: est.shares };
  }

  /** 管事的人核准或拒絕。申請人也可以自己撤回（拒絕＝撤回） */
  respondCapital(requestId: number, userId: number, accept: boolean): { mallId: number } {
    const r = this.repo.capitalRequestById(requestId);
    if (!r || r.expires_at <= this.now()) {
      if (r) this.repo.deleteCapitalRequest(requestId);
      throw new ServiceError(404, "這份注資申請不存在或已經過期");
    }
    if (!accept && r.user_id === userId) {
      this.repo.deleteCapitalRequest(requestId);
      return { mallId: r.mall_id };
    }
    this.assertAuthority(r.mall_id, userId, accept ? "核准注資" : "回覆注資申請");
    this.repo.deleteCapitalRequest(requestId);
    if (!accept) return { mallId: r.mall_id };
    if (!this.repo.member(r.mall_id, r.user_id)) throw new ServiceError(409, "申請人已經不在商場裡了");
    if (this.repo.walletOf(r.user_id) < r.amount) throw new ServiceError(409, "申請人的錢包已經不夠了");
    this.applyCapital(r.mall_id, r.user_id, r.amount);
    return { mallId: r.mall_id };
  }

  /** 成交：先賣庫藏股、不夠再發新股；價格是成交當下的帳面價值每股（原股東被稀釋，但每股帳面價值不變） */
  private applyCapital(mallId: number, userId: number, amount: number, source: "wallet" | "grant" = "wallet"): number {
    this.assertCanInteract(mallId);
    const issuedTotal = this.repo.totalSharesOf(mallId); // 已發行（含庫藏股）
    const total = this.outstanding(mallId); // 流通在外：比例、價格都用它（庫藏股是商場自己的，不算）
    const { shares, cost } = sharesForCapital(amount, this.valueOf(mallId, this.sync(mallId)), total);
    if (shares < 1) throw new ServiceError(400, "這筆錢換不到 1 股");
    const treasury = this.repo.treasuryOf(mallId);
    const fromTreasury = Math.min(treasury, shares);
    const issued = shares - fromTreasury;
    if (issuedTotal + issued > MAX_TOTAL_SHARES) throw new ServiceError(409, "這座商場的股數已達上限，不能再發新股");
    const before = this.controllerOf(mallId);
    const holders = this.repo.holdingsOfMall(mallId);
    this.mutate(mallId, (s) => {
      s.funds += cost;
    });
    if (source === "wallet") this.repo.addCash(userId, -cost, this.ledger("capital", `${this.mallNameOf(mallId)} 取得 ${shares.toLocaleString()} 股`)); // 起始資金（grant）不從錢包扣：那是這位玩家一次性的創業資金
    this.repo.setTreasury(mallId, treasury - fromTreasury);
    this.repo.setTotalShares(mallId, issuedTotal + issued);
    this.repo.setShares(mallId, userId, this.repo.sharesOf(mallId, userId) + shares);
    // 流通股數變多了（買庫藏股或新發都是）：有人因此掉到關係企業門檻以下，一樣要留紀錄
    for (const h of holders) if (h.userId !== userId) this.trailIfDropped(mallId, h.userId, h.shares, h.shares, total, total + shares);
    const name = this.repo.userById(userId)?.display_name ?? "成員";
    this.logActivity(
      mallId,
      name,
      `${name} ${source === "grant" ? "投入起始資金" : "注資"} ${cost.toLocaleString()}，取得 ${shares.toLocaleString()} 股（${sharePct(shares, total + shares)}%）${issued > 0 ? `，其中新發 ${issued.toLocaleString()} 股` : "，全部來自庫藏股"}`,
    );
    this.noteControl(mallId, before);
    return shares;
  }

  /**
   * 加入商場時，把自己一次性的起始資金（INITIAL_FUNDS）投進這座商場，照當下的帳面價值換股份——
   * 起始資金是「每位玩家一次」：五個人合開的商場就有五人份的資金，不是一人份。已經用過（開過或加入過商場）就什麼都不做。
   * 由 API 路由在加入成功後呼叫；失敗（例如商場落後伺服器時間太多）就不扣，下次再試。
   */
  contributeGrant(mallId: number, userId: number): { contributed: boolean; shares: number } {
    if (this.repo.foundedCount(userId) > 0 || this.repo.isSandbox(mallId) || !this.repo.member(mallId, userId)) return { contributed: false, shares: 0 };
    const shares = this.applyCapital(mallId, userId, INITIAL_FUNDS, "grant");
    this.repo.bumpFounded(userId);
    return { contributed: true, shares };
  }

  /**
   * 管理用、只跑一次：把「已經在營運中、成員沒各自投入起始資金」的商場補成「每人一份」。
   * 每位還沒用過起始資金的成員補一份 INITIAL_FUNDS 進商場，並讓所有人（含創辦人）均分股份——
   * 是「大家一起創業、各出一份」的算法，不是照目前的帳面價值買進。只在創辦人還持有全部股份時才做，已經分過股的商場請手動處理。
   */
  adminSettleGrants(mallId: number): { topUp: number; grantees: string[]; each: number; total: number } {
    this.assertEquityMall(mallId);
    const members = this.repo.members(mallId);
    const total = this.repo.totalSharesOf(mallId);
    const holders = this.repo.holdingsOfMall(mallId);
    const owner = holders.length === 1 && holders[0]!.shares === total && this.repo.treasuryOf(mallId) === 0 ? holders[0]! : null;
    const grantees = members.filter((m) => m.userId !== owner?.userId && this.repo.foundedCount(m.userId) === 0);
    if (grantees.length === 0) return { topUp: 0, grantees: [], each: 0, total };
    if (!owner) throw new ServiceError(409, "這座商場的股份已經分過了，請手動處理");
    const k = grantees.length + 1;
    const each = Math.floor(total / k);
    const before = this.controllerOf(mallId);
    const topUp = grantees.length * INITIAL_FUNDS;
    this.mutate(mallId, (s) => {
      s.funds += topUp;
    });
    for (const g of grantees) {
      this.repo.setShares(mallId, g.userId, each);
      this.repo.bumpFounded(g.userId);
    }
    this.repo.setShares(mallId, owner.userId, total - each * grantees.length);
    this.logActivity(mallId, "商場", `補上 ${grantees.length} 位成員各一份起始資金（共 ${topUp.toLocaleString()}），${k} 人均分股份，每人約 ${sharePct(each, total)}%`);
    this.noteControl(mallId, before);
    return { topUp, grantees: grantees.map((g) => g.displayName), each, total };
  }

  /**
   * 開新商場：每位玩家只有第一座商場是免費的起始資金（INITIAL_FUNDS，視為創辦人投入），
   * 之後每開一座就要從個人錢包拿出同樣一筆錢，不然多開商場就等於憑空生錢。
   * 由 API 路由呼叫（測試與管理用的直接建立不收費）。
   */
  chargeFounding(userId: number): void {
    if (this.repo.foundedCount(userId) === 0) return;
    const cash = this.repo.walletOf(userId);
    if (cash < FOUNDING_COST) throw new ServiceError(402, `你已經用過免費的起始資金了；再開一座商場要自己出資 ${FOUNDING_COST.toLocaleString()}（從個人錢包），你目前有 ${cash.toLocaleString()}`);
    this.repo.addCash(userId, -FOUNDING_COST, this.ledger("founding", "開新商場的創業資金"));
  }

  /** 錢包流水的標記（種類、備註、現在時間）；所有動錢包的地方都要帶上，個人財務頁的「明細」才完整 */
  private ledger(kind: LedgerKind, note: string): { kind: LedgerKind; note: string; at: number } {
    return { kind, note, at: this.now() };
  }

  private mallNameOf(mallId: number): string {
    return this.repo.mallById(mallId)?.name ?? `商場 #${mallId}`;
  }

  /** 一位玩家的持股與帳面價值：持股比例 × 商場帳上現金，加上個人錢包（不推進時間，只看目前存檔／快取） */
  wealth(userId: number): WealthView {
    const stakes = this.repo.holdingsOfUser(userId).map((h) => {
      const cash = this.cashOf(h.mallId);
      const total = this.outstanding(h.mallId);
      return { mallId: h.mallId, mallName: h.mallName, shares: h.shares, pct: sharePct(h.shares, total), mallCash: cash, value: stakeValue(h.shares, this.valueOf(h.mallId), total), isMember: h.isMember };
    });
    const cash = this.repo.walletOf(userId);
    const portfolio = this.market.portfolio(userId).value;
    // 商場持有的股票（法人投資）的市價已併入商場估值（holdMark），所以 stakes 已經包含它；
    // corporate 只是「其中屬於法人持股的部分」，給畫面拆開顯示，不重複加進 totalValue
    const corporate = this.repo
      .holdingsOfUser(userId)
      .reduce((a, h) => a + (this.repo.isSandbox(h.mallId) ? 0 : stakeValue(h.shares, this.corporateValueOf(h.mallId), this.outstanding(h.mallId))), 0);
    return {
      stakes,
      foundCost: this.repo.foundedCount(userId) === 0 ? 0 : FOUNDING_COST,
      cash,
      portfolio,
      corporate,
      totalValue: stakes.reduce((a, x) => a + x.value, 0) + portfolio + cash,
    };
  }

  // ───────── 法人投資：商場用公司資金買賣上市股票 ─────────

  /** 一座商場持有的股票「市價淨值」（扣一次賣出手續費；估值用，`MallState.holdMark`） */
  private holdingsNet(mallId: number): number {
    return this.repo.mallPositions(mallId).reduce((a, p) => a + corporateSellQuote(this.market.price(p.company), p.shares, { shares: p.shares, costTotal: p.costTotal }).net, 0);
  }

  /** 把持股市價淨值寫進商場狀態（估值與日終錨點用）；沒有持股也沒有舊值就不碰狀態。變動夠大才寫（避免每次價格跳動都存檔） */
  private markHoldings(mallId: number, s: MallState, force = false): boolean {
    if (s.holdMark === undefined && this.repo.mallPositions(mallId).length === 0) return false;
    const hn = this.holdingsNet(mallId);
    const cur = s.holdMark ?? 0;
    if (!force && Math.abs(hn - cur) <= Math.max(1000, cur * 0.02) && !(hn === 0 && cur !== 0)) return false;
    s.holdMark = hn;
    return true;
  }

  /** 一座商場持有的股票現值 */
  private corporateValueOf(mallId: number): number {
    return this.repo.mallPositions(mallId).reduce((a, p) => a + this.market.price(p.company) * p.shares, 0);
  }

  private corporateAccount(mallId: number): CorporateAccount {
    const s = this.sync(mallId);
    const funds = Math.round(s.funds);
    const holdings: CorporateHolding[] = this.repo.mallPositions(mallId).flatMap((p) => {
      const g = stockGroupOf(p.company);
      if (!g) return [];
      const price = this.market.price(p.company);
      const value = price * p.shares;
      return [{ key: p.company, name: g.name, sector: g.sector, shares: p.shares, cost: p.costTotal, price, value, pnl: value - p.costTotal, pct: Math.round((p.shares / g.shares) * 10_000) / 100 }];
    });
    const value = holdings.reduce((a, h) => a + h.value, 0);
    const blocked = financeBlocker(this.serverTick() - s.tick);
    return { mallId, mallName: this.mallNameOf(mallId), funds, holdings, value, cost: holdings.reduce((a, h) => a + h.cost, 0), room: corporateRoomValue(funds, value), canTrade: blocked === null, blocked };
  }

  /** 我管事的商場（非測試商場）的法人投資帳戶 */
  corporateView(userId: number): CorporateView {
    const accounts = this.repo
      .mallsOfUser(userId)
      .filter((m) => !this.repo.isSandbox(m.id) && this.authorityOf(m.id) === userId)
      .map((m) => this.corporateAccount(m.id));
    return { accounts, singleCap: CORPORATE_STAKE_CAP_PCT, totalCap: CORPORATE_TOTAL_CAP_PCT, disclosurePct: DISCLOSURE_PCT, feeRate: MARKET_FEE_RATE, taxRate: MARKET_TAX_RATE };
  }

  /** 商場用公司資金買進／賣出上市股票（只有管事的人；開市中、價格是現價；上限見 shared/src/game/corporate.ts） */
  corporateTrade(userId: number, mallId: number, key: string, side: "buy" | "sell", sharesIn: unknown): TradeResult & { mallId: number } {
    if (this.repo.isSandbox(mallId)) throw new ServiceError(403, "測試商場不能做投資");
    if (!this.repo.mallById(mallId)) throw new ServiceError(404, "找不到這座商場");
    this.assertAuthority(mallId, userId, "動用公司資金投資");
    const g = stockGroupOf(key);
    if (!g) throw new ServiceError(404, "找不到這檔股票");
    if (typeof sharesIn !== "number" || !Number.isInteger(sharesIn) || sharesIn < 1 || sharesIn > 1_000_000_000) throw new ServiceError(400, "股數要是 1 以上的整數");
    const shares = sharesIn;
    this.market.settle();
    const acct = this.corporateAccount(mallId);
    if (acct.blocked) throw new ServiceError(400, acct.blocked);
    const price = this.market.livePrice(key);
    const pos = this.repo.mallPositionOf(mallId, key);
    const at = this.now();
    const name = this.mallNameOf(mallId);
    if (side === "buy") {
      const cap = corporateCap({ outstanding: g.shares, held: pos.shares, price, mallCash: acct.funds, portfolioValue: acct.value });
      if (shares > cap.maxShares) {
        const why =
          cap.binding === "stock"
            ? `單一集團最多持有流通股的 ${CORPORATE_STAKE_CAP_PCT * 100}%，這檔還能買 ${cap.byStock.toLocaleString()} 股`
            : cap.binding === "total"
              ? `全部投資的市值最多占公司現金的 ${CORPORATE_TOTAL_CAP_PCT * 100}%，這檔最多還能買 ${cap.byTotal.toLocaleString()} 股`
              : `公司資金不足（最多買 ${cap.byCash.toLocaleString()} 股）`;
        throw new ServiceError(409, why);
      }
      const q = buyQuote(price, shares);
      this.repo.tx(() => {
        this.mutate(mallId, (s) => {
          if (s.funds < q.total) throw new ServiceError(409, "公司資金不足");
          s.funds -= q.total;
        });
        this.repo.setMallPosition(mallId, key, pos.shares + shares, pos.costTotal + q.total);
        if (disclosureCrossing(pos.shares, pos.shares + shares, g.shares) === "up") this.repo.addDisclosure({ company: key, holder: name, pct: ((pos.shares + shares) / g.shares) * 100, kind: "cross", at });
      });
      this.logActivity(mallId, "投資", `買進 ${g.name} ${shares.toLocaleString()} 股 @ ${price.toLocaleString()}（含手續費 ¥${q.total.toLocaleString()}）`);
      this.mutate(mallId, (s) => void this.markHoldings(mallId, s, true));
      return { mallId, key, side, shares, price, fee: q.fee, tax: 0, cash: -q.total, gain: 0 };
    }
    if (pos.shares < shares) throw new ServiceError(409, pos.shares > 0 ? `公司只有 ${pos.shares.toLocaleString()} 股` : "公司沒有這檔股票");
    const q = corporateSellQuote(price, shares, { shares: pos.shares, costTotal: pos.costTotal });
    this.repo.tx(() => {
      this.mutate(mallId, (s) => {
        s.funds += q.net;
        s.today.invest = (s.today.invest ?? 0) + q.gain; // 稅前已實現損益併入日報與年度所得（虧損可結轉）
      });
      this.repo.setMallPosition(mallId, key, pos.shares - shares, pos.costTotal - q.costBasis);
      if (disclosureCrossing(pos.shares, pos.shares - shares, g.shares) === "down") this.repo.addDisclosure({ company: key, holder: name, pct: ((pos.shares - shares) / g.shares) * 100, kind: "drop", at });
    });
    this.logActivity(mallId, "投資", `賣出 ${g.name} ${shares.toLocaleString()} 股 @ ${price.toLocaleString()}（${q.gain >= 0 ? `獲利 ¥${q.gain.toLocaleString()}` : `虧損 ¥${(-q.gain).toLocaleString()}`}，併入年度所得決算課稅）`);
    this.mutate(mallId, (s) => void this.markHoldings(mallId, s, true));
    return { mallId, key, side, shares, price, fee: q.fee, tax: q.tax, cash: q.net, gain: q.gain };
  }

  /** 個人財務頁：我在所有商場的持股、和我有關的出價（收到的與送出的）、需要我處理（或我送出）的注資申請 */
  personalEquity(userId: number): PersonalEquityView {
    const stakes = this.wealth(userId).stakes;
    const mallIds = new Set([...this.repo.mallsOfUser(userId).map((m) => m.id), ...stakes.map((s) => s.mallId)]);
    const offers: ShareOfferView[] = [];
    const requests: CapitalRequestView[] = [];
    for (const id of mallIds) {
      if (this.repo.isSandbox(id)) continue;
      offers.push(...this.offers(id, userId));
      const all = this.capitalRequests(id);
      requests.push(...(this.authorityOf(id) === userId ? all : all.filter((r) => r.userId === userId)));
    }
    return { stakes, offers, requests };
  }

  /** 管理用：商場的簡要狀況（不推進時間，只讀目前的快取或存檔） */
  summary(mallId: number): { level: number; funds: number; tick: number; day: number; flags: Record<string, boolean>; lag: number | null; paused: boolean } | null {
    try {
      const s = this.load(mallId);
      // 落後伺服器基準時間幾個 tick；測試商場不受夾限，沒有這個概念（null）
      const lag = this.serverFor(mallId) ? Math.max(0, this.serverTick() - s.tick) : null;
      return { level: s.level, funds: Math.round(s.funds), tick: s.tick, day: Math.floor((s.tick - s.meta.startTick) / 288), flags: s.flags, lag, paused: isPaused(s.clock) };
    } catch {
      return null;
    }
  }

  /** 管理用：解散商場 */
  dissolveMall(mallId: number): void {
    this.alliances.dropMall(mallId);
      this.repo.deleteMall(mallId);
    this.forget(mallId);
  }

  /** 管理用：強制刪除使用者；他創辦且還有別人的商場，先把創辦人轉給最早加入的其他成員 */
  adminDeleteUser(userId: number): void {
    this.handOverShares(userId);
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
    this.recordBalance(mallId, s);
  }

  /** 平衡分析：每份新的日報存成永久的一列（第一次載入時順便補進商場還留著的最近 30 天；測試商場不記） */
  private balanceLast = new Map<number, number>();
  private recordBalance(mallId: number, s: MallState): void {
    const newest = s.reports[s.reports.length - 1];
    if (!newest) return;
    let last = this.balanceLast.get(mallId);
    if (last === undefined) {
      last = this.repo.lastBalanceDay(mallId);
      this.balanceLast.set(mallId, last);
    }
    if (newest.day <= last || this.repo.isSandbox(mallId)) return;
    const members = this.repo.memberCount(mallId);
    for (const r of s.reports) {
      if (r.day > last) this.repo.addBalanceDay(balanceRow(mallId, r, s, members, r === newest, this.now()));
    }
    this.balanceLast.set(mallId, newest.day);
  }

  /** 依這座商場的時鐘，把狀態推進到「現在」 */
  private advanceNow(mallId: number, s: MallState, atMs: number): MallState {
    const server = this.serverFor(mallId);
    const target = tickAt(s.clock, atMs, server);
    const ctx = { nobodyPresent: this.nobodyPresentFor(mallId, s) };
    // 帶生效 tick 的信（聯名、搶客、貿易…）：推進到那個 tick 才套用，落後的商場不會把效果套在自己的過去。
    // 中途被重要事件停住、或這一輪的工作量到上限時，來不及到達的信留在信箱，下次再收。
    let cur = s;
    for (const m of this.repo.dueTimedMail(mallId, atMs, target)) {
      if (m.atTick > cur.tick) {
        if (isPaused(cur.clock)) break; // 暫停中（或被事件停住）：時間不走，信先放著
        cur = advanceTo(cur, m.atTick, ctx, server);
      }
      if (cur.tick < m.atTick) break;
      if (cur === s) cur = structuredClone(s);
      applyMail(cur, m);
      this.repo.markMailDelivered([m.id]);
    }
    return isPaused(cur.clock) ? cur : advanceTo(cur, target, ctx, server);
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
    // 樓層空地化（階段 C）：環境變數 OPEN_PLAN_ENABLED=1 對全服啟用；否則只有管理室開了旗標的商場（sandbox 先試）
    if (process.env.OPEN_PLAN_ENABLED === "1" && !openPlanEnabled(s)) {
      s = s === before ? structuredClone(s) : s;
      s.flags[OPEN_PLAN_FLAG] = true;
    }
    // 法人持股的市價淨值寫進狀態（併入股權估值與日終錨點；只有持股的商場才會動到）
    if (!this.repo.isSandbox(mallId)) {
      const probe = { ...s };
      if (this.markHoldings(mallId, probe)) {
        s = s === before ? structuredClone(s) : s;
        s.holdMark = probe.holdMark;
      }
    }
    s = this.advanceNow(mallId, s, nowMs);
    if (this.serverFor(mallId)) {
      // 舊版有比伺服器同速更慢的檔位（悠閒、現實…）；現在最慢就是 1×（暫停才是慢慢玩的方式）。
      // 檔位也一律對齊到現有的幾檔；從現在起生效，不會讓時間跳動
      const snapped = Math.max(SLOWEST_SPEED, presetOfSpeed(s.clock.speed).mult);
      if (s.clock.speed > 0 && s.clock.speed !== snapped) {
        s = s === before ? structuredClone(s) : s;
        s.clock.speed = snapped;
        if (!isPaused(s.clock)) reanchor(s.clock, s.tick, nowMs);
      }
      // 落後伺服器基準時間幾個 tick：畫面據此顯示「追趕中」。沒有其他變化時，變動夠大才寫入，避免暫停中的商場一直寫資料庫
      const lag = Math.max(0, this.repo.serverTick(nowMs) - s.tick);
      if (s.clock.lag === undefined || s !== before || Math.abs(lag - s.clock.lag) >= TICKS_PER_DAY / 2) {
        s = s === before ? structuredClone(s) : s;
        s.clock.lag = lag;
      }
    }

    this.refreshDirectory(mallId, s, nowMs);
    if (s !== before) {
      this.cache.set(mallId, s);
      this.persist(mallId, s);
      this.announceNewHolds(mallId, before, s);
      if (this.lastEmittedTick.get(mallId) !== s.tick) {
        this.lastEmittedTick.set(mallId, s.tick);
        this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, s) });
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
    if (this.repo.isSandbox(mallId)) {
      this.repo.removeDirectory(mallId); // 測試商場獨立於世界之外：不進名錄、排行與賽季
      return;
    }
    const counts = new Map<string, number>();
    for (const sh of s.shops) counts.set(sh.category, (counts.get(sh.category) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const out = s.shops.filter((x) => x.mode === "direct" && x.tenant === null && CATEGORY_BY_ID[x.category] && categoryHasStock(CATEGORY_BY_ID[x.category]!) && x.stock < 1);
    const stockoutCats = [...new Set(out.map((x) => CATEGORY_BY_ID[x.category]!.name))].slice(0, 6);
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
      stockouts: out.length,
      stockoutCats,
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
      this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, s) });
    }
    return s;
  }

  /** 某家金融機構現在的授信氣候：看它自己的股價與大盤（三檔金融股平均）相對近一個月均價的偏離。每分鐘最多重算一次 */
  private climateCache = new Map<string, { at: number; value: { level: Climate; note: string } }>();
  private climateOf(lender: keyof typeof LENDERS): { level: Climate; note: string } {
    const nowMs = this.now();
    const hit = this.climateCache.get(lender);
    if (hit && nowMs - hit.at < 60_000) return hit.value;
    let value: { level: Climate; note: string };
    try {
      const own = this.market.trend(LENDERS[lender].stock);
      const all = LENDER_ORDER.map((k) => this.market.trend(LENDERS[k].stock));
      value = creditClimate(own, all.reduce((a, b) => a + b, 0) / all.length);
    } catch {
      value = { level: "normal", note: "市場資料暫時取不到，授信照常" }; // 股市還沒啟動（測試或剛開站）：不擋借款
    }
    this.climateCache.set(lender, { at: nowMs, value });
    return value;
  }

  /** 融資與保險頁：各機構的授信氣候與每個產品的預審（不扣任何東西） */
  financeView(mallId: number, userId: number): FinanceView {
    const s = this.sync(mallId);
    const blocked = this.serverFor(mallId) ? financeBlocker(this.serverTick() - s.tick) : null;
    const input = underwriteInput(s);
    const climates = {} as FinanceView["climates"];
    for (const id of LENDER_ORDER) {
      const c = this.climateOf(id);
      climates[id] = { level: c.level, label: CLIMATES[c.level].label, note: c.note };
    }
    const quotes = PRODUCT_ORDER.map((p) => underwrite(input, p, climates[PRODUCTS[p].lender].level, s.finance));
    return { climates, quotes, canTake: blocked === null, blocked, isAuthority: this.authorityOf(mallId) === userId };
  }

  getState(mallId: number, touch: boolean): PublicMallState {
    let s = this.sync(mallId);
    if (touch) s = this.visit(mallId, s);
    return this.pub(mallId, s);
  }

  runCommand(mallId: number, user: { id: number; displayName: string }, cmd: Command): CommandResult & { publicState?: PublicMallState } {
    let current = this.sync(mallId);
    current = this.visit(mallId, current);
    if (cmd.type === "takeLoan" || cmd.type === "setBizInsurance") {
      // 借款與投保花公司的錢：只有管事的人；借款還要追上伺服器時間（避免用舊資訊套利）
      this.assertAuthority(mallId, user.id, cmd.type === "takeLoan" ? "向金融機構借款" : "投保營業中斷險");
    }
    if (cmd.type === "takeLoan") {
      const blocked = this.serverFor(mallId) ? financeBlocker(this.serverTick() - current.tick) : null;
      if (blocked) return { ok: false, error: blocked };
      // 授信氣候由伺服器依該機構的股價走勢決定，前端送的 terms 一律覆蓋
      const product = PRODUCTS[cmd.product];
      cmd = { ...cmd, terms: { climate: product ? this.climateOf(product.lender).level : "normal" } };
    }
    const result = applyCommand(current, cmd, { id: String(user.id), name: user.displayName });
    if (!result.ok) return result;
    const after = result.state;
    // 股權變現門檻的「活躍遊戲日」：用伺服器時間的遊戲日，同一天只算一次（狂點沒用）
    this.repo.recordActiveDay(mallId, user.id, dayOfTick(this.serverTick()));
    // 處理完重要事件、時鐘從暫停回到運轉：錨點移到現在，暫停期間不補算
    if (isPaused(current.clock) && !isPaused(after.clock)) reanchor(after.clock, after.tick, this.now());
    this.cache.set(mallId, after);
    this.persist(mallId, after);
    this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, after) });
    const text = describeCommand(current, cmd, user.displayName);
    if (text) this.logActivity(mallId, user.displayName, text);
    return { ...result, state: after, publicState: this.pub(mallId, after) };
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
      notes.push(`把追趕速度調成「${preset.name}」（落後伺服器時間時用；已追上就和伺服器同速，真實 ${REAL_HOURS_PER_GAME_DAY} 小時＝1 遊戲日）`);
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
    this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, next) });
    this.logActivity(mallId, user.displayName, `${user.displayName} ${notes.join("、")}`);
    return this.pub(mallId, next);
  }

  /** 團隊動態：跨商場行動（聯名等）留下紀錄 */
  // ── 管理用（Overseer）：直接改商場與成員。每一個都由呼叫端負責寫稽核紀錄。
  adminRenameMall(mallId: number, name: string): void {
    if (!this.repo.mallById(mallId)) throw new ServiceError(404, "找不到這座商場");
    this.repo.renameMall(mallId, name);
    this.lastDirectory.delete(mallId);
    this.refreshDirectory(mallId, this.load(mallId), this.now(), true);
    this.announceMembers(mallId);
  }

  adminSetFunds(mallId: number, funds: number): void {
    if (!Number.isFinite(funds) || Math.abs(funds) > 1e12) throw new ServiceError(400, "金額不正確");
    this.mutate(mallId, (s) => {
      s.funds = Math.round(funds);
    });
  }

  adminSetLevel(mallId: number, level: number): void {
    if (!Number.isInteger(level) || level < 1 || level > LEVELS.length) throw new ServiceError(400, `等級要在 1–${LEVELS.length} 之間`);
    this.mutate(mallId, (s) => {
      s.level = level;
      const need = LEVELS.find((l) => l.level === level)!;
      if (s.totalRevenue < need.minRevenue) s.totalRevenue = need.minRevenue; // 不然下一次結算會覺得等級「不對」
    });
  }

  adminAddMember(mallId: number, userId: number, role: RoleId = "ops"): void {
    if (!this.repo.mallById(mallId)) throw new ServiceError(404, "找不到這座商場");
    const u = this.repo.userById(userId);
    if (!u) throw new ServiceError(404, "找不到這位使用者");
    if (u.role === "overseer") throw new ServiceError(400, "Overseer 不加入商場；要看請用旁觀");
    if (this.repo.member(mallId, userId)) throw new ServiceError(409, "他已經在這座商場裡了");
    this.repo.addMember(mallId, userId, ROLE_IDS.includes(role) ? role : "ops", this.repo.memberCount(mallId) === 0, this.now());
    if (this.repo.holdingsOfMall(mallId).length === 0) this.repo.setAllShares(mallId, userId, INITIAL_SHARES); // 沒有任何股東的商場，第一位成員拿全部
    this.afterMemberAdded(mallId);
    this.announceMembers(mallId);
  }

  /** 移出成員；如果他是創辦人，創辦人自動交給最早加入的其他成員；最後一人不能移出（要解散請用解散商場） */
  adminRemoveMember(mallId: number, userId: number): void {
    const m = this.repo.member(mallId, userId);
    if (!m) throw new ServiceError(404, "他不在這座商場裡");
    const rest = this.repo.members(mallId).filter((x) => x.userId !== userId);
    if (rest.length === 0) throw new ServiceError(409, "這是最後一位成員，要移除請改用「解散商場」");
    this.repo.removeMember(mallId, userId, this.now());
    if (m.is_owner) this.repo.setOwner(mallId, rest[0]!.userId, true);
    this.announceMembers(mallId);
  }

  adminSetOwner(mallId: number, userId: number): void {
    if (!this.repo.member(mallId, userId)) throw new ServiceError(404, "他不在這座商場裡");
    for (const m of this.repo.members(mallId)) this.repo.setOwner(mallId, m.userId, m.userId === userId);
    this.announceMembers(mallId);
  }

  /** 管理用：替一批商場寄一封信（天氣、事件…）並立刻交給商場；回傳實際寄出的商場數。"all" 不含測試商場 */
  adminBroadcast(malls: "all" | number[], kind: string, payload: Record<string, unknown>): number {
    const ids = malls === "all" ? this.repo.allMalls().filter((m) => !m.sandbox).map((m) => m.id) : malls.filter((id) => this.repo.mallById(id));
    const t = this.now();
    for (const id of ids) {
      this.repo.addMail(id, kind, payload, t, t);
      this.sync(id);
    }
    return ids.length;
  }

  /** 寄一則通知給商場（出現在待辦與日誌裡） */
  adminNotice(mallId: number, text: string): void {
    if (!this.repo.mallById(mallId)) throw new ServiceError(404, "找不到這座商場");
    const t = this.now();
    this.repo.addMail(mallId, "notice", { text }, t, t);
    this.sync(mallId);
  }

  /** 世界功能（聯名、貿易、搶客）：測試商場不參與 */
  assertInWorld(mallId: number): void {
    if (this.repo.isSandbox(mallId)) throw new ServiceError(403, "測試商場獨立於世界之外，不能聯名、貿易或搶客");
  }

  logWorld(mallId: number, actor: string, text: string): void {
    this.logActivity(mallId, actor, `${actor} ${text}`);
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
    this.emit(mallId, { type: "state", mallId, state: this.pub(mallId, s) });
    return this.pub(mallId, s);
  }

  /** 股市排程：處理預約單與配息，並在每個遊戲日 16:00（JST）之後為每位玩家記一筆資產快照（資產走勢用） */
  tickMarket(): void {
    this.market.tick();
    const g = gstepAt(this.now(), this.serverClock);
    const day = dayOfGstep(g);
    if (stepOfDayOf(g) < (STEPS_PER_DAY * 2) / 3 || this.lastSnapshotDay === day) return; // 16:00
    for (const id of this.repo.playerIds()) {
      if (this.repo.hasWealthSnapshot(id, day)) continue;
      try {
        const w = this.wealth(id);
        this.repo.saveWealthSnapshot(id, day, { cash: w.cash, stakes: Math.max(0, w.stakes.reduce((a, s) => a + s.value, 0) - w.corporate), stocks: w.portfolio, corporate: w.corporate, total: w.totalValue });
      } catch (e) {
        console.error(`wealth snapshot failed for user ${id}`, e);
      }
    }
    this.lastSnapshotDay = day;
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
      this.alliances.tick();
      this.npcActor.tick();
    } catch (e) {
      console.error("world tick failed", e);
    }
  }
}
