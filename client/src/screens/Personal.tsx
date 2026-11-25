import type { PersonalEquityView } from "@coidle/shared";
import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { Ledger } from "../components/finance/Ledger";
import { Market } from "../components/finance/Market";
import { Overview } from "../components/finance/Overview";
import { Stakes } from "../components/finance/Stakes";
import { moneyShort } from "../format";
import { personalPage, refreshWealth, user, wealth } from "../store";
import { Window } from "../ui/Window";

type Tab = "overview" | "stakes" | "market" | "ledger";

/**
 * 個人財務：和某一座商場無關的、屬於「我這個玩家」的錢——個人錢包、各商場的持股與出價、股票、錢包明細。
 * Lobby 與遊戲內共用同一個視窗（用 store 的 personalPage 開關）。
 */
export function PersonalWindow(props: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(personalPage.value?.tab ?? "overview");
  const [eq, setEq] = useState<PersonalEquityView | null>(null);
  const [version, setVersion] = useState(0);
  const me = user.value;
  const w = wealth.value;

  const reload = async () => {
    await refreshWealth();
    try {
      setEq(await api.myEquity());
    } catch {
      // 讀不到就維持現狀
    }
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    void reload();
  }, []);

  if (!me) return null;
  const pending = (eq?.offers.filter((o) => o.toId === me.id).length ?? 0) + (eq?.requests.filter((r) => r.userId !== me.id).length ?? 0);
  return (
    <Window
      title="個人財務"
      icon="coin"
      summary={w ? [{ label: "總資產", value: moneyShort(w.totalValue) }, { label: "錢包", value: moneyShort(w.cash) }] : undefined}
      tabs={[
        { id: "overview", label: "總覽" },
        { id: "stakes", label: "商場股權", badge: pending },
        { id: "market", label: "股市" },
        { id: "ledger", label: "明細" },
      ]}
      tab={tab}
      onTab={(t) => setTab(t as Tab)}
      onClose={props.onClose}
    >
      {tab === "overview" && <Overview wealth={w} equity={eq} meId={me.id} onTab={setTab} />}
      {tab === "stakes" && <Stakes wealth={w} equity={eq} meId={me.id} reload={reload} />}
      {tab === "market" && <Market onChanged={reload} />}
      {tab === "ledger" && <Ledger version={version} />}
    </Window>
  );
}

/** 放在畫面最上層：personalPage 有值就顯示個人財務視窗 */
export function PersonalHost() {
  if (!personalPage.value) return null;
  return <PersonalWindow onClose={() => (personalPage.value = null)} />;
}
