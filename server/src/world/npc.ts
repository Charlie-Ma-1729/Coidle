import { NPC_BY_ID, npcEntries, npcEntry, type DirectoryEntry, type NpcOverride } from "@coidle/shared";
import type { Repo } from "../db/repo";

// NPC 商場的設定：Overseer 的調整（覆寫）與自動出手的開關／頻率。
// NPC 本身仍是時間的純函式（見 shared 的 npcEntry），這裡只負責把「調整」疊上去。

const TTL_MS = 2_000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** 把外面送來的覆寫整理成安全的樣子：只收認得的欄位、數值夾限；全空回傳 null */
export function normalizeOverride(raw: unknown): NpcOverride | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: NpcOverride = {};
  if (typeof r.name === "string" && r.name.trim()) out.name = r.name.trim().slice(0, 30);
  const level = num(r.levelDelta);
  if (level !== undefined && level !== 0) out.levelDelta = clamp(Math.round(level), -7, 7);
  const sm = num(r.scoreMult);
  if (sm !== undefined && sm !== 1) out.scoreMult = clamp(sm, 0.3, 3);
  const rm = num(r.revenueMult);
  if (rm !== undefined && rm !== 1) out.revenueMult = clamp(rm, 0.1, 5);
  const rep = num(r.repDelta);
  if (rep !== undefined && rep !== 0) out.repDelta = clamp(rep, -50, 50);
  const heat = num(r.heatDelta);
  if (heat !== undefined && heat !== 0) out.heatDelta = clamp(heat, -50, 50);
  if (r.hidden === true) out.hidden = true;
  const act = num(r.activity);
  if (act !== undefined && act !== 1) out.activity = clamp(act, 0, 5);
  return Object.keys(out).length > 0 ? out : null;
}

export class NpcService {
  private cache: { at: number; map: Record<string, NpcOverride> } | null = null;

  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
  ) {}

  /** 目前有效的覆寫（過期的不算） */
  overrides(): Record<string, NpcOverride> {
    const t = this.now();
    if (this.cache && t - this.cache.at < TTL_MS && t >= this.cache.at) return this.cache.map;
    const map: Record<string, NpcOverride> = {};
    for (const r of this.repo.npcOverrideRows()) {
      if (r.expires_at > 0 && r.expires_at <= t) continue;
      if (!NPC_BY_ID[r.npc_id]) continue;
      const ov = normalizeOverride(JSON.parse(r.json));
      if (ov) map[r.npc_id] = ov;
    }
    this.cache = { at: t, map };
    return map;
  }

  /** 覆寫（含到期時間）的完整列表，給管理畫面用 */
  overrideRows(): { npcId: string; override: NpcOverride; expiresAt: number }[] {
    return this.repo.npcOverrideRows().flatMap((r) => {
      const ov = normalizeOverride(JSON.parse(r.json));
      return ov ? [{ npcId: r.npc_id, override: ov, expiresAt: r.expires_at }] : [];
    });
  }

  set(npcId: string, raw: unknown, expiresAt = 0): NpcOverride | null {
    if (!NPC_BY_ID[npcId]) throw new Error("找不到這座 NPC 商場");
    const ov = normalizeOverride(raw);
    if (!ov) this.repo.clearNpcOverride(npcId);
    else this.repo.setNpcOverride(npcId, JSON.stringify(ov), expiresAt, this.now());
    this.cache = null;
    return ov;
  }

  clear(npcId: string): void {
    this.repo.clearNpcOverride(npcId);
    this.cache = null;
  }

  /** 目前最頂尖真人商場的綜合分數（由 WorldService 提供）；NPC 以此為追趕目標 */
  pace: () => number = () => 0;

  entries(at = this.now()): DirectoryEntry[] {
    return npcEntries(at, this.overrides(), this.pace());
  }

  /** 包含被隱藏的（管理畫面要看得到） */
  entryAny(npcId: string, at = this.now()): DirectoryEntry | null {
    const def = NPC_BY_ID[npcId];
    return def ? npcEntry(def, at, this.overrides()[npcId], this.pace()) : null;
  }

  isHidden(npcId: string): boolean {
    return this.overrides()[npcId]?.hidden === true;
  }

  // ── 自動出手的全域設定（存在 meta）
  auto(): boolean {
    return this.repo.getMeta("npc_auto") !== "0";
  }
  setAuto(on: boolean): void {
    this.repo.setMeta("npc_auto", on ? "1" : "0");
  }
  /** 全域頻率倍率：0 ＝ 都不出手；1 ＝ 預設；最多 5 */
  activity(): number {
    const v = Number(this.repo.getMeta("npc_activity") ?? 1);
    return Number.isFinite(v) ? clamp(v, 0, 5) : 1;
  }
  setActivity(v: number): void {
    this.repo.setMeta("npc_activity", String(clamp(v, 0, 5)));
  }
}
