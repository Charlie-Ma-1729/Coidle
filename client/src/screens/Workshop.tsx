import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import {
  CATEGORY_BY_ID,
  PERSONA_BY_ID,
  RND_BASE_COST,
  RND_TICKS,
  RND_TICKS_SPECIAL,
  SLOT_KINDS,
  TAG_BY_ID,
  WORKSHOP_INFO,
  ZONES,
  comboKey,
  dishFitsCategory,
  ingredientFitsCategory,
  menuSlots,
  rndCostOf,
  type Dish,
  type IngredientInfo,
  type PublicMallState,
  type RndOutcome,
  type Shop,
  type SlotKind,
  type Tasting,
} from "@coidle/shared";
import { Btn, Card, Chip, Empty, Meter } from "../components/ui";
import { clockText, dateText, money, realDuration } from "../format";
import { PERSONA_ICONS } from "../icons";
import { FLOOR_LABELS } from "../stage/adapter";
import { run, state } from "../store";

/** 從別處（例如店面面板的「去工坊研發」）指定要先看哪一間店；工坊讀過就清掉 */
export const workshopFocus = signal<string | null>(null);

type Sub = "rnd" | "menu" | "book" | "notes";
const SUBS: { id: Sub; label: string }[] = [
  { id: "rnd", label: "🧪 研發" },
  { id: "menu", label: "🍽️ 菜單" },
  { id: "book", label: "📖 食譜本" },
  { id: "notes", label: "🗒️ 筆記" },
];

const OUTCOME: Record<RndOutcome, { label: string; tone: "green" | "cyan" | "red" | "amber" }> = {
  signature: { label: "🌟 招牌誕生", tone: "green" },
  original: { label: "普通創作", tone: "cyan" },
  flop: { label: "搭配失衡", tone: "red" },
  burnt: { label: "手滑失敗", tone: "red" },
  almost: { label: "差一點點", tone: "amber" },
};

function directShops(s: PublicMallState): Shop[] {
  return s.shops.filter((x) => x.mode === "direct");
}

/** 店面在哪一層（區域）：先看實際蓋在哪個店面格，找不到就用業態預設的區域 */
function zoneOfShop(s: PublicMallState, shop: Shop): string {
  return s.slots.find((x) => x.id === shop.slot)?.zone ?? CATEGORY_BY_ID[shop.category]?.zone ?? "";
}

function floorTitle(zoneId: string): string {
  const z = ZONES.find((x) => x.id === zoneId);
  return `${FLOOR_LABELS[zoneId] ?? zoneId} ${(z?.name ?? "").replace(/^(?:B1|\d+F)\s/, "")}`.trim();
}

/** 有直營店的樓層（照樓層順序） */
function floorsWithShops(s: PublicMallState, shops: Shop[]): string[] {
  const have = new Set(shops.map((x) => zoneOfShop(s, x)));
  return ZONES.map((z) => z.id).filter((id) => have.has(id));
}

function ingName(s: PublicMallState, id: string | undefined): string {
  return (id && s.workshop.ingredients.find((i) => i.id === id)?.name) || "？";
}

function TagChips({ group, tags }: { group: keyof typeof TAG_BY_ID; tags: string[] }) {
  return (
    <>
      {tags.map((t) => (
        <Chip key={t} tone="cyan">
          {TAG_BY_ID[group][t]?.name ?? t}
        </Chip>
      ))}
    </>
  );
}

function AppealChips({ dish }: { dish: Pick<Dish, "appeal"> }) {
  const top = Object.entries(dish.appeal)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (top.length === 0) return <span class="small dim">沒有特別偏好的客群</span>;
  return (
    <>
      {top.map(([p, v]) => (
        <Chip key={p} tone="pink">
          {PERSONA_ICONS[p] ?? ""} {PERSONA_BY_ID[p as keyof typeof PERSONA_BY_ID]?.name} {Math.round(v * 100)}
        </Chip>
      ))}
    </>
  );
}

