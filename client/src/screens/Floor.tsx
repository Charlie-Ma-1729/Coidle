import { useState } from "preact/hooks";
import { CATEGORY_BY_ID, ZONES, categoryHasStock, expandInfo, isZoneUnlocked, ticksToRealMinutes, type PublicMallState, type Shop, type Slot } from "@coidle/shared";
import { Btn, Chip, Empty } from "../components/ui";
import { money, moneyShort } from "../format";
import { categoryIcon, ZONE_ICONS } from "../icons";
import { run, state } from "../store";
import { BuildSheet } from "./BuildSheet";
import { ShopSheet } from "./ShopSheet";

function shopStatus(s: PublicMallState, shop: Shop): { tone: "ok" | "warn" | "bad"; tags: { text: string; tone: "red" | "amber" | "green" | "cyan" | "dim" }[] } {
  const cat = CATEGORY_BY_ID[shop.category]!;
  const tags: { text: string; tone: "red" | "amber" | "green" | "cyan" | "dim" }[] = [];
  let tone: "ok" | "warn" | "bad" = "ok";
  if (shop.closedUntilTick > s.tick) {
    tags.push({ text: "休息中", tone: "red" });
    tone = "bad";
  } else if (categoryHasStock(cat) && shop.mode === "direct" && shop.stock < 1) {
    tags.push({ text: "缺貨", tone: "red" });
    tone = "bad";
  } else if (categoryHasStock(cat) && shop.mode === "direct" && shop.stock < shop.restock.min / 2) {
    tags.push({ text: "庫存低", tone: "amber" });
    tone = "warn";
  }
  if (shop.day.lost >= 3) tags.push({ text: "爆滿", tone: "cyan" });
  if (shop.mode === "direct" && shop.freshness < 40) {
    tags.push({ text: "沒新意", tone: "amber" });
    if (tone === "ok") tone = "warn";
  }
  if (shop.mode === "lease") tags.push({ text: "出租", tone: "dim" });
  if (s.builds.some((b) => b.kind === "upgrade" && b.shopId === shop.id)) tags.push({ text: "翻新中", tone: "cyan" });
  return { tone, tags };
}

function SlotTile({ s, slot, onShop, onBuild }: { s: PublicMallState; slot: Slot; onShop: (id: string) => void; onBuild: (slot: number) => void }) {
  const shop = slot.shopId ? s.shops.find((x) => x.id === slot.shopId) : undefined;
  const building = s.builds.find((b) => b.kind === "open" && b.slot === slot.id);

  if (shop) {
    const cat = CATEGORY_BY_ID[shop.category]!;
    const st = shopStatus(s, shop);
    return (
      <button class={`slot ${st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : ""}`} onClick={() => onShop(shop.id)}>
        <div class="row between">
          <span class="s-ico">{categoryIcon(shop.category)}</span>
          <Chip tone="amber">Lv.{shop.level}</Chip>
        </div>
        <div>
          <div class="s-name">{shop.name}</div>
          <div class="s-meta">
            <span>{cat.name}</span>
            <span>今日 {moneyShort(shop.day.revenue)}</span>
          </div>
        </div>
        <div class="row" style={{ gap: "4px" }}>
          {st.tags.map((t) => (
            <Chip key={t.text} tone={t.tone}>
              {t.text}
            </Chip>
          ))}
        </div>
      </button>
    );
  }
  if (building) {
    const cat = CATEGORY_BY_ID[building.category ?? ""];
    const mins = Math.round(ticksToRealMinutes(building.completeTick - s.tick, s.clock.speed));
    return (
      <div class="slot building" style={{ cursor: "default" }}>
        <span class="s-ico">🚧</span>
        <div>
          <div class="s-name">興建「{cat?.name}」</div>
          <div class="s-meta">還要約 {mins >= 60 ? `${(mins / 60).toFixed(1)} 小時` : `${mins} 分鐘`}</div>
        </div>
      </div>
    );
  }
  return (
    <button class="slot empty-slot" onClick={() => onBuild(slot.id)}>
      <span class="s-ico">＋</span>
      <span>空店面・招商開店</span>
    </button>
  );
}

function ExpandCard({ s, zoneId }: { s: PublicMallState; zoneId: string }) {
  const info = expandInfo(s, zoneId);
  if (info.n >= info.max) return <p class="small dim">🏗️ 這個區域已擴建到上限（{info.max}／{info.max}）。</p>;
  return (
    <div class="card">
      <div class="row between">
        <div>
          <b>🏗️ 擴建店面</b>
          <p class="small dim">
            再蓋一個店面（已擴建 {info.n}／{info.max}）。越蓋越貴，擴建費也會計入固定資產稅。
            {s.level < info.minLevel && ` 商場達到 Lv.${info.minLevel} 才能繼續擴建。`}
          </p>
        </div>
        <Btn small kind="primary" disabled={!info.canBuy} onClick={() => run({ type: "expandZone", zone: zoneId }, "擴建完成，多了一個店面")}>
          {money(info.cost)}
        </Btn>
      </div>
    </div>
  );
}

export function Floor() {
  const s = state.value;
  const [zoneId, setZoneId] = useState("b1");
  const [shopId, setShopId] = useState<string | null>(null);
  const [buildSlot, setBuildSlot] = useState<number | null>(null);
  if (!s) return null;

  const zone = ZONES.find((z) => z.id === zoneId) ?? ZONES[0]!;
  const unlocked = isZoneUnlocked(s, zone.id);
  const slots = s.slots.filter((x) => x.zone === zone.id);
  const used = slots.filter((x) => x.shopId).length;

  return (
    <>
      <nav class="zones" aria-label="樓層">
        {ZONES.map((z) => {
          const open = isZoneUnlocked(s, z.id);
          return (
            <button key={z.id} class={`zone-tab ${z.id === zone.id ? "active" : ""} ${open ? "" : "locked"}`} onClick={() => setZoneId(z.id)}>
              {open ? ZONE_ICONS[z.id] : "🔒"} {z.name.split(" ")[0]}
            </button>
          );
        })}
      </nav>

      <div class="row between">
        <div>
          <h3>{zone.name}</h3>
          <p class="small dim">{zone.description}</p>
        </div>
        {unlocked && (
          <Chip tone="cyan">
            {used}/{slots.length} 店面
          </Chip>
        )}
      </div>

      {unlocked ? (
        <div class="slots">
          {slots.map((slot) => (
            <SlotTile key={slot.id} s={s} slot={slot} onShop={setShopId} onBuild={setBuildSlot} />
          ))}
        </div>
      ) : (
        <div class="card lock-note">
          <p class="big">🔒</p>
          <p>商場升到 <b>Lv.{zone.unlockLevel}</b> 後開放（目前 Lv.{s.level}）。</p>
          <p class="small dim">累積營收、維持口碑，就能解鎖新的區域與業態。</p>
        </div>
      )}

      {unlocked && slots.length === 0 && <Empty>這個區域沒有店面。</Empty>}
      {unlocked && zone.maxExpand > 0 && <ExpandCard s={s} zoneId={zone.id} />}
      {shopId && <ShopSheet shopId={shopId} onClose={() => setShopId(null)} />}
      {buildSlot !== null && <BuildSheet slotId={buildSlot} onClose={() => setBuildSlot(null)} />}
    </>
  );
}
