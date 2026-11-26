import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  PLAY_GROUPS,
  PLAY_MAX_TWEAK,
  TAG_BY_ID,
  actKind,
  makeLevel,
  playDifficulty,
  scorePlay,
  scoreHold,
  scoreRhythm,
  scoreSequence,
  stageSeed,
  type HoldLevel,
  type PlayInput,
  type PublicMallState,
  type RhythmLevel,
  type SequenceLevel,
  type Shop,
  type SlotKind,
} from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../../components/ui";

/**
 * 研發小遊戲（三段式）：排順序 → 節奏或穩定度的操作 → 調味微調。
 * 關卡由 s.workshop.playSeed 決定（純函式，伺服器用同一份重新計分）；玩家的輸入只是「點擊時間／位置序列／排列順序」。
 * 每一關都能略過（得 0 分），也能整個不玩（自動，沒有加成）。
 */

type Picks = Partial<Record<SlotKind, string>>;
type Group = "food" | "retail" | "entertainment" | "service";
const pct = (x: number) => `${Math.round(x * 100)}`;

// ───────── 第 1 關：排順序 ─────────
function SequenceGame({ level, onDone }: { level: SequenceLevel; onDone: (order: number[]) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const left = level.items.filter((x) => !order.includes(x.id));
  return (
    <div class="stack">
      <p class="small dim">每個工序旁邊是它的耗時。把工序依「先做耗時長的」順序點選排好。</p>
      <div class="row" style={{ flexWrap: "wrap", gap: "6px" }}>
        {left.map((it) => (
          <Btn key={it.id} onClick={() => setOrder([...order, it.id])}>
            {it.label}（{it.minutes} 分）
          </Btn>
        ))}
      </div>
      <ol class="small">
        {order.map((id, i) => (
          <li key={id}>
            {level.items.find((x) => x.id === id)?.label}
            {i === order.length - 1 && (
              <button class="link" style={{ marginLeft: "8px" }} onClick={() => setOrder(order.slice(0, -1))}>
                收回
              </button>
            )}
          </li>
        ))}
      </ol>
      <div class="row">
        <Btn kind="primary" disabled={left.length > 0} onClick={() => onDone(order)}>
          就這樣排
        </Btn>
      </div>
    </div>
  );
}

// ───────── 第 2 關：節奏 ─────────
function RhythmGame({ level, label, onDone }: { level: RhythmLevel; label: string; onDone: (taps: number[]) => void }) {
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(0);
  const taps = useRef<number[]>([]);
  const t0 = useRef(0);
  const raf = useRef(0);
  const [tapCount, setTapCount] = useState(0);
  const [score, setScore] = useState<number | null>(null);

  const finish = () => {
    cancelAnimationFrame(raf.current);
    setRunning(false);
    setScore(scoreRhythm(level, taps.current));
  };
  const loop = () => {
    const t = performance.now() - t0.current;
    setNow(t);
    if (t >= level.duration) return finish();
    raf.current = requestAnimationFrame(loop);
  };
  const start = () => {
    taps.current = [];
    setTapCount(0);
    setScore(null);
    t0.current = performance.now();
    setRunning(true);
    raf.current = requestAnimationFrame(loop);
  };
  const tap = () => {
    if (!running) return;
    taps.current.push(Math.round(performance.now() - t0.current));
    setTapCount(taps.current.length);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf.current);
    };
  }, [running]);

  return (
    <div class="stack">
      <p class="small dim">{label}。光點滑到亮線時按下「下手」（或空白鍵），越準分數越高。</p>
      <div style={{ position: "relative", height: "44px", border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden", background: "rgba(255,255,255,0.03)" }} aria-label="節奏軌道">
        {level.beats.map((b) => (
          <span key={b} style={{ position: "absolute", left: `${(b / level.duration) * 100}%`, top: 0, bottom: 0, width: "3px", background: "var(--pink)" }} />
        ))}
        <span style={{ position: "absolute", left: `${Math.min(100, (now / level.duration) * 100)}%`, top: "12px", width: "18px", height: "18px", borderRadius: "50%", background: "var(--cyan, #5ee)", transform: "translateX(-9px)" }} />
      </div>
      <div class="row">
        {!running && score === null && <Btn onClick={start}>開始</Btn>}
        {running && (
          <Btn kind="primary" onClick={tap}>
            下手！（{tapCount}）
          </Btn>
        )}
        {score !== null && (
          <>
            <Chip tone={score >= 0.7 ? "green" : score >= 0.4 ? "cyan" : "amber"}>手感 {pct(score)} 分</Chip>
            <Btn onClick={start}>再來一次</Btn>
            <Btn kind="primary" onClick={() => onDone(taps.current.slice())}>
              用這次的成績
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ───────── 第 2 關：穩定度 ─────────
function HoldGame({ level, label, onDone }: { level: HoldLevel; label: string; onDone: (pos: number[]) => void }) {
  const [running, setRunning] = useState(false);
  const [i, setI] = useState(0);
  const [cur, setCur] = useState(50);
  const [score, setScore] = useState<number | null>(null);
  const samples = useRef<number[]>([]);
  const curRef = useRef(50);
  const timer = useRef(0);

  const finish = () => {
    window.clearInterval(timer.current);
    setRunning(false);
    setScore(scoreHold(level, samples.current));
  };
  const start = () => {
    samples.current = [];
    setI(0);
    setScore(null);
    setRunning(true);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      samples.current.push(Math.round(curRef.current));
      const n = samples.current.length;
      setI(n);
      if (n >= level.centers.length) finish();
    }, level.step);
  };
  useEffect(() => () => window.clearInterval(timer.current), []);
  const center = level.centers[Math.min(i, level.centers.length - 1)] ?? 50;
  return (
    <div class="stack">
      <p class="small dim">{label}。把滑桿維持在發亮的區間裡，區間會慢慢移動，跟著它。</p>
      <div style={{ position: "relative", height: "28px", border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden", background: "rgba(255,255,255,0.03)" }} aria-label="甜蜜區間">
        <span style={{ position: "absolute", left: `${center - level.width / 2}%`, width: `${level.width}%`, top: 0, bottom: 0, background: "rgba(255,95,162,0.35)" }} />
        <span style={{ position: "absolute", left: `${cur}%`, top: "4px", width: "6px", height: "20px", background: "var(--cyan, #5ee)", transform: "translateX(-3px)" }} />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={cur}
        aria-label="控制"
        onInput={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          curRef.current = v;
          setCur(v);
        }}
      />
      <div class="row">
        {!running && score === null && <Btn onClick={start}>開始</Btn>}
        {running && <span class="small dim">進行中…{Math.round((i / level.centers.length) * 100)}%</span>}
        {score !== null && (
          <>
            <Chip tone={score >= 0.7 ? "green" : score >= 0.4 ? "cyan" : "amber"}>穩定度 {pct(score)} 分</Chip>
            <Btn onClick={start}>再來一次</Btn>
            <Btn kind="primary" onClick={() => onDone(samples.current.slice())}>
              用這次的成績
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ───────── 第 3 關：微調（推理） ─────────
function TweakStage({ s, group, picks, tweak, setTweak, mustTweak }: { s: PublicMallState; group: Group; picks: Picks; tweak: Record<string, number>; setTweak: (t: Record<string, number>) => void; mustTweak: boolean }) {
  const tags = TAG_BY_ID[group] ?? {};
  const known = new Set<string>();
  for (const k of Object.keys(picks) as SlotKind[]) for (const t of s.workshop.learned[picks[k] ?? ""] ?? []) known.add(t);
  const used = Object.values(tweak).filter((v) => v !== 0).length;
  const set = (tag: string, v: number) => {
    const next = { ...tweak };
    if (next[tag] === v) delete next[tag];
    else if (used < PLAY_MAX_TWEAK || next[tag] !== undefined) next[tag] = v;
    setTweak(next);
  };
  const clues = s.workshop.clues.filter((c) => !c.solved).slice(-3);
  return (
    <div class="stack">
      <p class="small dim">
        依線索微調特性：最多動 {PLAY_MAX_TWEAK} 個（各 +1／−1）。缺的補一點、過頭的收一點；調錯方向會失衡。{mustTweak ? "這個組合以前試過，要換個微調才能再試。" : ""}
      </p>
      {clues.length > 0 && (
        <ul class="small dim">
          {clues.map((c) => (
            <li key={c.id}>🔎 {c.text}</li>
          ))}
        </ul>
      )}
      <div class="stack">
        {Object.values(tags).map((t) => (
          <div class="row between" key={t.id}>
            <span>
              {t.name} {known.has(t.id) && <Chip tone="cyan">已知特性</Chip>}
            </span>
            <span class="row" style={{ gap: "4px" }}>
              <Btn small kind={tweak[t.id] === -1 ? "primary" : undefined} onClick={() => set(t.id, -1)}>
                −1
              </Btn>
              <Btn small kind={tweak[t.id] === 1 ? "primary" : undefined} onClick={() => set(t.id, 1)}>
                ＋1
              </Btn>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 三段式研發小遊戲。onStart(play)：play 為 undefined＝不玩，自動（沒有加成）。 */
export function PlayFlow(props: {
  s: PublicMallState;
  shop: Shop;
  group: Group;
  picks: Picks;
  costs: number[];
  mustTweak: boolean;
  verb: string;
  onStart: (play: PlayInput | undefined) => void;
  onCancel: () => void;
}) {
  const { s, shop, group, picks } = props;
  const seed = s.workshop.playSeed;
  const diff = playDifficulty(props.costs);
  const def = PLAY_GROUPS[group];
  const kind = actKind(group, picks.method);
  const prepLevel = useMemo(() => (seed === undefined ? null : (makeLevel("sequence", stageSeed(seed, 0), group, diff) as SequenceLevel)), [seed, group, diff]);
  const actLevel = useMemo(() => (seed === undefined ? null : makeLevel(kind, stageSeed(seed, 1), group, diff)), [seed, group, diff, kind]);
  const [step, setStep] = useState(0);
  const [prep, setPrep] = useState<number[]>([]);
  const [act, setAct] = useState<number[]>([]);
  const [tweak, setTweak] = useState<Record<string, number>>({});

  if (seed === undefined || !prepLevel || !actLevel) {
    return (
      <Card title="🎮 手藝小遊戲">
        <p class="small dim">關卡還沒準備好，稍等一下（或直接自動開始，沒有加成）。</p>
        <div class="row">
          <Btn onClick={() => props.onStart(undefined)}>自動開始</Btn>
          <Btn onClick={props.onCancel}>返回</Btn>
        </div>
      </Card>
    );
  }
  const play: PlayInput = { seed, stages: [{ id: "prep", inputs: prep }, { id: "act", inputs: act }], tweak };
  const result = scorePlay(group, picks.method, diff, seed, play);
  const prepScore = prep.length ? scoreSequence(prepLevel, prep) : 0;
  const actScore = act.length ? (actLevel.kind === "rhythm" ? scoreRhythm(actLevel, act) : actLevel.kind === "hold" ? scoreHold(actLevel, act) : 0) : 0;
  const steps = [def.prep, def.act, def.tweak];
  void shop;

  return (
    <Card title={`🎮 手藝小遊戲・${props.verb}`} right={<span class="small dim">難度 {diff}</span>}>
      <div class="stack">
        <div class="row" style={{ gap: "6px", flexWrap: "wrap" }}>
          {steps.map((st, i) => (
            <Chip key={st.id} tone={i === step ? "pink" : i < step ? "green" : "dim"}>
              {st.icon} {i + 1}. {st.label}
            </Chip>
          ))}
          <Chip tone={step === 3 ? "pink" : "dim"}>✔ 4. 確認</Chip>
        </div>

        {step === 0 && (
          <>
            <p class="small">
              <b>
                {def.prep.icon} {def.prep.label}
              </b>
              <span class="dim">：{def.prep.desc}</span>
            </p>
            <SequenceGame
              level={prepLevel}
              onDone={(o) => {
                setPrep(o);
                setStep(1);
              }}
            />
          </>
        )}
        {step === 1 && (
          <>
            <p class="small">
              <b>
                {def.act.icon} {def.act.label}
              </b>
              <span class="dim">：{def.act.desc}</span>
            </p>
            {actLevel.kind === "rhythm" ? (
              <RhythmGame
                level={actLevel}
                label={def.act.actions.rhythm}
                onDone={(t) => {
                  setAct(t);
                  setStep(2);
                }}
              />
            ) : actLevel.kind === "hold" ? (
              <HoldGame
                level={actLevel}
                label={def.act.actions.hold}
                onDone={(p) => {
                  setAct(p);
                  setStep(2);
                }}
              />
            ) : null}
          </>
        )}
        {step === 2 && (
          <>
            <p class="small">
              <b>
                {def.tweak.icon} {def.tweak.label}
              </b>
              <span class="dim">：{def.tweak.desc}</span>
            </p>
            <TweakStage s={s} group={group} picks={picks} tweak={tweak} setTweak={setTweak} mustTweak={props.mustTweak} />
            <div class="row">
              <Btn kind="primary" disabled={props.mustTweak && Object.keys(tweak).length === 0} onClick={() => setStep(3)}>
                下一步
              </Btn>
            </div>
          </>
        )}
        {step === 3 && (
          <div class="stack">
            <Meter label={`${def.prep.icon} ${def.prep.label}`} value={prepScore * 100} hint={pct(prepScore)} tone="cyan" />
            <Meter label={`${def.act.icon} ${def.act.label}`} value={actScore * 100} hint={pct(actScore)} tone="pink" />
            <p class="small">
              手藝總分 <b>{result ? pct(result.score) : 0}</b>，廚藝經驗加成 <b>＋{result?.bonus ?? 0}</b>（最多 ＋3）
              {Object.keys(tweak).length > 0 ? `；微調 ${Object.entries(tweak).map(([k, v]) => `${TAG_BY_ID[group][k]?.name ?? k}${v > 0 ? "＋" : "－"}1`).join("、")}` : ""}。
            </p>
            <div class="row">
              <Btn kind="primary" onClick={() => props.onStart(play)}>
                開始{props.verb}
              </Btn>
              <Btn onClick={() => setStep(0)}>重玩</Btn>
            </div>
          </div>
        )}

        <div class="row">
          {step < 2 && (
            <Btn small onClick={() => setStep(step + 1)} title="這一關不玩，得 0 分">
              略過這一關
            </Btn>
          )}
          <Btn small onClick={() => props.onStart(undefined)} title="不玩小遊戲，沒有加成">
            直接自動開始
          </Btn>
          <Btn small onClick={props.onCancel}>
            返回
          </Btn>
        </div>
      </div>
    </Card>
  );
}
