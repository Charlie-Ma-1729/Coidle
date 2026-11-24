import {
  NPC_MALLS,
  SEASON_MIN_AGE_MS,
  SEASON_PARTICIPATION,
  SEASON_REWARDS,
  npcEntries,
  npcEntry,
  rankEntries,
  seasonAt,
  seasonRange,
  seasonRewardFunds,
  type DirectoryEntry,
  type SeasonResult,
  type SeasonResultRow,
} from "@coidle/shared";
import type { Repo } from "../db/repo";

// 世界服務：公開名錄（真人商場＋NPC 商場）、排行榜、賽季結算。
// 名錄只有「公開欄位」，永遠拿不到別人的完整狀態。

export interface WorldView {
  now: number;
  season: { index: number; start: number; end: number };
  entries: DirectoryEntry[];
  /** 最近幾季的結果 */
  history: SeasonResult[];
}

export class WorldService {
  constructor(
    private readonly repo: Repo,
    private readonly now: () => number,
  ) {}

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
      updatedAt: r.updated_at,
    }));
  }

  entries(at = this.now()): DirectoryEntry[] {
    return [...this.playerEntries(), ...npcEntries(at)];
  }

  view(): WorldView {
    const now = this.now();
    const idx = seasonAt(now);
    const r = seasonRange(idx);
    return {
      now,
      season: { index: idx, start: r.start, end: r.end },
      entries: this.entries(now),
      history: this.repo.latestSeasons(3).map((x) => JSON.parse(x.result_json) as SeasonResult),
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
        ...NPC_MALLS.map((n) => {
          const e = npcEntry(n, end);
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
      rows.forEach((row, i) => {
        if (row.kind !== "player" || !row.eligible || row.mallId === undefined) return;
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

  /** 前幾名的名次（含 NPC），方便畫面標示「你現在第幾名」 */
  rankOf(key: string, board: "score" | "revenue" | "rep" = "score"): number {
    return rankEntries(this.entries(), board).findIndex((e) => e.key === key) + 1;
  }
}
