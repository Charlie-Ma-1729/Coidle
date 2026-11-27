import { useState } from "preact/hooks";
import { BRAND_TIER_NAME, CATEGORIES, PERSONA_BY_ID, brandsOfCategory, SHOP_NAME_MAX, ZONE_BY_ID, isCategoryAvailable, licenseOf, type PersonaId } from "@coidle/shared";
import { Btn, Chip, Sheet } from "../components/ui";
import { gameDuration, money } from "../format";
import { categoryIcon, PERSONA_ICONS } from "../icons";
import { run, state } from "../store";

export function BuildSheet({ slotId, onClose }: { slotId: number; onClose: () => void }) {
  const s = state.value;
  const [name, setName] = useState("");
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
        const afford = s.funds >= c.buildCost + (lic?.fee ?? 0);
        const open = isCategoryAvailable(s, c.id);
        return (
          <div class="build-item" key={c.id}>
            <span class="b-ico">{categoryIcon(c.id)}</span>
            <div>
              <b>{c.name}</b> {have > 0 && <Chip tone="dim">已有 {have} 間</Chip>}
              <div class="small dim">
                客單價約 {money(c.refPrice)}・施工 {gameDuration(c.buildTicks + (lic?.extraTicks ?? 0))}
              </div>
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
                if (await run({ type: "buildShop", slot: slotId, category: c.id, ...(name.trim() ? { name: name.trim() } : {}) }, `開始興建「${name.trim() || c.name}」`)) onClose();
              }}
            >
              {open ? money(c.buildCost + (lic?.fee ?? 0)) : `Lv.${c.minLevel}`}
            </Btn>
          </div>
        );
      })}
    </Sheet>
  );
}
