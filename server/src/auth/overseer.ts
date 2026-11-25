import { randomBytes } from "node:crypto";
import type { Repo, UserRow } from "../db/repo";
import { hashPassword, verifyPassword } from "./password";

// Overseer（世界管理者）帳號：只能用「金鑰」登入。金鑰是 32 bytes 的隨機字串，
// 只在建立或更換時顯示一次，資料庫裡只存雜湊（和密碼同一套 scrypt）。

export const OVERSEER_USERNAME = "overseer";
/** 一般註冊不能用這些帳號名，避免有人搶先註冊 */
export const RESERVED_USERNAMES = ["overseer", "admin", "root", "system", "npc", "gm"];

export function newOverseerKey(): string {
  return `ovs_${randomBytes(32).toString("base64url")}`;
}

export async function createOverseer(repo: Repo, now: number, username = OVERSEER_USERNAME, displayName = "Overseer"): Promise<{ userId: number; key: string }> {
  if (repo.userByName(username)) throw new Error(`帳號「${username}」已經存在`);
  const key = newOverseerKey();
  const userId = repo.createOverseer(username, displayName, await hashPassword(key), now);
  return { userId, key };
}

export async function rotateOverseerKey(repo: Repo, username: string): Promise<{ userId: number; key: string }> {
  const u = repo.userByName(username);
  if (!u || u.role !== "overseer") throw new Error(`找不到 Overseer 帳號「${username}」`);
  const key = newOverseerKey();
  repo.setPassHash(u.id, await hashPassword(key));
  repo.deleteSessionsOfUser(u.id); // 換金鑰＝所有舊登入失效
  return { userId: u.id, key };
}

/** 用金鑰找到對應的 Overseer；找不到回傳 null。沒有任何 Overseer 時也跑一次雜湊，避免用回應時間猜有沒有 */
export async function overseerByKey(repo: Repo, key: string): Promise<UserRow | null> {
  const list = repo.overseers();
  if (list.length === 0) {
    await hashPassword(key);
    return null;
  }
  for (const u of list) if (await verifyPassword(key, u.pass_hash)) return u;
  return null;
}
