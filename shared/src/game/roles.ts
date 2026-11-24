/** 團隊職位（M2 先當標籤；之後對應領域可有小加成與優先設定權） */
export const ROLES = [
  { id: "gm", name: "總經理" },
  { id: "leasing", name: "招商長" },
  { id: "ops", name: "營運長" },
  { id: "dining", name: "餐飲部長" },
  { id: "marketing", name: "行銷長" },
  { id: "finance", name: "財務／採購長" },
  { id: "tech", name: "科技長" },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];
export const ROLE_IDS: string[] = ROLES.map((r) => r.id);

export interface MemberInfo {
  userId: number;
  displayName: string;
  role: RoleId;
  isOwner: boolean;
  joinedAt: number;
}

export interface MallSummary {
  id: number;
  name: string;
  role: RoleId;
  isOwner: boolean;
}

export interface ActivityEntry {
  id: number;
  ts: number;
  actor: string;
  text: string;
}

export interface MeResponse {
  user: { id: number; username: string; displayName: string };
  malls: MallSummary[];
}

/** WebSocket 伺服器 → 用戶端的訊息 */
export type ServerMessage =
  | { type: "state"; mallId: number; state: unknown }
  | { type: "activity"; mallId: number; entry: ActivityEntry }
  | { type: "members"; mallId: number; members: MemberInfo[] };
