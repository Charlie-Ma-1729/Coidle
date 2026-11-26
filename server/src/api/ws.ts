import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { userFromRequest } from "./auth";
import type { Deps } from "./routes";

/**
 * 即時推播：用戶端連 /ws?mall=ID，伺服器在狀態、動態、成員變動時推送。
 * 玩家的操作仍走 REST（POST /commands），WebSocket 只負責「看」。
 */
export function registerWs(app: FastifyInstance, deps: Deps): void {
  const { config, repo, service, now, metrics } = deps;
  const rooms = new Map<number, Set<WebSocket>>();

  service.subscribe((mallId, msg) => {
    const room = rooms.get(mallId);
    if (!room || room.size === 0) return;
    const data = JSON.stringify(msg);
    // 對方剛好斷線時 send 會非同步丟錯（例如 ERR_INVALID_STATE）；吞掉就好，斷線的清理由 close 事件處理
    for (const ws of room) if (ws.readyState === ws.OPEN) ws.send(data, () => {});
  });

  // 必須在 @fastify/websocket 載入「之後」才註冊路由，否則會被當成一般 HTTP 路由
  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket, req) => {
    const fail = (code: number, reason: string) => socket.close(code, reason);

    if (config.production) {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return fail(4403, "origin");
    }
    const user = userFromRequest(req, repo, now());
    if (!user) return fail(4401, "unauthorized");
    const q = req.query as { mall?: string; spectate?: string };
    const mallId = Number(q.mall);
    // Overseer 可以「旁觀」任何商場：只收不發，不算在場（不影響自動暫停），也不算線上玩家
    const spectate = q.spectate === "1" && user.role === "overseer";
    if (!Number.isInteger(mallId)) return fail(4403, "forbidden");
    if (spectate ? !repo.mallById(mallId) : !repo.member(mallId, user.id)) return fail(4403, "forbidden");

    let room = rooms.get(mallId);
    if (!room) rooms.set(mallId, (room = new Set()));
    room.add(socket);
    if (!spectate) {
      service.addConnection(mallId, 1); // 有人在場：重要事件不必暫停時鐘
      if (user.role === "player") metrics.socketOpen(user.id);
      service.memberConnected(mallId, user.id); // 記下「這座商場」的在場時間，同場夥伴看得到
    }

    // 連上線先給一份最新狀態（同時算「有在照顧」）；用戶端之後也可送 {"type":"sync"} 重新取得
    const sendSnapshot = () => {
      socket.send(JSON.stringify({ type: "state", mallId, state: service.getState(mallId, !spectate) }));
      socket.send(JSON.stringify({ type: "members", mallId, members: service.members(mallId) }));
    };
    sendSnapshot();
    socket.on("message", (raw: unknown) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "sync") sendSnapshot();
      } catch {
        // 忽略無法解析的訊息
      }
    });

    let alive = true;
    socket.on("pong", () => (alive = true));
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
      if (!spectate) service.memberBeat(mallId, user.id);
    }, 30_000);

    socket.on("close", () => {
      clearInterval(heartbeat);
      room.delete(socket); // 先離開房間，再通知其他人「某某離開了」，才不會把訊息送給正在關閉的這條連線
      if (room.size === 0) rooms.delete(mallId);
      if (!spectate) {
        service.addConnection(mallId, -1);
        if (user.role === "player") metrics.socketClose(user.id);
        service.memberDisconnected(mallId, user.id);
      }
    });
    socket.on("error", () => socket.terminate());
    });
  });
}
