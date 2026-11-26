import {
  FIX_OPTIONS,
  PATROL_KINDS,
  PATROL_SPOTS,
  ZONES,
  ZONE_BY_ID,
  CATEGORY_BY_ID,
  fixCost,
  issueInspectionPenalty,
  patrolAp,
  patrolLevel,
  spotsOf,
  type PatrolEffects,
  type PatrolIssue,
  type PublicMallState,
  type Shop,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { gameDeadline, gameDuration, money } from "../format";
import { categoryIcon } from "../icons";
import { run, state } from "../store";
import { WalkCard } from "./Guests";

function effectText(e: PatrolEffects, sev: number): string {
  const parts: string[] = [];
  if (e.clean) parts.push(`館內清潔度每天 ${(e.clean * sev).toFixed(1)}`);
  if (e.equip) parts.push(`設備狀態每天 ${(e.equip * sev).toFixed(1)}`);
  if (e.fresh) parts.push(`這間店的新鮮感每天 ${(e.fresh * sev).toFixed(1)}`);
  if (e.rep) parts.push(`口碑每天 ${(e.rep * sev).toFixed(2)}`);
  if (e.stockLoss) parts.push(`庫存每天損失約 ${(e.stockLoss * sev * 100).toFixed(0)}%`);
  return parts.length > 0 ? parts.join("、") : "暫時沒有看得到的損失，但風險在累積";
}

function Pips({ n, max, label }: { n: number; max: number; label: string }) {
  return (
    <span aria-label={`${label} ${n}/${max}`} title={`${label} ${n}/${max}`}>
      {"●".repeat(Math.max(0, n))}
      <span class="dim">{"○".repeat(Math.max(0, max - n))}</span>
    </span>
  );
}

function Severity({ n }: { n: number }) {
  return (
    <span class={n >= 4 ? "neg" : ""} title={`嚴重度 ${n}／5`}>
      {"▮".repeat(n)}
      <span class="dim">{"▯".repeat(5 - n)}</span>
    </span>
  );
}

function IssueCard({ s, i }: { s: PublicMallState; i: PatrolIssue }) {
  const shop = s.shops.find((x) => x.id === i.shopId);
  const sess = s.patrol?.session;
  const canAct = !!sess && sess.ap > 0;
  const spot = PATROL_SPOTS[i.spot];
  const where = `${shop?.name ?? "某店"}・${spot?.label ?? i.spot}`;
  if (i.status === "hinted") {
    return (
      <div class="alert amber">
        <div class="row between">
          <h4>
            ❓ {where}
          </h4>
          <Btn small disabled={!canAct} title={canAct ? "花 1 點行動力，查明是什麼問題、多嚴重" : "要在巡店中、而且還有行動力"} onClick={() => run({ type: "patrolDeepen", issueId: i.uid }, "查明了")}>
            🔎 查明（1 點）
          </Btn>
        </div>
        <p class="quote">「{i.hint}」</p>
        <p class="small dim">還不知道這是什麼問題、有多嚴重。查明之後才能處理。</p>
      </div>
    );
  }
  const def = PATROL_KINDS[i.kind];
  if (!def) return null;
  if (i.status === "scheduled") {
    return (
      <div class="alert cyan">
        <h4>
          🔧 {where}・{def.label}
        </h4>
        <p class="small dim">已排程處理，{i.fixTick ? gameDeadline(i.fixTick, s.tick) : "不久"} 完成；在那之前問題不再惡化，但影響照舊。</p>
      </div>
    );
  }
  return (
    <div class={`alert ${i.severity >= 4 ? "red" : "amber"}`}>
      <div class="row between">
        <h4>
          {def.icon} {where}・{def.label}
        </h4>
        <Severity n={i.severity} />
      </div>
      <p class="small">{def.detail}</p>
      <p class="small dim">拖著不處理：{effectText(def.daily, i.severity)}。</p>
      {i.severity >= 5 && <p class="small neg">已經非常嚴重，再拖幾天就會釀成事故。</p>}
      <div class="stack">
        {FIX_OPTIONS.map((o) => {
          const cost = fixCost(i.kind, i.severity, o.id);
          return (
            <div class="row between" key={o.id} style={{ alignItems: "flex-start", gap: "8px" }}>
              <span class="small dim" style={{ flex: 1 }}>
                {o.desc}
              </span>
              <Btn small disabled={cost > s.funds} onClick={() => run({ type: "patrolFix", issueId: i.uid, option: o.id }, `${o.label}：${def.label}`)}>
                {o.label}（{money(cost)}）
              </Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SpotButton({ s, shop, spot }: { s: PublicMallState; shop: Shop; spot: string }) {
  const sess = s.patrol?.session;
  const def = PATROL_SPOTS[spot];
  if (!def) return null;
  const known = (s.patrol?.issues ?? []).find((i) => i.shopId === shop.id && i.spot === spot);
  const checked = sess?.checked.includes(`${shop.id}:${spot}`) ?? false;
  const label = `${def.icon} ${def.label}`;
  if (known) {
    return (
      <Chip tone={known.status === "scheduled" ? "cyan" : known.severity >= 4 ? "red" : "amber"} title={def.desc}>
        ⚠ {label}
      </Chip>
    );
  }
  return (
    <Btn small disabled={!sess || sess.ap < 1 || checked} title={checked ? "這趟檢查過了" : sess ? `${def.desc}（1 點行動力）` : "先開始巡店"} onClick={() => run({ type: "patrolInspect", shopId: shop.id, spot })}>
      {checked ? "✓ " : "🔍 "}
      {def.label}
    </Btn>
  );
}

/** 巡店：帶行動點在各店的角落檢查，找出藏起來的問題並處理 */
export function Patrol({ s }: { s: PublicMallState }) {
  const p = s.patrol;
  const sess = p?.session ?? null;
  const xp = p?.xp ?? 0;
  const level = patrolLevel(xp);
  const nextXp = (level + 1) * (level + 1) * 2;
  const cooldown = (p?.nextTick ?? 0) - s.tick;
  const known = (p?.issues ?? []).filter((i) => i.status !== "hidden").sort((a, b) => b.severity - a.severity);
  const direct = s.shops.filter((x) => x.mode === "direct" && x.tenant === null);
  const shopsByZone = ZONES.map((z) => ({ zone: z, shops: direct.filter((x) => CATEGORY_BY_ID[x.category]?.zone === z.id) })).filter((g) => g.shops.length > 0);
  const hygiene = issueInspectionPenalty(p, "hygiene");
  const fire = issueInspectionPenalty(p, "fire");
  const soon = s.inspections.pending.length > 0;
  return (
    <>
      <Card
        title="🚶 巡店"
        right={
          sess ? (
            <Btn small onClick={() => run({ type: "patrolEnd" }, "巡店結束")}>
              結束這趟
            </Btn>
          ) : (
            <Btn kind="primary" small disabled={cooldown > 0 || direct.length === 0} onClick={() => run({ type: "patrolStart" }, "開始巡店")}>
              開始巡店
            </Btn>
          )
        }
      >
        <div class="stack">
          <p class="small dim">
            店裡藏著客人看不到、你也沒空天天盯的問題：衛生死角、過期品、設備異音、消防隱患、個資疏漏……每天都可能冒出新的，越拖越嚴重，最後變成罰款、停業、官司或稽查扣分。帶著行動點，到各店的角落檢查、查明、處理。
          </p>
          {sess ? (
            <div class="row" style={{ flexWrap: "wrap", gap: "10px" }}>
              <span>
                行動力 <b style={{ letterSpacing: "2px" }}>
                  <Pips n={sess.ap} max={sess.apMax} label="行動力" />
                </b>
              </span>
              <span class="small dim">這趟剩 {gameDuration(Math.max(1, sess.expireTick - s.tick))}</span>
              <span class="small dim">
                已檢查 {sess.checked.length} 個點・發現 {sess.found}・處理 {sess.fixed}
              </span>
            </div>
          ) : (
            <p class="small">
              {cooldown > 0 ? `剛巡完，約 ${gameDuration(cooldown)} 後可以再巡。` : `這趟有 ${patrolAp(xp, soon)} 點行動力${soon ? "（稽查將至，多 1 點）" : ""}。`}
            </p>
          )}
          <Meter label={`🧭 巡店熟練度 Lv.${level}（等級越高：行動力越多、越不容易漏看）`} value={level >= 10 ? 100 : Math.min(100, ((xp - level * level * 2) / Math.max(1, nextXp - level * level * 2)) * 100)} hint={level >= 10 ? "滿級" : `${xp} / ${nextXp}`} tone="cyan" />
          <div class="row small" style={{ flexWrap: "wrap", gap: "6px" }}>
            <Chip tone="dim">累計發現 {p?.foundTotal ?? 0}</Chip>
            <Chip tone="dim">累計處理 {p?.fixedTotal ?? 0}</Chip>
            {(p?.incidents ?? 0) > 0 && <Chip tone="red">釀成事故 {p?.incidents} 次</Chip>}
            {(hygiene > 0 || fire > 0) && (
              <Chip tone="amber" title="已知問題在稽查時會直接扣分">
                稽查扣分：衛生 −{hygiene}、消防 −{fire}
              </Chip>
            )}
          </div>
        </div>
      </Card>

      {sess && (
        <Card title="🗺️ 各店檢查點" right={<span class="small dim">每個點 1 點行動力</span>}>
          {shopsByZone.length === 0 ? (
            <Empty>沒有直營店可以巡。</Empty>
          ) : (
            <div class="stack">
              {shopsByZone.map(({ zone, shops }) => (
                <div key={zone.id}>
                  <p class="small dim">{ZONE_BY_ID[zone.id]?.name}</p>
                  {shops.map((shop) => (
                    <div class="report-row" key={shop.id}>
                      <div class="row between">
                        <b>
                          {categoryIcon(shop.category)} {shop.name}
                        </b>
                        <Btn small disabled={sess.ap < 1 || shop.closedUntilTick > s.tick} title="花 1 點行動力，聽一位客人說話" onClick={() => run({ type: "patrolChat", shopId: shop.id })}>
                          💬 聊聊
                        </Btn>
                      </div>
                      <div class="row" style={{ flexWrap: "wrap", gap: "4px" }}>
                        {spotsOf(shop.category).map((sp) => (
                          <SpotButton key={sp} s={s} shop={shop} spot={sp} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card title={`🧾 已知的問題（${known.length}）`}>
        {known.length === 0 ? (
          <Empty>{sess ? "還沒發現問題。繼續檢查各店的角落。" : "目前沒有已知的問題。開始巡店，說不定店裡還藏著什麼。"}</Empty>
        ) : (
          <div class="stack">
            {known.map((i) => (
              <IssueCard key={i.uid} s={s} i={i} />
            ))}
          </div>
        )}
      </Card>

      <WalkCard s={s} />

      {p?.report && !sess && (
        <Card title="📋 上一趟的報告">
          <p class="small">
            檢查了 {p.report.checked} 個點、發現 {p.report.found} 個問題、處理 {p.report.fixed} 件{p.report.spent > 0 ? `（花 ${money(p.report.spent)}）` : ""}；結束時還有 {p.report.open} 件已知問題沒處理。
          </p>
        </Card>
      )}
    </>
  );
}

export function PatrolTab() {
  const s = state.value;
  return s ? <Patrol s={s} /> : null;
}
