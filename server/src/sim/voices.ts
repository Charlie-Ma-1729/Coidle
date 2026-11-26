import {
  CATEGORY_BY_ID,
  LIFE_EVENT_BY_ID,
  LIFE_GIFT_COST,
  REGULAR_BY_ID,
  VOICE_ADOPT,
  VOICE_AFFINITY,
  type MallState,
  type VoiceTopic,
} from "@coidle/shared";
import { applyIndexDelta } from "./events";
import { contribOf, gain, voicesOf } from "./regulars";
import { addLog } from "./state";
import { placeOrder } from "./step";

export type VoiceResult = { ok: true; note: string } | { ok: false; error: string };

const money = (n: number) => `¥${Math.round(n).toLocaleString("en-US")}`;

/** 回應熟客的一則話。issue 類：採納（有實際效果、花一點錢）或道謝；人生大事：送禮、致意、或沒有表示。 */
export function resolveVoice(s: MallState, uid: string, optionId: string): VoiceResult {
  const voices = voicesOf(s);
  const at = voices.findIndex((v) => v.uid === uid);
  const v = voices[at];
  if (!v) return { ok: false, error: "這件事已經處理過了" };
  const reg = s.regulars.find((r) => r.id === v.regularId);
  const def = REGULAR_BY_ID[v.regularId];
  if (!reg || !def) {
    voices.splice(at, 1);
    return { ok: false, error: "找不到這位熟客" };
  }
  const shop = s.shops.find((x) => x.id === v.shopId);
  const topic: VoiceTopic = v.topic;

  if (topic === "life") {
    const ev = LIFE_EVENT_BY_ID[v.detail ?? ""];
    if (optionId === "gift") {
      if (s.funds < LIFE_GIFT_COST) return { ok: false, error: "資金不足" };
      s.funds -= LIFE_GIFT_COST;
      s.today.purchases += LIFE_GIFT_COST;
      gain(s, reg, def, VOICE_AFFINITY.gift);
      voices.splice(at, 1);
      return { ok: true, note: `${ev?.giftLabel ?? "送上心意"}（${money(LIFE_GIFT_COST)}），「${def.name}」很感動。` };
    }
    if (optionId === "wish") {
      gain(s, reg, def, VOICE_AFFINITY.wish);
      voices.splice(at, 1);
      return { ok: true, note: `寫了張卡片致意，「${def.name}」收下了你的心意。` };
    }
    if (optionId === "skip") {
      gain(s, reg, def, VOICE_AFFINITY.skip);
      voices.splice(at, 1);
      return { ok: true, note: `沒有特別表示。「${def.name}」好像有點失落。` };
    }
    return { ok: false, error: "回應方式無效" };
  }

  if (optionId === "thanks") {
    gain(s, reg, def, VOICE_AFFINITY.thanks);
    voices.splice(at, 1);
    return { ok: true, note: `謝謝「${def.name}」的意見，記下來了。` };
  }
  if (optionId !== "adopt") return { ok: false, error: "回應方式無效" };

  const adopt = VOICE_ADOPT[topic];
  if (s.funds < adopt.cost) return { ok: false, error: "資金不足" };
  if (topic !== "wish" && !shop) return { ok: false, error: "那間店已經不在了" };
  s.funds -= adopt.cost;
  s.today.purchases += adopt.cost;
  let detail = "";
  switch (topic) {
    case "dirty":
      s.cleanliness = Math.min(100, s.cleanliness + 8);
      detail = "館內徹底打掃了一次。";
      break;
    case "stockout":
      if (shop) {
        const before = shop.incoming.reduce((a, b) => a + b.qty, 0);
        placeOrder(s, shop, 100);
        detail = shop.incoming.reduce((a, b) => a + b.qty, 0) > before ? "已緊急追加進貨。" : "想追加進貨，但供應商一時湊不出貨。";
      }
      break;
    case "price": {
      const cat = shop ? CATEGORY_BY_ID[shop.category] : undefined;
      if (shop && cat) {
        const cap = Math.round(cat.refPrice * 1.1);
        if (shop.price > cap) shop.price = cap;
        detail = `標價調回 ${money(shop.price)}。`;
      }
      break;
    }
    case "queue":
      applyIndexDelta(s, "localRep", 0.1);
      detail = "尖峰時段加派了人手。";
      break;
    case "stale":
      if (shop) shop.freshness = Math.min(100, shop.freshness + 10);
      detail = "菜單與擺設小改版。";
      break;
    case "wish":
      if (!reg.knowsPrefs) reg.knowsPrefs = true;
      detail = "寫進了小本子，也順便記住了他的喜好。";
      break;
  }
  gain(s, reg, def, VOICE_AFFINITY.adopt);
  contribOf(reg).feedback++;
  voices.splice(at, 1);
  addLog(s, "info", `🏮 採納了「${def.name}」的意見：${adopt.label}${adopt.cost ? `（${money(adopt.cost)}）` : ""}。${detail}`);
  return { ok: true, note: `${adopt.label}。${detail}` };
}
