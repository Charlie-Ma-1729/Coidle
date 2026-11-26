import { dayLedger, guestTodoCount, hoursRangeLabel, type PublicMallState } from "@coidle/shared";
import { money, moneyShort } from "../../format";
import type { HubId } from "../../stage/model";

export interface Pill {
  label: string;
  value: string;
}

/** 每個樞紐視窗頂部的摘要（1–3 個數字）：一眼看到這個領域的狀況 */
export function hubSummary(s: PublicMallState, hub: HubId): Pill[] {
  switch (hub) {
    case "operate":
      return [
        { label: "營業", value: hoursRangeLabel(s.hours.open, s.hours.close) },
        { label: "整潔", value: `${Math.round(s.cleanliness)}%` },
        { label: "設備", value: `${Math.round(s.equipment)}%` },
      ];
    case "guests": {
      const met = s.regulars.filter((r) => r.met).length;
      const pills: Pill[] = [{ label: "待處理", value: String(guestTodoCount(s)) }];
      if (met > 0) pills.push({ label: "常客", value: String(met) });
      return pills;
    }
    case "develop": {
      const pills: Pill[] = [{ label: "研發中", value: String(s.workshop.jobs.length) }];
      if (s.tech.jobs.length > 0 || s.tech.done.length > 0) pills.push({ label: "科技", value: `${s.tech.done.length} 項完成` });
      if (s.leasing.candidates.length > 0) pills.push({ label: "洽談中", value: String(s.leasing.candidates.length) });
      return pills;
    }
    case "finance": {
      const profit = dayLedger(s.today).operating;
      return [
        { label: "資金", value: moneyShort(s.funds) },
        { label: "今日損益", value: `${profit >= 0 ? "+" : ""}${moneyShort(profit)}` },
        ...(s.tax.bills.length > 0 ? [{ label: "待繳", value: money(s.tax.bills.reduce((a, b) => a + Math.max(0, b.amount - b.paid + b.lateFee), 0)) }] : []),
      ];
    }
    case "world": {
      const pills: Pill[] = [{ label: "聯名協議", value: String(s.world.alliances.length) }];
      return pills;
    }
  }
}
