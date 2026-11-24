import type { MallState } from "@coidle/shared";
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

function notice(s: MallState, text: string): void {
  s.world.notices.unshift({ tick: s.tick, text });
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
    default:
      break;
  }
}
