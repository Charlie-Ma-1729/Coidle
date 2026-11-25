import type { ServerMessage, PublicMallState } from "@coidle/shared";
import { activity, mallInfo, online, state, user } from "./store";

let socket: WebSocket | null = null;
let currentMall: number | null = null;
let currentSpectate = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function url(id: number): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws?mall=${id}${currentSpectate ? "&spectate=1" : ""}`;
}

function open(id: number): void {
  const ws = new WebSocket(url(id));
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    online.value = true;
  };
  ws.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.mallId !== currentMall) return;
    if (msg.type === "state") state.value = msg.state as PublicMallState;
    else if (msg.type === "activity") activity.value = [msg.entry, ...activity.value].slice(0, 60);
    else if (msg.type === "members" && mallInfo.value) mallInfo.value = { ...mallInfo.value, members: msg.members };
  };
  ws.onclose = (ev) => {
    online.value = false;
    if (socket !== ws) return;
    socket = null;
    if (ev.code === 4401) {
      user.value = null; // 登入失效
      return;
    }
    if (ev.code === 4403 || currentMall === null) return;
    const delay = Math.min(15_000, 1000 * 2 ** retry++);
    timer = setTimeout(() => currentMall !== null && open(currentMall), delay);
  };
  ws.onerror = () => ws.close();
}

export function connectMall(id: number, spectate = false): void {
  disconnectMall();
  currentMall = id;
  currentSpectate = spectate;
  open(id);
}

export function disconnectMall(): void {
  currentMall = null;
  if (timer) clearTimeout(timer);
  timer = null;
  const ws = socket;
  socket = null;
  online.value = false;
  ws?.close();
}

// 回到前景時要一份最新快照（手機切回 App 很常見）
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || currentMall === null) return;
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "sync" }));
  else if (!socket) {
    if (timer) clearTimeout(timer);
    open(currentMall);
  }
});