function TastingCard({ s, t }: { s: PublicMallState; t: Tasting }) {
  const shop = s.shops.find((x) => x.id === t.shopId);
  const dish = t.dishId ? s.workshop.dishes.find((d) => d.id === t.dishId) : undefined;
  if (!shop) return null;
  const o = OUTCOME[t.outcome];
  const full = shop.menu.length >= menuSlots(shop.level);
  return (
    <div class="alert cyan">
      <div class="row between">
        <h4>
          🍴 「{shop.name}」的試吃結果
        </h4>
        <Chip tone={o.tone}>{o.label}</Chip>
      </div>
      {dish && (
        <p>
          {dish.icon} <b>{dish.name}</b>　品質 {dish.quality}
        </p>
      )}
      {t.feedback.map((f, i) => (
        <p class="small" key={i}>
          {f}
        </p>
      ))}
      {t.clue && <p class="small">💡 {t.clue}</p>}
      {t.learned.length > 0 && (
        <p class="small dim">
          掌握了特性：
          {t.learned.map((l) => `${ingName(s, l.ingredientId)}→${TAG_BY_ID[shop ? CATEGORY_BY_ID[shop.category]!.group : "food"][l.tag]?.name ?? l.tag}`).join("、")}
        </p>
      )}
      <div class="row">
        {dish ? (
          <>
            <Btn small kind="primary" disabled={full} title={full ? "菜單滿了，先到上方「菜單」換掉一道" : ""} onClick={() => run({ type: "tastingAction", uid: t.uid, action: "list" }, "上架了")}>
              上架到菜單
            </Btn>
            <Btn small onClick={() => run({ type: "tastingAction", uid: t.uid, action: "keep" })}>
              收進食譜本
            </Btn>
            {!dish.signature && (
              <Btn small onClick={() => run({ type: "tastingAction", uid: t.uid, action: "discard" })}>
                丟掉
              </Btn>
            )}
          </>
        ) : (
          <Btn small onClick={() => run({ type: "tastingAction", uid: t.uid, action: "keep" })}>
            知道了
          </Btn>
        )}
      </div>
    </div>
  );
}

function IngredientButton({ s, d, picked, onPick }: { s: PublicMallState; d: IngredientInfo; picked: boolean; onPick: () => void }) {
  const learned = s.workshop.learned[d.id] ?? [];
  return (
    <button class={`zone-tab ${picked ? "active" : ""}`} onClick={onPick} title={d.desc}>
      {d.icon} {d.name}
      <small class="dim"> ¥{d.cost.toLocaleString()}</small>
      {learned.length > 0 && <small> ·{learned.map((t) => TAG_BY_ID[d.group][t]?.name).join("")}</small>}
    </button>
  );
}

