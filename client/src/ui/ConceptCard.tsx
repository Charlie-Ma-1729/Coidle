import { CONCEPTS, CONCEPT_COOLDOWN_TICKS, TICKS_PER_DAY, conceptChangeCost, conceptDefOf, conceptEffectLines } from "@coidle/shared";
import { confirmThen } from "../components/ConfirmHost";
import { Btn, Card, Chip } from "../components/ui";
import { moneyShort } from "../format";
import { run, state } from "../store";

/** 概念定位：選定商場想成為什麼樣的地方。第一次免費，之後要付費、而且要隔 28 遊戲日才能再換 */
export function ConceptCard() {
  const s = state.value;
  if (!s) return null;
  const now = conceptDefOf(s);
  const first = s.concept === undefined;
  const left = s.concept ? Math.max(0, s.concept.since + CONCEPT_COOLDOWN_TICKS - s.tick) : 0;
  const cost = first ? 0 : conceptChangeCost(s.level);
  return (
    <Card title="🏷 概念定位" right={<Chip tone="dim">{now.icon} {now.name}</Chip>}>
      <div class="stack">
        <p class="small dim">
          決定這座商場想吸引誰、主打什麼。每種定位讓某幾類客人與業態更旺，另一些會少一點；整體客流差不多，贏面在於定位和你開的店對得上。第一次選免費，之後每次 {moneyShort(conceptChangeCost(s.level))}，並要隔 28 遊戲日才能再換。同一位玩家的不同商場可以各選各的。
        </p>
        <div class="stack">
          {CONCEPTS.map((c) => {
            const active = c.id === now.id;
            const lines = conceptEffectLines(c);
            return (
              <div class="tenant" key={c.id} style={active ? { borderColor: "var(--cyan, #4dd0e1)" } : undefined}>
                <div class="row between">
                  <b>
                    {c.icon} {c.name}
                  </b>
                  <Btn small kind={active ? "ghost" : "primary"} disabled={active || left > 0 || s.funds < cost} onClick={() =>
                      confirmThen(
                        first
                          ? `把商場定位為「${c.name}」？\n第一次選擇免費。之後再換要付 ${moneyShort(conceptChangeCost(s.level))}，並隔 28 遊戲日。`
                          : `把定位從「${now.name}」改成「${c.name}」？\n費用 ${moneyShort(cost)}，現在就會扣款；之後 28 遊戲日內不能再換。`,
                        () => run({ type: "setConcept", id: c.id }, `定位已改為「${c.name}」`),
                      )
                    }>
                    {active ? "目前定位" : left > 0 ? `${Math.ceil(left / TICKS_PER_DAY)} 日後可換` : first ? "選這個（免費）" : `改成這個 ${moneyShort(cost)}`}
                  </Btn>
                </div>
                <p class="small dim">{c.tagline}。{c.advice}</p>
                {lines.length > 0 && <p class="small">{lines.join("・")}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
