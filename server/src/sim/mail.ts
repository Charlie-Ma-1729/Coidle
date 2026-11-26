import { ALLIANCE_MAX_ACTIVE, EVENT_BY_ID, JOINT_PROMO_MULT, JOINT_PROMO_TICKS, SHOCK_KINDS, SUPPLIER_BY_ID, TICKS_PER_DAY, WEATHER_NAMES, supplierState, type MallState, type ShockKind } from "@coidle/shared";
import { applyEffects, applyIndexDelta, spawnEvent } from "./events";
import { createRng, hash32 } from "./rng";
import { addLog } from "./state";

// 跨商場的信件：伺服器層把「寄給這座商場、已到期」的信交給商場，由這裡轉成這座商場自己的變化。
// 信件的內容全部經過伺服器驗證與夾限；模擬本身不知道對方是誰、也讀不到對方的狀態。

export interface Mail {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
}

const MAX_NOTICES = 20;
const num = (v: unknown, lo: number, hi: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const str = (v: unknown, max = 120): string => (typeof v === "string" ? v.slice(0, max) : "");

function notice(s: MallState, text: string, extra?: { from?: string; persona?: string }): void {
  s.world.notices.unshift({ tick: s.tick, text, ...extra });
  if (s.world.notices.length > MAX_NOTICES) s.world.notices.length = MAX_NOTICES;
  if (s.today.systemNotes.length < 8) s.today.systemNotes.push(text);
  addLog(s, "info", `🌐 ${text}`);
}

/** 把一封信套用到商場。不認得的種類一律忽略（只算收過一封）。 */
export function applyMail(s: MallState, mail: Mail): void {
  s.world.mailCount += 1;
  const p = mail.payload;
  switch (mail.kind) {
    case "season_reward": {
      const funds = Math.round(num(p.funds, 0, 50_000_000));
      const rank = Math.round(num(p.rank, 1, 999));
      const of = Math.round(num(p.of, 1, 999));
      const season = Math.round(num(p.season, 0, 9999));
      const title = str(p.title, 20) || "參賽商場";
      s.funds += funds;
      s.world.seasons.unshift({ season, rank, of, title, reward: funds });
      if (s.world.seasons.length > 12) s.world.seasons.length = 12;
      notice(s, `第 ${season + 1} 季結算：在 ${of} 座商場中名列第 ${rank}，獲得「${title}」與獎金 ¥${funds.toLocaleString("en-US")}。`);
      break;
    }
    case "notice":
      notice(s, str(p.text));
      break;
    // Overseer 調整天氣：用現有的 weather 效果（會取代原本的天氣修飾值）
    case "admin_weather": {
      const kind = str(p.kind, 10);
      if (!["clear", "cloudy", "rain", "storm"].includes(kind)) break;
      const temp = Math.round(num(p.temp, -10, 42));
      const ticks = Math.round(num(p.ticks, 12, 864));
      const rng = createRng(hash32(s.seed ^ 0x57ea, s.tick));
      applyEffects(s, [{ t: "weather", kind: kind as never, temp, ticks }], rng);
      notice(s, `天氣有了變化：${WEATHER_NAMES[kind as never] ?? kind}，氣溫約 ${temp}°C，預計持續 ${Math.round(ticks / 12)} 小時。`);
      break;
    }
    // Overseer 觸發一個事件（內建、AI 或手寫的都可以）
    case "admin_event": {
      const def = EVENT_BY_ID[str(p.eventId, 60)];
      if (!def) break;
      const rng = createRng(hash32(s.seed ^ 0x3e11, s.tick));
      spawnEvent(s, def, rng);
      break;
    }
    // Overseer 對某家供應商手動加一段衝擊（取代該供應商目前的衝擊；到期自然結束）
    case "admin_supply_shock": {
      const def = SUPPLIER_BY_ID[str(p.supplierId, 40)];
      const kind = str(p.kind, 20) as ShockKind;
      const st = def ? supplierState(s, def.id) : undefined;
      if (!def || !st || !(kind in SHOCK_KINDS)) break;
      const days = Math.round(num(p.days, 1, 10)) || 3;
      const k = SHOCK_KINDS[kind];
      const fill = num(p.fill, 0, 1);
      st.shock = { id: `admin:${mail.id}`, kind, warnTick: s.tick, startTick: s.tick, endTick: s.tick + days * TICKS_PER_DAY, fill, ...(k.price ? { priceMult: k.price[0] } : {}) };
      st.lastShockId = st.shock.id;
      notice(s, `${k.icon}「${def.name}」${k.startText}（預計 ${days} 天）。`);
      break;
    }
    case "poach_hit":
    case "poach_gain": {
      const persona = str(p.persona, 12);
      const known = ["tourist", "local", "commuter", "family", "student", "couple"];
      if (!known.includes(persona)) break;
      const hit = mail.kind === "poach_hit";
      const mult = hit ? Math.min(1, Math.max(0.85, num(p.mult, 0, 2) || 0.9)) : Math.min(1.2, Math.max(1, num(p.mult, 0, 2) || 1.15));
      const ticks = Math.round(Math.min(288, Math.max(12, num(p.ticks, 0, 1000) || 144)));
      const rng = createRng(hash32(s.seed ^ 0x90ac, s.tick));
      applyEffects(s, [{ t: "traffic", persona: persona as never, mult, ticks }], rng);
      const who = str(p.who, 30) || "對面的商場";
      const from = hit && /^m:\d{1,9}$/.test(str(p.key, 12)) ? str(p.key, 12) : undefined; // 對方的名錄 key：只收真人商場的格式
      notice(s, hit ? `「${who}」辦了針對特定客群的促銷，把我們一部分客人搶走了（暫時的）。` : `針對「${who}」的搶客促銷上線，這一類客人往我們這邊靠過來了。`, hit && from ? { from, persona } : undefined);
      break;
    }
    case "funds_gift": {
      const amount = Math.round(num(p.amount, 0, 20_000_000));
      s.funds += amount;
      s.today.purchases -= 0;
      notice(s, `收到「${str(p.from, 30) || "友好商場"}」送來的資金 ¥${amount.toLocaleString("en-US")}，雪中送炭。`);
      break;
    }
    case "goods": {
      const qty = Math.round(num(p.qty, 0, 2000));
      const category = str(p.category, 30);
      const from = str(p.from, 30) || "友好商場";
      const targets = s.shops.filter((x) => x.category === category && x.mode === "direct" && x.tenant === null);
      const shop = targets.sort((a, b) => a.stock - b.stock)[0];
      if (!shop || qty <= 0) {
        notice(s, `「${from}」送來的貨沒有地方放（找不到同業態的直營店），貨被退回了。`);
        break;
      }
      const wasOut = shop.stock < 1;
      shop.stock += qty;
      notice(s, `收到「${from}」送來的 ${qty} 份貨，補進了「${shop.name}」${wasOut ? "——正好解了缺貨的燃眉之急" : ""}。`);
      if (wasOut) applyIndexDelta(s, "localRep", 0.2);
      break;
    }
    case "alliance_start": {
      const id = Math.round(num(p.id, 0, 1e9));
      const partner = str(p.partner, 30) || "友好商場";
      const days = Math.round(num(p.days, 1, 90)) || 28;
      s.world.alliances = s.world.alliances.filter((a) => a.endTick > s.tick && a.id !== id);
      if (s.world.alliances.length >= ALLIANCE_MAX_ACTIVE) break; // 名額滿了（伺服器已先擋過，這裡是保險）
      s.world.alliances.push({ id, partner, endTick: s.tick + days * TICKS_PER_DAY });
      notice(s, `和「${partner}」的聯名協議開始了：雙方互相導客，客流小幅增加。`);
      break;
    }
    case "alliance_end": {
      const id = Math.round(num(p.id, 0, 1e9));
      const had = s.world.alliances.find((a) => a.id === id);
      s.world.alliances = s.world.alliances.filter((a) => a.id !== id);
      if (had) notice(s, str(p.text, 80) || `和「${had.partner}」的聯名協議結束了。`);
      break;
    }
    case "joint_promo": {
      const partner = str(p.partner, 30) || "友好商場";
      const rng = createRng(hash32(s.seed ^ 0x701a, s.tick));
      applyEffects(
        s,
        [
          { t: "traffic", persona: "all", mult: JOINT_PROMO_MULT, ticks: JOINT_PROMO_TICKS },
          { t: "index", which: "localRep", amount: 0.4 },
          { t: "index", which: "touristHeat", amount: 0.4 },
        ],
        rng,
      );
      notice(s, `和「${partner}」的聯名活動開跑，兩邊的客人都變多了。`);
      break;
    }
    default:
      break;
  }
}