function Research({ s, shop }: { s: PublicMallState; shop: Shop }) {
  const cat = CATEGORY_BY_ID[shop.category]!;
  const info = WORKSHOP_INFO[cat.group];
  const [picks, setPicks] = useState<Partial<Record<SlotKind, string>>>({});
  const job = s.workshop.jobs.find((j) => j.shopId === shop.id);
  const pool = (k: SlotKind) => s.workshop.ingredients.filter((i) => ingredientFitsCategory(i, shop.category) && i.slot === k);
  const chosen = SLOT_KINDS.map((k) => s.workshop.ingredients.find((i) => i.id === picks[k])).filter((x): x is IngredientInfo => !!x);
  const cost = rndCostOf(cat.group, chosen.map((c) => c.cost));
  const ready = !!picks.base && !!picks.season && !!picks.method;
  const prev = ready ? s.workshop.tried[comboKey(shop.category, picks)] : undefined;
  const blocked = prev === "signature" || prev === "original" || prev === "flop";
  const skill = s.workshop.skill[shop.id] ?? 0;

  if (job) {
    const total = job.endTick - job.startTick;
    const done = Math.min(100, ((s.tick - job.startTick) / total) * 100);
    return (
      <Card title={`${info.icon} ${info.name}進行中`}>
        <div class="stack">
          <p class="small">
            {SLOT_KINDS.filter((k) => job.picks[k]).map((k) => `${info.slots[k]}：${ingName(s, job.picks[k])}`).join("　")}
          </p>
          <Meter label="進度" value={done} hint={`還要 ${realDuration(job.endTick - s.tick, s.clock.speed, s.clock.lag)}（離線也會繼續）`} tone="cyan" />
          <div class="row">
            <Btn small kind="danger" onClick={() => run({ type: "cancelRnd", shopId: shop.id }, "已取消，退回一半費用")}>
              取消（退回一半）
            </Btn>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title={`${info.icon} ${info.name}`} right={<span class="small dim">廚藝經驗 {skill}</span>}>
      <div class="stack">
        <p class="small dim">
          選好素材就能開始{info.verb}。配方是隱藏的——搭配對了可能做出招牌，搭配失衡會失敗；同一個組合不會給你第二次線索。
        </p>
        {SLOT_KINDS.map((k) => (
          <div key={k}>
            <div class="small dim">
              {info.slots[k]}
              {k === "special" ? "（選填）" : ""}
            </div>
            <nav class="zones">
              {pool(k).map((d) => (
                <IngredientButton key={d.id} s={s} d={d} picked={picks[k] === d.id} onPick={() => setPicks({ ...picks, [k]: picks[k] === d.id ? undefined : d.id })} />
              ))}
            </nav>
          </div>
        ))}
        {prev && <p class="small">⚠️ 這個組合你試過了：{OUTCOME[prev].label}。{blocked ? "不能重複。" : "可以再試一次。"}</p>}
        <p class="small dim">
          費用 {money(ready ? cost : RND_BASE_COST[cat.group])}　時間 {realDuration(picks.special ? RND_TICKS_SPECIAL : RND_TICKS, s.clock.speed, s.clock.lag)}
        </p>
        <div class="row">
          <Btn kind="primary" disabled={!ready || blocked || s.funds < cost} onClick={() => run({ type: "startRnd", shopId: shop.id, picks }, "開始研發！")}>
            開始{info.verb}
          </Btn>
          <Btn small onClick={() => setPicks({})}>
            清空
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function MenuView({ s, shop }: { s: PublicMallState; shop: Shop }) {
  const slots = menuSlots(shop.level);
  const avail = s.workshop.dishes.filter((d) => dishFitsCategory(d, shop.category) && !shop.menu.some((e) => e.dishId === d.id));
  const [replace, setReplace] = useState<number | null>(null);
  return (
    <>
      <Card title={`🍽️ 「${shop.name}」的菜單`} right={<span class="small dim">{shop.menu.length}／{slots} 欄</span>}>
        <div class="stack">
          {Array.from({ length: slots }, (_, i) => {
            const e = shop.menu[i];
            return e ? (
              <div class="rank" key={i}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div class="row between small">
                    <b>
                      {e.icon} {e.name} {e.signature && <Chip tone="green">招牌</Chip>}
                    </b>
                    <span>品質 {e.quality}</span>
                  </div>
                  <Meter label="新鮮度" value={e.novelty} hint={`${Math.round(e.novelty)}`} tone={e.novelty < 50 ? "amber" : "cyan"} />
                  <div class="row">
                    <AppealChips dish={e} />
                  </div>
                  <div class="row">
                    <Btn small onClick={() => run({ type: "unlistDish", shopId: shop.id, slotIndex: i })}>
                      下架
                    </Btn>
                    <Btn small onClick={() => setReplace(replace === i ? null : i)}>
                      {replace === i ? "取消換菜" : "換一道"}
                    </Btn>
                  </div>
                </div>
              </div>
            ) : (
              <p class="small dim" key={i}>
                （空欄位）
              </p>
            );
          })}
        </div>
      </Card>
      <Card title="可以上架的作品">
        {avail.length === 0 ? (
          <Empty>食譜本裡沒有適合這間店的作品。到「研發」分頁試做看看吧。</Empty>
        ) : (
          <div class="stack">
            {avail.map((d) => (
              <div class="row between" key={d.id}>
                <span class="small">
                  {d.icon} <b>{d.name}</b> {d.signature && <Chip tone="green">招牌</Chip>}　品質 {d.quality}　新鮮度 {Math.round(d.novelty)}
                </span>
                <Btn small kind="primary" disabled={shop.menu.length >= slots && replace === null} onClick={() => run({ type: "listDish", shopId: shop.id, dishId: d.id, slotIndex: replace ?? undefined }, "上架了")}>
                  {shop.menu.length >= slots ? (replace === null ? "先選要換掉的" : "換上去") : "上架"}
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

/** 這道作品是用哪些素材搭出來的，例如「主料：豬里肌　調味：柑橘汁　手法：酥炸」 */
function recipeLine(s: PublicMallState, d: Dish): string {
  const slots = WORKSHOP_INFO[d.group].slots;
  const parts = SLOT_KINDS.filter((k) => d.picks[k]).map((k) => `${slots[k]}：${ingName(s, d.picks[k])}`);
  return parts.join("　");
}

/** 食譜本裡的一道作品：可以直接上架到適合的店（菜單滿了就選一道換掉） */
function BookEntry({ s, d }: { s: PublicMallState; d: Dish }) {
  const [open, setOpen] = useState(false);
  const fitting = directShops(s).filter((x) => dishFitsCategory(d, x.category));
  const listedIn = s.shops.filter((x) => x.menu.some((e) => e.dishId === d.id));
  const free = fitting.filter((x) => !x.menu.some((e) => e.dishId === d.id));
  return (
    <div>
      <div class="row between">
        <b>
          {d.icon} {d.name} {d.signature && <Chip tone="green">招牌</Chip>}
        </b>
        <span class="small">品質 {d.quality}</span>
      </div>
      <p class="small dim">{d.desc}（{d.madeAt}・{dateText(d.madeTick)}）</p>
      <p class="small">🧾 {recipeLine(s, d) || "（沒有素材紀錄）"}</p>
      {listedIn.length > 0 && <p class="small dim">上架中：{listedIn.map((x) => x.name).join("、")}</p>}
      <div class="row">
        <TagChips group={d.group} tags={d.tags} />
        <AppealChips dish={d} />
      </div>
      <div class="row">
        <Btn small kind="primary" disabled={free.length === 0} title={free.length === 0 ? "沒有適合的店，或已經在每間適合的店上架了" : ""} onClick={() => setOpen(!open)}>
          {open ? "收起" : "上架到…"}
        </Btn>
        {listedIn.length === 0 && !d.signature && (
          <Btn small onClick={() => run({ type: "discardDish", dishId: d.id })}>
            丟掉
          </Btn>
        )}
      </div>
      {open && (
        <div class="stack">
          {free.map((x) => {
            const slots = menuSlots(x.level);
            const full = x.menu.length >= slots;
            return (
              <div key={x.id}>
                <div class="row between small">
                  <span>
                    {floorTitle(zoneOfShop(s, x))}・<b>{x.name}</b>　菜單 {x.menu.length}／{slots}
                  </span>
                  {!full && (
                    <Btn small kind="primary" onClick={() => run({ type: "listDish", shopId: x.id, dishId: d.id }, "上架了")}>
                      上架
                    </Btn>
                  )}
                </div>
                {full && (
                  <div class="row">
                    {x.menu.map((e, i) => (
                      <Btn key={e.dishId} small onClick={() => run({ type: "listDish", shopId: x.id, dishId: d.id, slotIndex: i }, "已換上去")}>
                        換掉「{e.name}」
                      </Btn>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Book({ s }: { s: PublicMallState }) {
  const dishes = s.workshop.dishes.slice().reverse();
  return (
    <Card title="📖 食譜本" right={<span class="small dim">招牌 {s.workshop.discovered.length} 道</span>}>
      {dishes.length === 0 ? (
        <Empty>還沒有作品。做出第一道菜之後，會收在這裡。</Empty>
      ) : (
        <div class="stack">
          {dishes.map((d) => (
            <BookEntry key={d.id} s={s} d={d} />
          ))}
        </div>
      )}
    </Card>
  );
}

function Notes({ s, floor }: { s: PublicMallState; floor: string | undefined }) {
  // 素材圖鑑：只列所選樓層的業態，每個業態各自一組
  const cats = [...new Set(directShops(s).filter((x) => zoneOfShop(s, x) === floor).map((x) => x.category))].filter((c) => CATEGORY_BY_ID[c]);
  const clues = s.workshop.clues.slice().sort((a, b) => Number(a.solved) - Number(b.solved) || b.tick - a.tick);
  return (
    <>
      <Card title="💡 線索簿" right={<span class="small dim">客人、供應商與對手的閒聊裡藏著配方的方向</span>}>
        {clues.length === 0 ? (
          <Empty>還沒有線索。多和常客互動、認識供應商、刺探對手，會慢慢聽到一些。</Empty>
        ) : (
          <div class="log">
            <ul>
              {clues.map((c) => (
                <li key={c.id}>
                  <time>{c.solved ? "✅ 已解開" : c.source}</time>
                  <span class={c.solved ? "dim" : ""}>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
      <Card title="🧾 實驗紀錄">
        {s.workshop.log.length === 0 ? (
          <Empty>還沒做過研發。</Empty>
        ) : (
          <div class="log">
            <ul>
              {s.workshop.log
                .slice()
                .reverse()
                .slice(0, 15)
                .map((l, i) => (
                  <li key={i}>
                    <time>
                      {dateText(l.tick)} {clockText(l.tick)}
                    </time>
                    <span>
                      「{l.shopName}」{SLOT_KINDS.filter((k) => l.picks[k]).map((k) => ingName(s, l.picks[k])).join("＋")} → {OUTCOME[l.outcome].label}
                      {l.dishName ? `《${l.dishName}》` : ""}：{l.feedback.join(" ")}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Card>
      <Card title="🥬 素材圖鑑" right={<span class="small dim">{floor ? floorTitle(floor) : ""}</span>}>
        {cats.length === 0 ? (
          <Empty>這一層還沒有直營的店。</Empty>
        ) : (
          <div class="stack">
            {cats.map((c) => {
              const cat = CATEGORY_BY_ID[c]!;
              const g = cat.group;
              const list = s.workshop.ingredients.filter((i) => ingredientFitsCategory(i, c));
              return (
                <div key={c}>
                  <b class="small">
                    {WORKSHOP_INFO[g].icon} {cat.name}　<span class="dim">{list.length} 種</span>
                  </b>
                  {list.map((i) => (
                    <p class="small" key={i.id}>
                      {i.icon} {i.name}（{WORKSHOP_INFO[g].slots[i.slot]}）— <span class="dim">{i.desc}</span>{" "}
                      {(s.workshop.learned[i.id] ?? []).length > 0 ? <TagChips group={g} tags={s.workshop.learned[i.id]!} /> : <span class="dim">特性未知</span>}
                    </p>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

export function Workshop() {
  const s = state.value;
  const [sub, setSub] = useState<Sub>("rnd");
  const [floorId, setFloorId] = useState<string | null>(null);
  /** 每一層各自記得上次選的店 */
  const [shopByFloor, setShopByFloor] = useState<Record<string, string>>({});

  // 別處指定要看的店：切到它那一層、選到它，然後清掉
  const focus = workshopFocus.value;
  useEffect(() => {
    const cur = state.value;
    if (!focus || !cur) return;
    const target = directShops(cur).find((x) => x.id === focus);
    if (target) {
      const z = zoneOfShop(cur, target);
      setFloorId(z);
      setShopByFloor((m) => ({ ...m, [z]: target.id }));
      setSub("rnd");
    }
    workshopFocus.value = null;
  }, [focus]);

  if (!s) return null;
  const allShops = directShops(s);
  const floors = floorsWithShops(s, allShops);
  const floor = floorId && floors.includes(floorId) ? floorId : floors[0];
  const shops = allShops.filter((x) => zoneOfShop(s, x) === floor);
  const shop = shops.find((x) => x.id === shopByFloor[floor ?? ""]) ?? shops[0];
  const floorBadge = (z: string): string => {
    const here = allShops.filter((x) => zoneOfShop(s, x) === z);
    const working = here.some((x) => s.workshop.jobs.some((j) => j.shopId === x.id));
    const tasting = here.some((x) => s.workshop.tastings.some((t) => t.shopId === x.id));
    return `${working ? " ⏳" : ""}${tasting ? " 🍴" : ""}`;
  };

  return (
    <>
      {s.workshop.tastings.map((t) => (
        <TastingCard key={t.uid} s={s} t={t} />
      ))}
      <nav class="zones" aria-label="工坊">
        {SUBS.map((x) => (
          <button key={x.id} class={`zone-tab ${sub === x.id ? "active" : ""}`} onClick={() => setSub(x.id)}>
            {x.label}
          </button>
        ))}
      </nav>
      {sub !== "book" && floors.length > 0 && (
        <nav class="zones" aria-label="選擇樓層">
          {floors.map((z) => (
            <button key={z} class={`zone-tab ${floor === z ? "active" : ""}`} onClick={() => setFloorId(z)}>
              {floorTitle(z)}
              {floorBadge(z)}
            </button>
          ))}
        </nav>
      )}
      {(sub === "rnd" || sub === "menu") && (
        <nav class="zones" aria-label="選擇店面">
          {shops.map((x) => (
            <button key={x.id} class={`zone-tab ${shop?.id === x.id ? "active" : ""}`} onClick={() => setShopByFloor({ ...shopByFloor, [floor ?? ""]: x.id })}>
              {WORKSHOP_INFO[CATEGORY_BY_ID[x.category]!.group].icon} {x.name}
              {s.workshop.jobs.some((j) => j.shopId === x.id) ? " ⏳" : ""}
              {s.workshop.tastings.some((t) => t.shopId === x.id) ? " 🍴" : ""}
            </button>
          ))}
        </nav>
      )}
      {sub === "rnd" && (shop ? <Research key={shop.id} s={s} shop={shop} /> : <Empty>還沒有直營的店。</Empty>)}
      {sub === "menu" && (shop ? <MenuView key={shop.id} s={s} shop={shop} /> : <Empty>還沒有直營的店。</Empty>)}
      {sub === "book" && <Book s={s} />}
      {sub === "notes" && <Notes s={s} floor={floor} />}
    </>
  );
}
