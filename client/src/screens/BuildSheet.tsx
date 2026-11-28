import { useState } from "preact/hooks";
import { BRAND_TIER_NAME, CATEGORIES, PERSONA_BY_ID, brandsOfCategory, SHOP_NAME_MAX, ZONE_BY_ID, availableSpans, footprintOf, isCategoryAvailable, licenseOf, openPlanEnabled, BIG_UNLOCK, spanCostFactor, spanDraw, spanFactor, type PersonaId, type Span } from "@coidle/shared";
import { Btn, Chip, Sheet } from "../components/ui";
import { gameDuration, money } from "../format";
import { categoryIcon, PERSONA_ICONS } from "../icons";
import { run, state } from "../store";

export function BuildSheet({ slotId, onClose }: { slotId: number; onClose: () => void }) {
  const s = state.value;
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, Span>>({});
  const slot = s?.slots[slotId];
  if (!s || !slot) return null;
  const zone = ZONE_BY_ID[slot.zone];
  const options = CATEGORIES.filter((c) => c.zone === slot.zone && !c.facility);

  return (
    <Sheet title={`招商開店・${zone?.name ?? ""}`} onClose={onClose}>
      <p class="small dim">選一種業態開在這個店面。組合越多元，整體客流越大；同一種開太多則會互相搶客。</p>
      <label class="small">
        店名（可自取，或點下面的連鎖品牌；留空則自動命名；開張後也能改）
        <input type="text" value={name} maxLength={SHOP_NAME_MAX} placeholder="例如：七福食堂" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      {options.map((c) => {
        const have = s.shops.filter((x) => x.category === c.id).length;
        const top = (Object.entries(c.demand) as [PersonaId, number][])
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        const lic = licenseOf(c.id);
        // 樓層空地化（旗標開了才有）：可選的大小＝業態允許的大小 ∩ 這一區空地放得下的
        const spans: Span[] = openPlanEnabled(s) && footprintOf(c).options.length > 1 ? availableSpans(s, slotId, c) : [1];
        const dflt = footprintOf(c).default; // 體驗型業態預設大店（KTV、健身房…），1 格是迷你版
        const span: Span = picked[c.id] !== undefined && spans.includes(picked[c.id]!) ? picked[c.id]! : spans.includes(dflt) ? dflt : 1;
        const cost = c.buildCost * spanCostFactor(span) + (lic?.fee ?? 0);
        const afford = s.funds >= cost;
        const open = isCategoryAvailable(s, c.id);
        return (
          <div class="build-item" key={c.id}>
            <span class="b-ico">{categoryIcon(c.id)}</span>
            <div>
              <b>{c.name}</b> {have > 0 && <Chip tone="dim">已有 {have} 間</Chip>}
              <div class="small dim">
                客單價約 {money(c.refPrice)}・施工 {gameDuration(c.buildTicks + (lic?.extraTicks ?? 0))}
              </div>
              {spans.length > 1 && (
                <div class="persona-tags">
                  <span class="small dim">大小：</span>
                  {spans.map((sp) => (
                    <button key={sp} type="button" class={`chip ${sp === span ? "on" : ""}`} onClick={() => setPicked({ ...picked, [c.id]: sp })}>
                      {sp} 格{sp > 1 ? `（併入 1 個空格，容量 ×${spanFactor(sp)}，吸客力 ×${spanDraw(sp, c.id)}）` : "（迷你版）"}
                    </button>
                  ))}
                </div>
              )}
              {span > 1 && BIG_UNLOCK[c.id] && (
                <div class="small dim">
                  🏬 解鎖客層：{BIG_UNLOCK[c.id]!.label}（{Object.keys(BIG_UNLOCK[c.id]!.demand).map((p) => PERSONA_BY_ID[p as PersonaId]?.name ?? p).join("、")}）
                </div>
              )}
              {openPlanEnabled(s) && spans.length === 1 && footprintOf(c).options.length > 1 && <div class="small dim">這格左右沒有可併的空地，只能開 1 格。</div>}
              {lic && (
                <div class="small dim">
                  📜 {lic.name}（{lic.law}）規費 {money(lic.fee)}
                </div>
              )}
              {brandsOfCategory(c.id).length > 0 && (
                <div class="persona-tags">
                  <span class="small dim">連鎖品牌：</span>
                  {brandsOfCategory(c.id).map((br) => {
                    const used = s.shops.some((x) => x.name === br.name) || s.builds.some((x) => x.name === br.name);
                    return (
                      <button key={br.id} type="button" class="chip" disabled={used} title={`${BRAND_TIER_NAME[br.tier]}・${br.blurb}`} onClick={() => setName(br.name)}>
                        {br.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <div class="persona-tags">
                {top.map(([p]) => (
                  <Chip key={p} tone="cyan">
                    {PERSONA_ICONS[p]} {PERSONA_BY_ID[p]?.name}
                  </Chip>
                ))}
              </div>
            </div>
            <Btn
              kind="primary"
              small
              disabled={!afford || !open}
              onClick={async () => {
                if (await run({ type: "buildShop", slot: slotId, category: c.id, ...(span > 1 ? { span } : {}), ...(name.trim() ? { name: name.trim() } : {}) }, `開始興建「${name.trim() || c.name}」`)) onClose();
              }}
            >
              {open ? money(cost) : `Lv.${c.minLevel}`}
            </Btn>
          </div>
        );
      })}
    </Sheet>
  );
}
