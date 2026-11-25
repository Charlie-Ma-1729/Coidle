import type { DailyReport, MallState } from "@coidle/shared";
import type { BalanceRow } from "../db/repo";

/** 單店明細（存進 balance_daily.detail_json，欄位名縮短以省空間） */
export interface BalanceShop {
  c: string; // 業態
  lv: number | null; // 店面等級
  pr: number | null; // 標價 ÷ 參考價
  u: number; // 賣出份數
  r: number; // 營收
  so: number; // 缺貨次數
  l: number; // 排不到位子的組數
  pw: number; // 嫌太貴而走的組數
}

/** 一份日報 → 平衡分析的一列。funds 只有最新一天才準（其他天不知道當天結束時的現金），所以其他天留空。 */
export function balanceRow(mallId: number, r: DailyReport, s: MallState, members: number, latest: boolean, now: number): BalanceRow {
  const detail: BalanceShop[] = r.shops.map((x) => ({
    c: x.category,
    lv: x.level ?? null,
    pr: x.price !== undefined && x.refPrice ? Math.round((x.price / x.refPrice) * 1000) / 1000 : null,
    u: x.units,
    r: Math.round(x.revenue),
    so: x.stockouts,
    l: x.lost,
    pw: x.priceWalks ?? 0,
  }));
  const priced = detail.filter((x) => x.pr !== null);
  const units = priced.reduce((a, x) => a + x.u, 0);
  const ratio = priced.length === 0 ? null : units > 0 ? priced.reduce((a, x) => a + (x.pr as number) * x.u, 0) / units : priced.reduce((a, x) => a + (x.pr as number), 0) / priced.length;
  const sats = Object.values(r.avgSat).filter((v): v is number => v !== null);
  return {
    mall_id: mallId,
    day: r.day,
    recorded_at: now,
    level: s.level,
    shops: r.shops.length,
    members,
    funds: latest ? Math.round(s.funds) : null,
    revenue: Math.round(r.revenue),
    profit: Math.round(r.profit),
    purchases: Math.round(r.purchases),
    fixed: Math.round(r.fixed),
    groups: r.groups,
    units: r.units,
    walkouts: r.walkouts,
    lost_capacity: detail.reduce((a, x) => a + x.l, 0),
    stockouts: detail.reduce((a, x) => a + x.so, 0),
    price_walks: r.priceWalks ?? detail.reduce((a, x) => a + x.pw, 0),
    local_rep: Math.round(r.localRep.end * 10) / 10,
    tourist_heat: Math.round(r.touristHeat.end * 10) / 10,
    avg_sat: sats.length ? Math.round((sats.reduce((a, b) => a + b, 0) / sats.length) * 1000) / 1000 : null,
    price_ratio: ratio === null ? null : Math.round(ratio * 1000) / 1000,
    detail_json: JSON.stringify(detail),
  };
}

export const BALANCE_CSV_COLUMNS = ["mall_id", "day", "date", "level", "shops", "members", "funds", "revenue", "profit", "purchases", "fixed", "groups", "units", "walkouts", "lost_capacity", "stockouts", "price_walks", "local_rep", "tourist_heat", "avg_sat", "price_ratio"] as const;

export function balanceCsv(rows: BalanceRow[]): string {
  const head = BALANCE_CSV_COLUMNS.join(",");
  const lines = rows.map((r) => BALANCE_CSV_COLUMNS.map((c) => (c === "date" ? new Date(r.day * 86_400_000).toISOString().slice(0, 10) : (r as unknown as Record<string, unknown>)[c] ?? "")).join(","));
  return "\ufeff" + [head, ...lines].join("\n") + "\n";
}

/** 展開成「每店每日」一列（做業態或價格分析用） */
export function balanceShopCsv(rows: BalanceRow[]): string {
  const head = "mall_id,day,date,category,level,price_ratio,units,revenue,stockouts,lost_capacity,price_walks";
  const lines: string[] = [];
  for (const r of rows) {
    const date = new Date(r.day * 86_400_000).toISOString().slice(0, 10);
    for (const x of JSON.parse(r.detail_json) as BalanceShop[]) lines.push([r.mall_id, r.day, date, x.c, x.lv ?? "", x.pr ?? "", x.u, x.r, x.so, x.l, x.pw].join(","));
  }
  return "\ufeff" + [head, ...lines].join("\n") + "\n";
}
