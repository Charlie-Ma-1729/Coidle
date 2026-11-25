import { afterEach, describe, expect, it } from "vitest";
import { LEVELS, TECHS, WORLD_EPOCH_MS, ZONES, leaseEnabled, isZoneUnlocked } from "@coidle/shared";
import { buildApp } from "./app";

const opened: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.app.close();
});

describe("管理指令：全開測試商場", () => {
  it("替使用者開一座最高等級、全區域、全科技的商場，之後仍能正常推進與操作", async () => {
    const b = buildApp({ config: { dbPath: ":memory:" }, now: () => WORLD_EPOCH_MS + 86_400_000 });
    opened.push(b);
    const r = await b.app.inject({ method: "POST", url: "/api/auth/register", payload: { username: "charlie", password: "password123", displayName: "CharlieMa" } });
    expect(r.statusCode).toBe(200);
    const u = b.repo.userByName("charlie")!;
    const { mallId } = b.service.adminCreateTestMall(u.id, "測試全開商場");
    const s = b.service.sync(mallId);
    expect(s.level).toBe(LEVELS.length);
    expect(s.funds).toBeGreaterThanOrEqual(100_000_000);
    expect(s.tech.done.length).toBe(TECHS.length);
    for (const z of ZONES) expect(isZoneUnlocked(s, z.id)).toBe(true);
    expect(leaseEnabled(s)).toBe(true);
    expect(b.repo.mallsOfUser(u.id).map((m) => m.name)).toContain("測試全開商場");
    // 重新從資料庫載入也一樣（不是只存在快取裡）
    const raw = JSON.parse(b.repo.loadState(mallId)!);
    expect(raw.level).toBe(LEVELS.length);
    expect(raw.tech.done.length).toBe(TECHS.length);
  });
});
