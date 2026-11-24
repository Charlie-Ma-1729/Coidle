import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { userFromRequest } from "./auth";
import type { Deps } from "./routes";

/**
 * 即時推播：用戶端連 /ws?mall=ID，伺服器在狀態、動態、成員變動時推送。
 * 玩家的操作仍走 REST（POST /commands），WebSocket 只負責「看」。
 */
export function registerWs(app: FastifyInstance, deps: Deps): void {
  const { config, repo, service, now } = deps;
  const rooms = new Map<number, Set<WebSocket>>();

  service.subscribe((mallId, msg) => {
    const room = rooms.get(mallId);
    if (!room || room.size === 0) return;
    const data = JSON.stringify(msg);
    for (const ws of room) if (ws.readyState === ws.OPEN) ws.send(data);
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
    const mallId = Number((req.query as { mall?: string }).mall);
    if (!Number.isInteger(mallId) || !repo.member(mallId, user.id)) return fail(4403, "forbidden");

    let room = rooms.get(mallId);
    if (!room) rooms.set(mallId, (room = new Set()));
    room.add(socket);
    service.addConnection(mallId, 1); // 有人在場：重要事件不必暫停時鐘

    // 連上線先給一份最新狀態（同時算「有在照顧」）；用戶端之後也可送 {"type":"sync"} 重新取得
    const sendSnapshot = () => {
      socket.send(JSON.stringify({ type: "state", mallId, state: service.getState(mallId, true) }));
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
    }, 30_000);

    socket.on("close", () => {
      clearInterval(heartbeat);
      service.addConnection(mallId, -1);
      room.delete(socket);
      if (room.size === 0) rooms.delete(mallId);
    });
    socket.on("error", () => socket.terminate());
    });
  });
}
