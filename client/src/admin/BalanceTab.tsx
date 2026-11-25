import { useEffect, useMemo, useState } from "preact/hooks";
import { CATEGORY_BY_ID } from "@coidle/shared";
import { adminApi, type BalanceRow, type BalanceShop } from "./adminApi";
import { LineChart } from "./LineChart";
import { Card, Empty, Ico, Seg, Stat, fmtMoney } from "./kit";
import { errMsg, toast } from "../store";

const RANGES = [
  { id: 30, label: "30 遊戲日" },
  { id: 60, label: "60 遊戲日" },
  { id: 180, label: "180 遊戲日" },
] as const;

/** 價格倍率分組：看「標價相對參考價」和每店每日表現的關係（判斷漲價划不划算） */
const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "低於 0.9×", lo: 0, hi: 0.9 },
  { label: "0.9–1.1×", lo: 0.9, hi: 1.1 },
  { label: "1.1–1.2×", lo: 1.1, hi: 1.2 },
  { label: "1.2–1.35×", lo: 1.2, hi: 1.35 },
  { label: "1.35–1.6×", lo: 1.35, hi: 1.6 },
  { label: "1.6× 以上", lo: 1.6, hi: 99 },
];

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const dayLabel = (day: number) => new Date(day * 86_400_000).toISOString().slice(5, 10);
const sumBy = (rs: BalanceRow[], f: (r: BalanceRow) => number) => rs.reduce((a, r) => a + f(r), 0);
const meanRatio = (rs: BalanceRow[]) => {
  const xs = rs.filter((r) => r.price_ratio !== null);
  return xs.length ? xs.reduce((a, r) => a + (r.price_ratio as number), 0) / xs.length : 0;
};

interface ShopDay extends BalanceShop {
  day: number;
}

