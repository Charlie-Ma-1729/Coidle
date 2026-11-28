import { useEffect, useState } from "preact/hooks";
import { adminApi } from "./adminApi";
import { Badge, Card, Field, confirmBox, fmtDate, fmtMoney, promptBox } from "./kit";
import { errMsg, toast } from "../store";

interface MarketAdmin {
  status: { open: boolean; session: string; clock: string; reason: string | null; halted?: boolean; nextOpenAt: number };
  halt: { reason: string; at: number } | null;
  limits: { dailyBuyLimit: number; holdCap: number };
  defaults: { dailyBuyLimit: number; holdCap: number };
}

/** 股市：臨時暫停交易、調整每日買進與單一集團持股上限。價格是（種子, 時間）的純函式，這裡不動價格。 */
export function MarketTab() {
  const [v, setV] = useState<MarketAdmin | null>(null);
  const [daily, setDaily] = useState("");
  const [cap, setCap] = useState("");

  const load = async () => {
    try {
      const r = await adminApi.get<MarketAdmin>("/market");
      setV(r);
      setDaily(String(r.limits.dailyBuyLimit));
      setCap(String(r.limits.holdCap));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  if (!v) return <p class="ad-empty">載入中…</p>;

  const halt = async (on: boolean) => {
    let reason = "";
    if (on) {
      const r = await promptBox("暫停交易", "", "原因（會顯示給玩家，最多 80 字）");
      if (r === null) return;
      reason = r;
      if (!(await confirmBox("暫停全部買賣？", "個人與商場公司資金都不能下單，預約單也不會成交；價格照常。", { danger: true, ok: "暫停" }))) return;
    }
    try {
      setV(await adminApi.post<MarketAdmin>("/market/halt", { on, reason }));
      toast(on ? "已暫停交易" : "已恢復交易", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const saveLimits = async (reset: boolean) => {
    try {
      const body = reset ? { dailyBuyLimit: null, holdCap: null } : { dailyBuyLimit: Number(daily), holdCap: Number(cap) };
      const r = await adminApi.post<MarketAdmin>("/market/limits", body);
      setV(r);
      setDaily(String(r.limits.dailyBuyLimit));
      setCap(String(r.limits.holdCap));
      toast(reset ? "已恢復預設上限" : "上限已更新", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <>
      <Card
        title={
          <>
            交易狀態 {v.halt ? <Badge tone="red">暫停中</Badge> : v.status.open ? <Badge tone="green">開市中</Badge> : <Badge>休市</Badge>}
          </>
        }
        desc={v.halt ? `暫停於 ${fmtDate(v.halt.at)}${v.halt.reason ? `：${v.halt.reason}` : ""}` : `${v.status.clock}・${v.status.reason ?? "依東證開市時間"}`}
        actions={
          <button class={`ad-btn ${v.halt ? "pri" : "danger"}`} onClick={() => void halt(!v.halt)}>
            {v.halt ? "恢復交易" : "臨時暫停交易"}
          </button>
        }
      >
        <p class="ad-sub">暫停期間：個人買賣與商場法人下單都會被拒絕，預約單不成交；恢復後預約單依原規則在「下單後第一次開盤」成交。價格是（種子, 時間）的純函式，不受影響。每次操作都會寫進稽核紀錄。</p>
      </Card>

      <Card title="買進與持股上限" desc={`預設：每遊戲日最多買 ${fmtMoney(v.defaults.dailyBuyLimit)}、單一集團持股市值最多 ${fmtMoney(v.defaults.holdCap)}。調高會放大系統發放的獲利，請小心。`}>
        <div class="ad-form">
          <Field label="每遊戲日買進上限（股款）">
            <input type="number" min={0} step={10000} value={daily} onInput={(e) => setDaily((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="單一集團持股市值上限">
            <input type="number" min={0} step={10000} value={cap} onInput={(e) => setCap((e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <div class="ad-row">
          <button class="ad-btn pri" onClick={() => void saveLimits(false)}>
            套用
          </button>
          <button class="ad-btn" onClick={() => void saveLimits(true)}>
            恢復預設
          </button>
        </div>
      </Card>
    </>
  );
}
