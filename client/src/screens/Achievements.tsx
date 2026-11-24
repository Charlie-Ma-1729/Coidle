import { useState } from "preact/hooks";
import { ACHIEVEMENTS, CLUES, mallScore, mallStars, type PublicMallState } from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../components/ui";
import { dateText, money } from "../format";
import { run, state } from "../store";

export function Stars({ n }: { n: number }) {
  return <span title={`商場評鑑 ${n} 星`}>{"★".repeat(n)}<span class="dim">{"☆".repeat(5 - n)}</span></span>;
}

function Rating({ s }: { s: PublicMallState }) {
  const score = mallScore(s as never);
  const stars = mallStars(s as never);
  const titles = ACHIEVEMENTS.filter((a) => a.title && s.meta.achievements[a.id] !== undefined).map((a) => a.title!);
  return (
    <Card title="⭐ 商場評鑑" right={<span style={{ color: "var(--amber, #ffcb52)", fontSize: "1.2em" }}><Stars n={stars} /></span>}>
      <div class="stack">
        <Meter label="綜合評分" value={score} hint={`${Math.round(score)}／100`} tone="amber" />
        <p class="small dim">由商場等級、整體口碑、稽查合規、店家規模與多樣性、成就數量綜合而成。</p>
        {titles.length > 0 && (
          <div class="row">
            <span class="small dim">稱號：</span>
            {titles.map((t) => (
              <Chip key={t} tone="pink">
                {t}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function Clues({ s }: { s: PublicMallState }) {
  const found = CLUES.filter((c) => s.meta.clues[c.id] !== undefined);
  const [guess, setGuess] = useState("");
  return (
    <Card title="🔎 線索收集" right={<span class="small dim">{found.length}／{CLUES.length}</span>}>
      <div class="stack">
        <p class="small dim">這座商場開在哪裡？地名不會直接告訴你，只有生活裡零碎的細節。經營得越久、遇到的事越多，就會發現越多線索。</p>
        {found.length === 0 ? (
          <p class="small dim">還沒有線索。繼續經營，留心聽客人和常客說的話。</p>
        ) : (
          found
            .slice()
            .sort((a, b) => (s.meta.clues[b.id] ?? 0) - (s.meta.clues[a.id] ?? 0))
            .map((c) => (
              <p class="small" key={c.id}>
                {c.icon} {c.text}
              </p>
            ))
        )}
        {found.length < CLUES.length && <p class="small dim">還有 {CLUES.length - found.length} 則線索等你發現…</p>}
        {s.meta.placeSolved ? (
          <Chip tone="green">🗺️ 你已經猜中了！</Chip>
        ) : (
          <div class="row">
            <input
              class="input"
              style={{ flex: 1, minWidth: 0 }}
              placeholder="我猜這裡是…"
              value={guess}
              maxLength={30}
              onInput={(e) => setGuess((e.target as HTMLInputElement).value)}
            />
            <Btn small kind="primary" disabled={guess.trim().length < 2} onClick={() => run({ type: "guessPlace", text: guess }, "已送出猜測").then(() => setGuess(""))}>
              猜猜看
            </Btn>
          </div>
        )}
        {!s.meta.placeSolved && s.meta.guesses > 0 && <p class="small dim">已經猜過 {s.meta.guesses} 次（每個遊戲日只能猜一次）。猜中有一筆大獎金。</p>}
      </div>
    </Card>
  );
}

export function Achievements() {
  const s = state.value;
  if (!s) return null;
  const done = ACHIEVEMENTS.filter((a) => s.meta.achievements[a.id] !== undefined);
  return (
    <>
      <Rating s={s} />
      <Clues s={s} />
      <Card title="🏆 成就" right={<span class="small dim">{done.length}／{ACHIEVEMENTS.length}</span>}>
        <div class="stack">
          {ACHIEVEMENTS.map((a) => {
            const at = s.meta.achievements[a.id];
            const got = at !== undefined;
            const hidden = a.secret && !got;
            return (
              <div class="row between" key={a.id} style={{ opacity: got ? 1 : 0.6 }}>
                <span class="small">
                  {hidden ? "❔" : a.icon} <b>{hidden ? "？？？" : a.name}</b>
                  <span class="dim">　{hidden ? "隱藏成就，做著做著就會發現" : a.desc}</span>
                </span>
                {got ? <Chip tone="green">{dateText(at)}</Chip> : a.reward ? <Chip tone="dim">{money(a.reward)}</Chip> : null}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