/** 平衡數據：每座商場每個遊戲日一列（永久保存）；看趨勢、價格與離場的關係，匯出做調整 */
export function BalanceTab() {
  const [days, setDays] = useState<number>(60);
  const [mall, setMall] = useState<number>(0);
  const [data, setData] = useState<{ malls: { id: number; name: string; sandbox: number }[]; rows: BalanceRow[] } | null>(null);

  useEffect(() => {
    let live = true;
    adminApi
      .balance(days, mall || undefined)
      .then((d) => live && setData(d))
      .catch((e) => toast(errMsg(e), "error"));
    return () => {
      live = false;
    };
  }, [days, mall]);

  const calc = useMemo(() => {
    const rows = data?.rows ?? [];
    const byDay = new Map<number, BalanceRow[]>();
    for (const r of rows) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r]);
    const dayList = [...byDay.keys()].sort((a, b) => a - b);
    const perDay = dayList.map((d) => {
      const rs = byDay.get(d)!;
      const total = sumBy(rs, (r) => r.groups + r.walkouts);
      const share = (f: (r: BalanceRow) => number) => (total > 0 ? (sumBy(rs, f) / total) * 100 : 0);
      return {
        day: d,
        revenue: sumBy(rs, (r) => r.revenue) / rs.length,
        cap: share((r) => r.lost_capacity),
        stock: share((r) => r.stockouts),
        price: share((r) => r.price_walks),
        ratio: meanRatio(rs),
        local: sumBy(rs, (r) => r.local_rep) / rs.length,
        tour: sumBy(rs, (r) => r.tourist_heat) / rs.length,
      };
    });
    const shopDays: ShopDay[] = rows.flatMap((r) => r.detail.map((x) => ({ ...x, day: r.day })));
    const byCat = new Map<string, ShopDay[]>();
    for (const x of shopDays) byCat.set(x.c, [...(byCat.get(x.c) ?? []), x]);
    const priced = shopDays.filter((x) => x.pr !== null);
    const buckets = BUCKETS.map((b) => {
      const xs = priced.filter((x) => (x.pr as number) >= b.lo && (x.pr as number) < b.hi);
      const n = xs.length || 1;
      const mean = (f: (x: ShopDay) => number) => xs.reduce((a, x) => a + f(x), 0) / n;
      return { ...b, n: xs.length, units: mean((x) => x.u), revenue: mean((x) => x.r), lost: mean((x) => x.l), pw: mean((x) => x.pw), so: mean((x) => x.so) };
    });
    const lastDay = dayList[dayList.length - 1] ?? 0;
    const last7 = rows.filter((r) => r.day > lastDay - 7);
    return { rows, perDay, byCat, buckets, last7 };
  }, [data]);

  const { rows, perDay, byCat, buckets, last7 } = calc;
  const xs = perDay.map((d) => d.day * 86_400_000);
  const arrivals = sumBy(last7, (r) => r.groups + r.walkouts);
  const n7 = last7.length || 1;

  return (
    <>
      <div class="ad-row">
        <Seg value={String(days)} options={RANGES.map((r) => [String(r.id), r.label] as [string, string])} onChange={(v) => setDays(Number(v))} />
        <select aria-label="商場" value={String(mall)} onChange={(e) => setMall(Number((e.target as HTMLSelectElement).value))}>
          <option value="0">全部商場</option>
          {(data?.malls ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span class="ad-spacer" />
        <a class="ad-btn sm" href={adminApi.balanceExportUrl("mall", "csv", days, mall || undefined)} download>
          <Ico n="download" />
          每商場每日 CSV
        </a>
        <a class="ad-btn sm" href={adminApi.balanceExportUrl("shop", "csv", days, mall || undefined)} download>
          <Ico n="download" />
          每店每日 CSV
        </a>
        <a class="ad-btn sm" href={adminApi.balanceExportUrl("mall", "json", days, mall || undefined)} download>
          <Ico n="download" />
          JSON
        </a>
      </div>

      {rows.length === 0 ? (
        <Card>
          <Empty>還沒有資料。商場每過完一個遊戲日就會記一列（測試商場不記）。</Empty>
        </Card>
      ) : (
        <>
          <div class="ad-stats">
            <Stat tone="cyan" label="最近 7 個遊戲日・商場日均營收" value={fmtMoney(Math.round(sumBy(last7, (r) => r.revenue) / n7))} hint={`${last7.length} 筆商場日`} />
            <Stat
              tone="amber"
              label="離場率"
              value={pct(sumBy(last7, (r) => r.walkouts), arrivals)}
              hint={`排不到位子 ${pct(sumBy(last7, (r) => r.lost_capacity), arrivals)}・缺貨 ${pct(sumBy(last7, (r) => r.stockouts), arrivals)}・嫌貴 ${pct(sumBy(last7, (r) => r.price_walks), arrivals)}`}
            />
            <Stat tone="pink" label="平均標價倍率" value={`${meanRatio(last7).toFixed(2)}×`} hint="標價 ÷ 參考價，以賣出份數加權" />
            <Stat tone="green" label="口碑（在地／觀光）" value={`${(sumBy(last7, (r) => r.local_rep) / n7).toFixed(0)}／${(sumBy(last7, (r) => r.tourist_heat) / n7).toFixed(0)}`} hint={`共 ${rows.length} 筆商場日`} />
          </div>

          <div class="ad-grid c2">
            <Card>
              <LineChart title="每商場日均營收" xs={xs} series={[{ name: "營收", color: "#4fe3ff", values: perDay.map((d) => Math.round(d.revenue)) }]} unit=" ¥" />
            </Card>
            <Card>
              <LineChart
                title="離場原因（占進店客組 %）"
                xs={xs}
                series={[
                  { name: "排不到位子", color: "#ffc857", values: perDay.map((d) => d.cap) },
                  { name: "缺貨", color: "#ff6b6b", values: perDay.map((d) => d.stock) },
                  { name: "嫌太貴", color: "#b48cff", values: perDay.map((d) => d.price) },
                ]}
                unit="%"
              />
            </Card>
            <Card>
              <LineChart title="平均標價倍率" xs={xs} series={[{ name: "標價 ÷ 參考價", color: "#52e0a4", values: perDay.map((d) => Math.round(d.ratio * 100) / 100) }]} unit="×" />
            </Card>
            <Card>
              <LineChart title="口碑" xs={xs} series={[{ name: "在地", color: "#4fe3ff", values: perDay.map((d) => d.local) }, { name: "觀光", color: "#ffc857", values: perDay.map((d) => d.tour) }]} />
            </Card>
          </div>

          <Card title="標價倍率 vs 每店每日表現" desc="把每家店的每一天，依標價相對參考價分組。如果倍率越高、每店營收越高、離場沒增加，代表漲價太划算（平衡失誤）。">
            <div class="ad-scroll">
              <table class="ad-table num">
                <thead>
                  <tr>
                    <th>標價倍率</th>
                    <th class="r">店日數</th>
                    <th class="r">每店日營收</th>
                    <th class="r">賣出份數</th>
                    <th class="r">排不到位子</th>
                    <th class="r">缺貨</th>
                    <th class="r">嫌太貴</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr key={b.label}>
                      <td>{b.label}</td>
                      <td class="r">{b.n}</td>
                      <td class="r">{b.n ? fmtMoney(Math.round(b.revenue)) : "—"}</td>
                      <td class="r">{b.n ? b.units.toFixed(0) : "—"}</td>
                      <td class="r">{b.n ? b.lost.toFixed(1) : "—"}</td>
                      <td class="r">{b.n ? b.so.toFixed(1) : "—"}</td>
                      <td class="r">{b.n ? b.pw.toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="各業態" desc="每店每日的平均值；排不到位子、缺貨、嫌太貴的單位是「組」。">
            <div class="ad-scroll">
              <table class="ad-table num">
                <thead>
                  <tr>
                    <th>業態</th>
                    <th class="r">店日數</th>
                    <th class="r">平均店面等級</th>
                    <th class="r">平均標價倍率</th>
                    <th class="r">營收</th>
                    <th class="r">份數</th>
                    <th class="r">排不到位子</th>
                    <th class="r">缺貨</th>
                    <th class="r">嫌太貴</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byCat.entries()]
                    .sort((a, b) => b[1].length - a[1].length)
                    .map(([c, list]) => {
                      const n = list.length;
                      const avg = (f: (x: ShopDay) => number) => list.reduce((a, x) => a + f(x), 0) / n;
                      const withLv = list.filter((x) => x.lv !== null);
                      const withPr = list.filter((x) => x.pr !== null);
                      return (
                        <tr key={c}>
                          <td>{CATEGORY_BY_ID[c as keyof typeof CATEGORY_BY_ID]?.name ?? c}</td>
                          <td class="r">{n}</td>
                          <td class="r">{withLv.length ? (withLv.reduce((a, x) => a + (x.lv as number), 0) / withLv.length).toFixed(1) : "—"}</td>
                          <td class="r">{withPr.length ? `${(withPr.reduce((a, x) => a + (x.pr as number), 0) / withPr.length).toFixed(2)}×` : "—"}</td>
                          <td class="r">{fmtMoney(Math.round(avg((x) => x.r)))}</td>
                          <td class="r">{avg((x) => x.u).toFixed(0)}</td>
                          <td class="r">{avg((x) => x.l).toFixed(1)}</td>
                          <td class="r">{avg((x) => x.so).toFixed(1)}</td>
                          <td class="r">{avg((x) => x.pw).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="每商場每日" desc="最新的在上面。">
            <div class="ad-scroll">
              <table class="ad-table num">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>商場</th>
                    <th class="r">等級</th>
                    <th class="r">店數</th>
                    <th class="r">營收</th>
                    <th class="r">利潤</th>
                    <th class="r">客組</th>
                    <th class="r">離場</th>
                    <th class="r">標價倍率</th>
                    <th class="r">口碑</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .reverse()
                    .slice(0, 120)
                    .map((r) => (
                      <tr key={`${r.mall_id}-${r.day}`}>
                        <td>{dayLabel(r.day)}</td>
                        <td>{data?.malls.find((m) => m.id === r.mall_id)?.name ?? `#${r.mall_id}`}</td>
                        <td class="r">Lv.{r.level}</td>
                        <td class="r">{r.shops}</td>
                        <td class="r">{fmtMoney(r.revenue)}</td>
                        <td class={`r ${r.profit < 0 ? "neg" : ""}`}>{fmtMoney(r.profit)}</td>
                        <td class="r">{r.groups}</td>
                        <td class="r">{pct(r.walkouts, r.groups + r.walkouts)}</td>
                        <td class="r">{r.price_ratio === null ? "—" : `${r.price_ratio.toFixed(2)}×`}</td>
                        <td class="r">
                          {r.local_rep.toFixed(0)}／{r.tourist_heat.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
