import type { CategoryGroup, IngredientInfo, SlotKind } from "@coidle/shared";

// 研發素材的資料型別與建構小工具（recipes.ts 與各業態素材檔共用，避免循環引用）。

export type Unlock =
  | { t: "start" }
  /** 商場等級達到 */
  | { t: "level"; level: number }
  /** 這家供應商已經認識（含隱藏的新供應商），而且關係值達到 rel */
  | { t: "supplier"; id: string; rel?: number }
  /** 這位常客的故事解鎖到第幾段 */
  | { t: "regular"; id: string; stage: number }
  /** 對這家對手刺探過情報 */
  | { t: "rival"; id: string }
  /** 已經發現的配方達到幾道 */
  | { t: "discoveries"; n: number };

export interface IngredientData extends IngredientInfo {
  /** 自動命名時用的簡短詞 */
  word: string;
  /** 1–3：越高級，做出來的原創品質越好 */
  grade: 1 | 2 | 3;
  /** 隱藏特性：標籤 id → 強度 1–3 */
  tags: Record<string, number>;
  unlock: Unlock;
  /** 供哪些業態家族／業態使用（建構時用；最後會展開成公開的 `categories`） */
  fam?: string[];
}

export type Tags = Record<string, number>;

export const ing = (
  group: CategoryGroup,
  slot: SlotKind,
  id: string,
  name: string,
  icon: string,
  cost: number,
  grade: 1 | 2 | 3,
  tags: Tags,
  unlock: Unlock,
  desc: string,
  word = name,
): IngredientData => ({ id, group, slot, name, icon, cost, grade, tags, unlock, desc, word });

export const S: Unlock = { t: "start" };
export const L = (level: number): Unlock => ({ t: "level", level });
export const SUP = (id: string, rel?: number): Unlock => ({ t: "supplier", id, rel });
export const REG = (id: string, stage: number): Unlock => ({ t: "regular", id, stage });
export const RIV = (id: string): Unlock => ({ t: "rival", id });
export const DISC = (n: number): Unlock => ({ t: "discoveries", n });

/** 某個業態家族專用的素材建構器：`const noodle = forFam("food", "noodle"); noodle("base", id, name, …)` */
export function forFam(group: CategoryGroup, fam: string) {
  return (slot: SlotKind, id: string, name: string, icon: string, cost: number, grade: 1 | 2 | 3, tags: Tags, unlock: Unlock, desc: string, word = name): IngredientData => ({
    ...ing(group, slot, id, name, icon, cost, grade, tags, unlock, desc, word),
    fam: fam.split(" "),
  });
}
