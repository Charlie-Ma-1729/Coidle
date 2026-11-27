import type { Graphics } from "pixi.js";
import type { Rng } from "../crowd";
import type { FacilitySpec } from "../facilityspec";

/**
 * 設施樓層的「地圖模組」：每種設施一個檔案（facility/parking.ts、cinema.ts …），
 * 由 facility/registry.ts 依 spec.kind 找到對應模組。模組只管自己的平面圖與人車模擬：
 * 純邏輯放在同名的 *.sim.ts（不依賴 Pixi，要有測試），這裡只做繪製。
 */

export interface FacilityClock {
  /** 遊戲分鐘（0–1439） */
  minute: number;
  open: number;
  close: number;
  /** 休息日（週末或假日） */
  weekend: boolean;
  /** 時間流速倍率：暫停 0，追趕加速時 >1 */
  flow: number;
}

/** 一張設施地圖：單位是邏輯像素，畫面端會整數放大 */
export interface FacilityView {
  size: { w: number; h: number };
  /** 畫一次的背景（地板、牆、座位、車格…） */
  drawStatic(g: Graphics): void;
  /** 每格更新模擬（dt 已乘流速，單位真實秒） */
  update(dt: number, clock: FacilityClock): void;
  /** 每格重畫的動態內容（人、車、亮起的銀幕…）；呼叫前已 clear */
  drawDynamic(g: Graphics, clock: FacilityClock): void;
}

export type FacilityFactory<S extends FacilitySpec = FacilitySpec> = (spec: S, rng: Rng, clock: FacilityClock) => FacilityView;
