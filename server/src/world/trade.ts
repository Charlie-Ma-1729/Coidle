import {
  CATEGORY_BY_ID,
  TRADE_DAY_MS,
  TRADE_KEEP_FUNDS,
  TRADE_MAX_GOODS,
  TRADE_MAX_PER_DAY,
  TRADE_MIN_FUNDS,
  TRADE_MIN_GOODS,
  TRADE_NET_WINDOW_MS,
  afterFee,
  categoryHasStock,
  tradeLimits,
  type MallState,
} from "@coidle/shared";
import type { Repo } from "../db/repo";
import { ServiceError } from "../services/errors";
import { applyIndexDelta } from "../sim/events";

// 貿易：商場之間互相調貨與送錢支援。
// 轉移是伺服器層的同步交易：先從轉出方扣、寫下紀錄，再用信箱把「收到」交給對方，
// 對方照自己的時鐘入帳（暫停中的商場也收得到，只是時間不會走）。
// 防濫用：每筆與每日上限、同一對商場 7 天的單向淨流量上限、5% 手續費（轉越多越虧）。

export interface TradeHost {
  /** 把商場推進到現在，回傳（未複製的）狀態；只讀 */
  peek(mallId: number): MallState;
  /** 在商場上做一次同步修改：fn 丟出 ServiceError 就整個取消 */
  mutate(mallId: number, fn: (s: MallState) => void): void;
  deliver(mallId: number): void;
}

const keyToId = (key: string): number | null => (/^m:\d+$/.test(key) ? Number(key.slice(2)) : null);

export class TradeService {
  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
    private readonly host: TradeHost,
    private readonly nameOf: (mallId: number) => string,
  ) {}

  private target(from: number, targetKey: string): number {
    const to = keyToId(targetKey);
    if (to === null) throw new ServiceError(400, "貿易只能和真人商場進行（NPC 商場不做買賣）");
    if (to === from) throw new ServiceError(400, "請選擇另一座商場");
    if (!this.repo.mallById(to)) throw new ServiceError(404, "找不到這座商場");
    return to;
  }

  private checkRate(from: number, to: number, kind: string): void {
    const day = this.repo.tradeSince(from, to, kind, this.now() - TRADE_DAY_MS);
    if (day.n >= TRADE_MAX_PER_DAY) throw new ServiceError(429, "今天對這座商場的轉移次數已經到上限了");
  }

  /** 送錢（贈與）：對方收到 95%。 */
  sendFunds(fromMall: number, targetKey: string, amount: number): { sent: number; received: number } {
    const to = this.target(fromMall, targetKey);
    if (!Number.isInteger(amount) || amount < TRADE_MIN_FUNDS) throw new ServiceError(400, `一次至少 ¥${TRADE_MIN_FUNDS.toLocaleString("en-US")}（整數）`);
    const me = this.host.peek(fromMall);
    const lim = tradeLimits(me.level);
    if (amount > lim.fundsPerTx) throw new ServiceError(400, `單筆最多 ¥${lim.fundsPerTx.toLocaleString("en-US")}`);
    if (me.funds - amount < TRADE_KEEP_FUNDS) throw new ServiceError(400, `轉出後自己至少要留 ¥${TRADE_KEEP_FUNDS.toLocaleString("en-US")}`);
    this.checkRate(fromMall, to, "funds");
    const t = this.now();
    const day = this.repo.tradeSince(fromMall, to, "funds", t - TRADE_DAY_MS);
    if (day.total + amount > lim.fundsPerDay) throw new ServiceError(400, `同一座商場每天最多轉 ¥${lim.fundsPerDay.toLocaleString("en-US")}（今天已轉 ¥${Math.round(day.total).toLocaleString("en-US")}）`);
    // 單向淨流量：這 7 天送出去的，減掉對方回送的
    const out = this.repo.tradeSince(fromMall, to, "funds", t - TRADE_NET_WINDOW_MS).total;
    const back = this.repo.tradeSince(to, fromMall, "funds", t - TRADE_NET_WINDOW_MS).total;
    if (out - back + amount > lim.fundsNet) throw new ServiceError(400, `這 7 天對同一座商場的淨支援最多 ¥${lim.fundsNet.toLocaleString("en-US")}`);

    const received = afterFee(amount);
    this.host.mutate(fromMall, (s) => {
      if (s.funds - amount < TRADE_KEEP_FUNDS) throw new ServiceError(400, "資金不足");
      s.funds -= amount;
      s.today.purchases += amount;
    });
    this.repo.addTrade(t, fromMall, to, "funds", amount, `收到 ${received}`);
    this.repo.addMail(to, "funds_gift", { amount: received, from: this.nameOf(fromMall) }, t, t);
    this.host.deliver(to);
    return { sent: amount, received };
  }

  /** 調貨：把某間直營店的庫存分一部分給對方同業態的店（對方缺貨的優先）。 */
  sendGoods(fromMall: number, targetKey: string, shopId: string, qty: number): { sent: number; received: number; rescue: boolean } {
    const to = this.target(fromMall, targetKey);
    if (!Number.isInteger(qty) || qty < TRADE_MIN_GOODS || qty > TRADE_MAX_GOODS) throw new ServiceError(400, `一次 ${TRADE_MIN_GOODS}–${TRADE_MAX_GOODS} 份`);
    const me = this.host.peek(fromMall);
    const shop = me.shops.find((x) => x.id === shopId);
    const cat = shop && CATEGORY_BY_ID[shop.category];
    if (!shop || !cat || !categoryHasStock(cat)) throw new ServiceError(400, "這間店沒有庫存可以轉");
    if (shop.mode !== "direct" || shop.tenant) throw new ServiceError(400, "出租的店由租戶自己進貨，不能轉");
    if (qty > shop.stock * 0.5) throw new ServiceError(400, `最多只能轉出庫存的一半（目前 ${Math.floor(shop.stock)} 份）`);
    const other = this.host.peek(to);
    const dest = other.shops.filter((x) => x.category === shop.category && x.mode === "direct" && !x.tenant);
    if (dest.length === 0) throw new ServiceError(400, `對方沒有「${cat.name}」的直營店，貨沒地方放`);
    this.checkRate(fromMall, to, "goods");
    const t = this.now();
    const lim = tradeLimits(me.level);
    const day = this.repo.tradeSince(fromMall, to, "goods", t - TRADE_DAY_MS);
    if (day.total + qty > lim.goodsPerDay) throw new ServiceError(400, `同一座商場每天最多轉 ${lim.goodsPerDay} 份貨`);

    const rescue = dest.some((x) => x.stock < 1);
    const received = afterFee(qty);
    this.host.mutate(fromMall, (s) => {
      const sh = s.shops.find((x) => x.id === shopId);
      if (!sh || qty > sh.stock * 0.5) throw new ServiceError(400, "庫存不足");
      sh.stock -= qty;
      // 救援：對方真的缺貨時送貨，自己小小加一點口碑（每天最多 3 次，避免刷）
      if (rescue && this.repo.tradeCountFrom(fromMall, "rescue", t - TRADE_DAY_MS) < 3) applyIndexDelta(s, "localRep", 0.2);
    });
    if (rescue) this.repo.addTrade(t, fromMall, to, "rescue", 1);
    this.repo.addTrade(t, fromMall, to, "goods", qty, `${shop.category} 收到 ${received}`);
    this.repo.addMail(to, "goods", { category: shop.category, qty: received, from: this.nameOf(fromMall) }, t, t);
    this.host.deliver(to);
    return { sent: qty, received, rescue };
  }
}
