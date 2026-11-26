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
  scoreCut,
  doseHit,
  dosePos,
  stageSeed,
  type HoldLevel,
  type PlayInput,
  type PublicMallState,
  type CutLevel,
  type DoseLevel,
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

// ───────── 節奏型關卡（下刀／烹調共用）：倒數 → 光點滑過軌道 → 在亮線上下手 ─────────
type Judge = { text: string; tone: "green" | "cyan" | "amber" | "pink" };

function judgeTap(t: number, targets: number[], decoys: number[], win: number): Judge {
  const dd = decoys.reduce((m, d) => Math.min(m, Math.abs(t - d)), Infinity);
  if (dd <= win * 0.6) return { text: "碰到雜質了！", tone: "pink" };
  const d = targets.reduce((m, b) => Math.min(m, Math.abs(t - b)), Infinity);
  if (d <= win * 0.35) return { text: "完美！", tone: "green" };
  if (d <= win * 0.7) return { text: "不錯", tone: "cyan" };
  if (d <= win) return { text: "勉強", tone: "amber" };
  return { text: "空揮", tone: "amber" };
}

function TimingGame({
  targets,
  decoys,
  win,
  duration,
  label,
  goodLabel,
  badLabel,
  action,
  scoreOf,
  scoreName,
  onDone,
}: {
  targets: number[];
  decoys: number[];
  win: number;
  duration: number;
  label: string;
  goodLabel: string;
  badLabel: string;
  action: string;
  scoreOf: (taps: number[]) => number;
  scoreName: string;
  onDone: (taps: number[]) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "count" | "run" | "done">("idle");
  const [count, setCount] = useState(3);
  const [now, setNow] = useState(0);
  const taps = useRef<number[]>([]);
  const t0 = useRef(0);
  const raf = useRef(0);
  const timers = useRef<number[]>([]);
  const phaseRef = useRef<"idle" | "count" | "run" | "done">("idle");
  const [tapCount, setTapCount] = useState(0);
  const [judge, setJudge] = useState<Judge | null>(null);
  const [combo, setCombo] = useState(0);
  const [score, setScore] = useState<number | null>(null);
  const go = (p: "idle" | "count" | "run" | "done") => {
    phaseRef.current = p;
    setPhase(p);
  };

  const finish = () => {
    cancelAnimationFrame(raf.current);
    go("done");
    setScore(scoreOf(taps.current));
  };
  const loop = () => {
    const t = performance.now() - t0.current;
    setNow(t);
    if (t >= duration) return finish();
    raf.current = requestAnimationFrame(loop);
  };
  const begin = () => {
    taps.current = [];
    setTapCount(0);
    setCombo(0);
    setJudge(null);
    setScore(null);
    setNow(0);
    t0.current = performance.now();
    go("run");
    raf.current = requestAnimationFrame(loop);
  };
  const start = () => {
    timers.current.forEach((x) => window.clearTimeout(x));
    cancelAnimationFrame(raf.current);
    go("count");
    setCount(3);
    timers.current = [window.setTimeout(() => setCount(2), 500), window.setTimeout(() => setCount(1), 1000), window.setTimeout(begin, 1500)];
  };
  const tap = () => {
    if (phaseRef.current !== "run") return;
    const t = Math.round(performance.now() - t0.current);
    taps.current.push(t);
    setTapCount(taps.current.length);
    const j = judgeTap(t, targets, decoys, win);
    setJudge(j);
    setCombo((c) => (j.tone === "green" || j.tone === "cyan" ? c + 1 : 0));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && phaseRef.current === "run") {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf.current);
      timers.current.forEach((x) => window.clearTimeout(x));
    };
  }, []);

  const running = phase === "run";
  // 已經滑過去的目標：附近有按過就亮綠，沒按就暗掉
  const passed = (b: number) => now > b + win;
  const hitOf = (b: number) => taps.current.some((t) => Math.abs(t - b) <= win);
  return (
    <div class="stack">
      <p class="small dim">
        {label}。光點滑到<b>亮線</b>（{goodLabel}）時按下「{action}」（空白鍵也行）。{decoys.length > 0 && <><b>紅線</b>是{badLabel}，別碰。</>}
      </p>
      <div style={{ position: "relative", height: "52px", border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden", background: "rgba(255,255,255,0.03)" }} aria-label="節奏軌道">
        {targets.map((b) => (
          <span
            key={`t${b}`}
            style={{
              position: "absolute",
              left: `${((b - win) / duration) * 100}%`,
              width: `${((win * 2) / duration) * 100}%`,
              top: 0,
              bottom: 0,
              background: passed(b) ? (hitOf(b) ? "rgba(90,220,140,0.28)" : "rgba(255,255,255,0.04)") : "rgba(255,95,162,0.12)",
            }}
          >
            <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "3px", background: passed(b) && !hitOf(b) ? "rgba(255,255,255,0.2)" : "var(--pink)", transform: "translateX(-1px)" }} />
          </span>
        ))}
        {decoys.map((b) => (
          <span key={`d${b}`} style={{ position: "absolute", left: `${(b / duration) * 100}%`, top: "10px", bottom: "10px", width: "3px", background: "#e44", opacity: 0.85, borderRadius: "2px" }} />
        ))}
        <span style={{ position: "absolute", left: `${Math.min(100, (now / duration) * 100)}%`, top: "17px", width: "18px", height: "18px", borderRadius: "50%", background: "var(--cyan, #5ee)", transform: "translateX(-9px)", boxShadow: "0 0 10px var(--cyan, #5ee)" }} />
        {phase === "count" && (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", fontWeight: 700 }}>{count}</span>
        )}
      </div>
      <div class="row" style={{ minHeight: "28px", gap: "8px" }}>
        {judge && running && <Chip tone={judge.tone}>{judge.text}</Chip>}
        {combo >= 2 && running && <Chip tone="cyan">連擊 ×{combo}</Chip>}
      </div>
      <div class="row">
        {phase === "idle" && <Btn onClick={start}>開始（倒數 3 秒）</Btn>}
        {phase === "count" && <span class="small dim">準備…</span>}
        {running && (
          <button
            class="btn primary"
            style={{ flex: 1, minHeight: "56px", fontSize: "18px", touchAction: "manipulation" }}
            onPointerDown={(e) => {
              e.preventDefault();
              tap();
            }}
          >
            {action}！（{tapCount}）
          </button>
        )}
        {phase === "done" && score !== null && (
          <>
            <Chip tone={score >= 0.7 ? "green" : score >= 0.4 ? "cyan" : "amber"}>
              {scoreName} {pct(score)} 分
            </Chip>
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
  // 左右鍵微調（每次 4）；執行中才有效
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!running || (e.code !== "ArrowLeft" && e.code !== "ArrowRight")) return;
      e.preventDefault();
      const v = Math.max(0, Math.min(100, curRef.current + (e.code === "ArrowLeft" ? -4 : 4)));
      curRef.current = v;
      setCur(v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);
  const center = level.centers[Math.min(i, level.centers.length - 1)] ?? 50;
  const inZone = running && Math.abs(cur - center) <= level.width / 2;
  return (
    <div class="stack">
      <p class="small dim">{label}。把滑桿維持在發亮的區間裡，區間會慢慢移動，跟著它。</p>
      <div style={{ position: "relative", height: "28px", border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden", background: "rgba(255,255,255,0.03)" }} aria-label="甜蜜區間">
        <span style={{ position: "absolute", left: `${center - level.width / 2}%`, width: `${level.width}%`, top: 0, bottom: 0, background: "rgba(255,95,162,0.35)" }} />
        <span style={{ position: "absolute", left: `${cur}%`, top: "4px", width: "6px", height: "20px", background: inZone ? "#7e7" : "var(--cyan, #5ee)", transform: "translateX(-3px)", boxShadow: inZone ? "0 0 8px #7e7" : "none" }} />
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
        {running && <span class="small dim">{inZone ? "✔ 在區間內" : "✘ 偏離了"}　進行中…{Math.round((i / level.centers.length) * 100)}%（可用 ←／→ 鍵）</span>}
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

// ───────── 第 3 關（後半）：調配——光標來回掃，在甜蜜帶按下才算加進去 ─────────
function DoseGame({ level, items, onDone }: { level: DoseLevel; items: { name: string; dir: number }[]; onDone: (taps: number[]) => void }) {
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const taps = useRef<number[]>([]);
  const t0 = useRef(0);
  const raf = useRef(0);
  const idxRef = useRef(0);
  const doneRef = useRef(false);

  const advance = (t: number) => {
    const i = idxRef.current;
    taps.current[i] = t;
    setResults((r) => [...r, doseHit(level, i, t)]);
    if (i + 1 >= items.length) {
      doneRef.current = true;
      cancelAnimationFrame(raf.current);
      setIdx(items.length);
      return;
    }
    idxRef.current = i + 1;
    setIdx(i + 1);
    t0.current = performance.now();
  };
  const tap = () => {
    if (doneRef.current) return;
    advance(Math.round(performance.now() - t0.current));
  };
  useEffect(() => {
    t0.current = performance.now();
    const loop = () => {
      const t = performance.now() - t0.current;
      setNow(t);
      if (t > level.phase) advance(-1); // 逾時沒按＝沒加成
      if (!doneRef.current) raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const finished = idx >= items.length;
  const band = level.bands[Math.min(idx, items.length - 1)]!;
  const pos = dosePos(level, now);
  const inBand = !finished && Math.abs(pos - band.center) <= band.width / 2;
  return (
    <div class="stack">
      {!finished ? (
        <p class="small dim">
          第 {idx + 1}／{items.length} 項：<b>{items[idx]!.name}</b>
          {items[idx]!.dir > 0 ? " ＋1" : " −1"}。光標掃進發亮的甜蜜帶時按下「加入」（空白鍵也行），沒按準就不會加進去。
        </p>
      ) : (
        <p class="small dim">調配完成。</p>
      )}
      <div style={{ position: "relative", height: "40px", border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden", background: "rgba(255,255,255,0.03)" }} aria-label="調配軌道">
        <span style={{ position: "absolute", left: `${band.center - band.width / 2}%`, width: `${band.width}%`, top: 0, bottom: 0, background: "rgba(255,95,162,0.35)" }} />
        {!finished && <span style={{ position: "absolute", left: `${pos}%`, top: "6px", width: "6px", height: "28px", background: inBand ? "#7e7" : "var(--cyan, #5ee)", transform: "translateX(-3px)", boxShadow: inBand ? "0 0 8px #7e7" : "none" }} />}
      </div>
      <div class="row" style={{ gap: "6px", flexWrap: "wrap" }}>
        {items.map((it, i) => (
          <Chip key={i} tone={results[i] === undefined ? "dim" : results[i] ? "green" : "amber"}>
            {it.name} {results[i] === undefined ? "…" : results[i] ? "✔ 加進去了" : "✘ 沒調準"}
          </Chip>
        ))}
      </div>
      <div class="row">
        {!finished ? (
          <button
            class="btn primary"
            style={{ flex: 1, minHeight: "52px", fontSize: "18px", touchAction: "manipulation" }}
            onPointerDown={(e) => {
              e.preventDefault();
              tap();
            }}
          >
            加入
          </button>
        ) : (
          <Btn kind="primary" onClick={() => onDone(taps.current.slice())}>
            用這次的調配
          </Btn>
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
  const prepLevel = useMemo(() => (seed === undefined ? null : (makeLevel("cut", stageSeed(seed, 0), group, diff) as CutLevel)), [seed, group, diff]);
  const actLevel = useMemo(() => (seed === undefined ? null : makeLevel(kind, stageSeed(seed, 1), group, diff)), [seed, group, diff, kind]);
  const [step, setStep] = useState(0);
  const [prep, setPrep] = useState<number[]>([]);
  const [act, setAct] = useState<number[]>([]);
  const [tweak, setTweak] = useState<Record<string, number>>({});
  const [dosing, setDosing] = useState(false);
  const [doseTaps, setDoseTaps] = useState<number[]>([]);
  const doseLevel = useMemo(() => (seed === undefined ? null : (makeLevel("dose", stageSeed(seed, 2), group, diff) as DoseLevel)), [seed, group, diff]);

  if (seed === undefined || !prepLevel || !actLevel || !doseLevel) {
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
  const play: PlayInput = { seed, stages: [{ id: "prep", inputs: prep }, { id: "act", inputs: act }, { id: "tweak", inputs: doseTaps }], tweak };
  const result = scorePlay(group, picks.method, diff, seed, play);
  const prepScore = prep.length ? scoreCut(prepLevel, prep) : 0;
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
            <TimingGame
              key="prep"
              targets={prepLevel.targets}
              decoys={prepLevel.decoys}
              win={prepLevel.window}
              duration={prepLevel.duration}
              label={`${def.prep.label}：${def.prep.good}與${def.prep.bad}交錯出現`}
              goodLabel={def.prep.good}
              badLabel={def.prep.bad}
              action="下刀"
              scoreOf={(x) => scoreCut(prepLevel, x)}
              scoreName="處理"
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
              <TimingGame
                key="act"
                targets={actLevel.beats}
                decoys={[]}
                win={actLevel.window}
                duration={actLevel.duration}
                label={def.act.actions.rhythm}
                goodLabel="節拍"
                badLabel=""
                action="下手"
                scoreOf={(x) => scoreRhythm(actLevel, x)}
                scoreName="手感"
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
            {!dosing ? (
              <div class="row">
                <Btn
                  kind="primary"
                  disabled={Object.keys(tweak).length === 0}
                  onClick={() => {
                    setDoseTaps([]);
                    setDosing(true);
                  }}
                >
                  開始調配（{Object.keys(tweak).length} 項）
                </Btn>
                <Btn
                  disabled={props.mustTweak}
                  onClick={() => {
                    setTweak({});
                    setDoseTaps([]);
                    setStep(3);
                  }}
                  title={props.mustTweak ? "這個組合以前試過，要調配出不同的微調才能再試" : "不微調"}
                >
                  不調味，下一步
                </Btn>
              </div>
            ) : (
              <DoseGame
                key="dose"
                level={doseLevel}
                items={Object.entries(tweak)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => ({ name: TAG_BY_ID[group][k]?.name ?? k, dir: v }))}
                onDone={(x) => {
                  setDoseTaps(x);
                  setDosing(false);
                  setStep(3);
                }}
              />
            )}
          </>
        )}
        {step === 3 && (
          <div class="stack">
            <Meter label={`${def.prep.icon} ${def.prep.label}`} value={prepScore * 100} hint={pct(prepScore)} tone="cyan" />
            <Meter label={`${def.act.icon} ${def.act.label}`} value={actScore * 100} hint={pct(actScore)} tone="pink" />
            <p class="small">
              手藝總分 <b>{result ? pct(result.score) : 0}</b>，廚藝經驗加成 <b>＋{result?.bonus ?? 0}</b>（最多 ＋3）
              {result && Object.keys(result.tweak).length > 0 ? `；微調 ${Object.entries(result.tweak).map(([k, v]) => `${TAG_BY_ID[group][k]?.name ?? k}${v > 0 ? "＋" : "－"}1`).join("、")}` : ""}
              {result && result.tried > Object.keys(result.tweak).length ? `（${result.tried - Object.keys(result.tweak).length} 項沒調準，沒有加進去）` : ""}。
            </p>
            {props.mustTweak && result && Object.keys(result.tweak).length === 0 && <p class="small dim">這個組合以前試過，需要至少一項微調調配成功才能再試。</p>}
            <div class="row">
              <Btn kind="primary" disabled={props.mustTweak && !!result && Object.keys(result.tweak).length === 0} onClick={() => props.onStart(play)}>
                開始{props.verb}
              </Btn>
              <Btn
                onClick={() => {
                  setDosing(false);
                  setStep(0);
                }}
              >
                重玩
              </Btn>
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
