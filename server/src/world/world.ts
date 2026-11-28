import {
  COMPETE_SHIELD_MS,
  NPC_MALLS,
  SEASON_MIN_AGE_MS,
  SEASON_ONE_REWARD_PER_PLAYER,
  SEASON_PARTICIPATION,
  SEASON_REWARDS,
  internalKey,
  npcEntry,
  publicKey,
  rankEntries,
  seasonAt,
  seasonRange,
  seasonRewardFunds,
  type DirectoryEntry,
  type SeasonResult,
  type SeasonResultRow,
} from "@coidle/shared";
import type { Repo } from "../db/repo";
import { NpcService } from "./npc";

// 世界服務：公開名錄（真人商場＋NPC 商場）、排行榜、賽季結算。
// 名錄只有「公開欄位」，永遠拿不到別人的完整狀態。

export interface WorldView {
  now: number;
  season: { index: number; start: number; end: number };
  entries: DirectoryEntry[];
  /** 最近幾季的結果 */
  history: SeasonResult[];
  /** 暫時受保護、不能被搶客的商場 → 保護到什麼時候 */
  shields: Record<string, number>;
}

export class WorldService {
  /** NPC 商場的調整與自動出手設定 */
  readonly npc: NpcService;

  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
  ) {
    this.npc = new NpcService(repo, now);
    let cache: { at: number; v: number } | null = null;
    this.npc.pace = () => {
      const t = now();
      if (cache && t - cache.at < 5_000 && t >= cache.at) return cache.v;
      const v = this.repo.directoryRows().reduce((m, r) => Math.max(m, r.score), 0);
      cache = { at: t, v };
      return v;
    };
  }

  /** 對外代號（或內部代號）→ 內部代號；NPC 對外長得和真人商場一樣（"m:9000+"） */
  resolve(key: string): string {
    return internalKey(key);
  }

  /** 真人商場在名錄裡的資料（從資料庫讀，所有商場都定時被推進，所以不會太舊） */
  playerEntries(): DirectoryEntry[] {
    return this.repo.directoryRows().map((r) => ({
      key: `m:${r.mall_id}`,
      kind: "player" as const,
      name: r.name,
      tagline: "",
      level: r.level,
      stars: r.stars,
      score: r.score,
      localRep: r.local_rep,
      touristHeat: r.tourist_heat,
      revenue30: r.revenue30,
      shops: r.shops,
      topCategory: r.top_category,
      stockouts: r.stockouts,
      stockoutCats: r.stockout_cats ? r.stockout_cats.split(",") : [],
      updatedAt: r.updated_at,
    }));
  }

  /** 內部用：含 NPC 的完整名錄（NPC 的代號是 "n:…"，kind 是 "npc"） */
  entries(at = this.now()): DirectoryEntry[] {
    return [...this.playerEntries(), ...this.npc.entries(at)];
  }

  /** 給玩家看的名錄：NPC 與真人商場完全一樣——沒有類型標示、沒有 NPC 專屬的口號，代號也看不出來 */
  publicEntries(at = this.now()): DirectoryEntry[] {
    return this.entries(at).map((e) => ({ ...e, key: publicKey(e.key), kind: "player" as const, tagline: "" }));
  }

  view(): WorldView {
    const now = this.now();
    const idx = seasonAt(now);
    const r = seasonRange(idx);
    const shields: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.shields(now))) shields[publicKey(k)] = v;
    return {
      now,
      season: { index: idx, start: r.start, end: r.end },
      entries: this.publicEntries(now),
      history: this.repo.latestSeasons(3).map((x) => {
        const res = JSON.parse(x.result_json) as SeasonResult;
        return { ...res, ranking: res.ranking.map((row) => ({ ...row, key: publicKey(row.key), kind: "player" as const })) };
      }),
      shields,
    };
  }

  /**
   * 賽季結算：每過一季，用目前的名錄排名，把名次獎勵寄到各真人商場的信箱。
   * 伺服器停機很久時，一次補結算最近幾季（最多 3 季）；NPC 會上榜、不領獎。
   */
  settleSeasons(): SeasonResult[] {
    const now = this.now();
    const current = seasonAt(now);
    const done: SeasonResult[] = [];
    for (let season = Math.max(0, current - 3); season < current; season++) {
      if (this.repo.seasonResult(season) !== null) continue;
      const { start, end } = seasonRange(season);
      const players = this.repo.directoryRows();
      const rows: (SeasonResultRow & { mallId?: number; eligible: boolean; revenue30: number })[] = [
        ...players.map((p) => ({
          key: `m:${p.mall_id}`,
          kind: "player" as const,
          name: p.name,
          score: p.score,
          level: p.level,
          mallId: p.mall_id,
          revenue30: p.revenue30,
          eligible: p.created_at <= end - SEASON_MIN_AGE_MS && p.revenue30 > 0,
        })),
        ...NPC_MALLS.filter((n) => !this.npc.overrides()[n.id]?.hidden).map((n) => {
          const e = npcEntry(n, end, this.npc.overrides()[n.id], this.npc.pace());
          return { key: e.key, kind: "npc" as const, name: e.name, score: e.score, level: e.level, revenue30: e.revenue30, eligible: false };
        }),
      ];
      rows.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
      const result: SeasonResult = {
        season,
        start,
        end,
        ranking: rows.map(({ key, kind, name, score, level }) => ({ key, kind, name, score, level })),
      };
      // 先把「這一季已結算」寫進去（INSERT OR IGNORE），確保不會重複發獎
      if (!this.repo.saveSeason(season, now, JSON.stringify(result))) continue;
      // 同一位玩家一季只領一份獎金：名次高的那座領，同一位玩家的其他商場照樣列在榜上、但不再領獎
      const paid = new Set<number>();
      rows.forEach((row, i) => {
        if (row.kind !== "player" || !row.eligible || row.mallId === undefined) return;
        const owners = this.repo.members(row.mallId).map((m) => m.userId);
        if (SEASON_ONE_REWARD_PER_PLAYER && owners.some((u) => paid.has(u))) return;
        for (const u of owners) paid.add(u);
        const reward = SEASON_REWARDS[i] ?? SEASON_PARTICIPATION;
        this.repo.addMail(
          row.mallId,
          "season_reward",
          { season, rank: i + 1, of: rows.length, title: reward.title, funds: seasonRewardFunds(reward.base, row.level) },
          now,
          now,
        );
      });
      done.push(result);
    }
    return done;
  }

  /** 被打到之後的保護期（所有人都看得到，免得白白出手被擋） */
  shields(at = this.now()): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.repo.recentAttackTargets(at - COMPETE_SHIELD_MS)) out[r.target_key] = r.last + COMPETE_SHIELD_MS;
    return out;
  }

  /** 前幾名的名次（含 NPC），方便畫面標示「你現在第幾名」 */
  rankOf(key: string, board: "score" | "revenue" | "rep" = "score"): number {
    return rankEntries(this.entries(), board).findIndex((e) => e.key === key) + 1;
  }
}
