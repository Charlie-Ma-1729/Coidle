import { moreSub, type MoreSub } from "../nav";
import { Ops } from "./Ops";
import { Team } from "./Team";

const SUBS: { id: MoreSub; label: string }[] = [
  { id: "ops", label: "⚙️ 營運" },
  { id: "team", label: "👥 團隊" },
];

/** 次要功能收在這裡，手機底部導覽才不會擠。之後的行銷、供應商、商戰也會放進來。 */
export function More() {
  return (
    <>
      <nav class="zones" aria-label="更多">
        {SUBS.map((s) => (
          <button key={s.id} class={`zone-tab ${moreSub.value === s.id ? "active" : ""}`} onClick={() => (moreSub.value = s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      {moreSub.value === "ops" ? <Ops /> : <Team />}
    </>
  );
}
