import type {
  ActivityEntry,
  EventDef,
  RegularDef,
  DirectoryEntry,
  SeasonResult,
  Command,
  MeResponse,
  MemberInfo,
  PublicMallState,
  RoleId,
  SpeedId,
} from "@coidle/shared";

export interface ClockPatch {
  speed?: SpeedId;
  paused?: boolean;
  pauseOnEvents?: boolean;
  idlePauseDays?: number | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "連不到伺服器，請檢查網路");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "發生錯誤");
  return data as T;
}

export interface WorldView {
  now: number;
  season: { index: number; start: number; end: number };
  entries: DirectoryEntry[];
  history: SeasonResult[];
}

export interface MallInfo {
  id: number;
  name: string;
  inviteCode?: string;
  members: MemberInfo[];
}

export const api = {
  me: () => request<MeResponse>("GET", "/api/me"),
  register: (username: string, password: string, displayName: string, signupSecret?: string) =>
    request<{ ok: true }>("POST", "/api/auth/register", { username, password, displayName, signupSecret }),
  login: (username: string, password: string) => request<{ ok: true }>("POST", "/api/auth/login", { username, password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  createMall: (name: string) => request<{ id: number; inviteCode: string }>("POST", "/api/malls", { name }),
  joinMall: (code: string, role?: RoleId) => request<{ id: number }>("POST", "/api/malls/join", { code, role }),
  world: () => request<WorldView>("GET", "/api/world"),
  contentEvents: () => request<{ events: EventDef[] }>("GET", "/api/content/events"),
  contentRegulars: () => request<{ regulars: RegularDef[] }>("GET", "/api/content/regulars"),
  mall: (id: number) => request<MallInfo>("GET", `/api/malls/${id}`),
  state: (id: number) => request<PublicMallState>("GET", `/api/malls/${id}/state`),
  activity: (id: number) => request<ActivityEntry[]>("GET", `/api/malls/${id}/activity?limit=40`),
  command: (id: number, command: Command) => request<PublicMallState>("POST", `/api/malls/${id}/commands`, { command }),
  clock: (id: number, patch: ClockPatch) => request<PublicMallState>("POST", `/api/malls/${id}/clock`, patch),
  setRole: (id: number, role: RoleId) => request<{ members: MemberInfo[] }>("POST", `/api/malls/${id}/role`, { role }),
  updateProfile: (displayName: string) => request<{ ok: true; displayName: string }>("POST", "/api/me/profile", { displayName }),
  changePassword: (current: string, next: string) => request<{ ok: true }>("POST", "/api/me/password", { current, next }),
  deleteAccount: (password: string) => request<{ ok: true }>("POST", "/api/me/delete", { password }),
  leaveMallServer: (id: number) => request<{ dissolved: boolean }>("POST", `/api/malls/${id}/leave`, {}),
  kickMember: (id: number, userId: number) => request<{ members: MemberInfo[] }>("POST", `/api/malls/${id}/members/${userId}/kick`, {}),
  transferOwner: (id: number, userId: number) => request<{ members: MemberInfo[] }>("POST", `/api/malls/${id}/transfer`, { userId }),
  renameMall: (id: number, name: string) => request<{ name: string }>("POST", `/api/malls/${id}/rename`, { name }),
  regenInvite: (id: number) => request<{ inviteCode: string }>("POST", `/api/malls/${id}/invite/regenerate`, {}),
};
