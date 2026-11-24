import { moreSub, type MoreSub } from "../nav";
import { Marketing } from "./Marketing";
import { Ops } from "./Ops";
import { Reports } from "./Reports";
import { Rivals } from "./Rivals";
import { Suppliers } from "./Suppliers";
import { Achievements } from "./Achievements";
import { Goals } from "./Goals";
import { Help } from "./Help";
import { Leasing } from "./Leasing";
import { Tax } from "./Tax";
import { Tech } from "./Tech";
import { Team } from "./Team";

const SUBS: { id: MoreSub; label: string }[] = [
  { id: "help", label: "❓ 說明" },
  { id: "ops", label: "⚙️ 營運" },
  { id: "goals", label: "🎯 目標" },
  { id: "achievements", label: "🏆 成就" },
  { id: "marketing", label: "📣 行銷" },
  { id: "suppliers", label: "📦 供應商" },
  { id: "rivals", label: "⚔️ 商戰" },
  { id: "leasing", label: "🏪 招商" },
  { id: "tech", label: "🔬 科技" },
  { id: "tax", label: "🏛 稅務" },
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
      {sub === "ops" ? <Ops /> : sub === "marketing" ? <Marketing /> : sub === "suppliers" ? <Suppliers /> : sub === "rivals" ? <Rivals /> : sub === "reports" ? <Reports /> : sub === "tax" ? <Tax /> : sub === "help" ? <Help /> : sub === "goals" ? <Goals /> : sub === "achievements" ? <Achievements /> : sub === "leasing" ? <Leasing /> : sub === "tech" ? <Tech /> : <Team />}
    </>
  );
}
