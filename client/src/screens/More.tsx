import { moreSub, type MoreSub } from "../nav";
import { Marketing } from "./Marketing";
import { Ops } from "./Ops";
import { Reports } from "./Reports";
import { Rivals } from "./Rivals";
import { Suppliers } from "./Suppliers";
import { Team } from "./Team";

const SUBS: { id: MoreSub; label: string }[] = [
  { id: "ops", label: "⚙️ 營運" },
  { id: "marketing", label: "📣 行銷" },
  { id: "suppliers", label: "📦 供應商" },
  { id: "rivals", label: "⚔️ 商戰" },
  { id: "reports", label: "📰 日報" },
  { id: "team", label: "👥 團隊" },
];

/** 次要功能收在這裡，手機底部導覽才不會擠。 */
export function More() {
  const sub = moreSub.value;
  return (
    <>
      <nav class="zones" aria-label="更多">
        {SUBS.map((s) => (
          <button key={s.id} class={`zone-tab ${sub === s.id ? "active" : ""}`} onClick={() => (moreSub.value = s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      {sub === "ops" ? <Ops /> : sub === "marketing" ? <Marketing /> : sub === "suppliers" ? <Suppliers /> : sub === "rivals" ? <Rivals /> : sub === "reports" ? <Reports /> : <Team />}
    </>
  );
}
