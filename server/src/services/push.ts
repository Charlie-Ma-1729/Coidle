import * as webpush from "web-push";
import type { Config } from "../config";
import type { Repo } from "../db/repo";
import type { Notifier } from "./mallService";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** 實際送出一則推播。失敗時丟出帶 statusCode 的錯誤（404/410 代表訂閱已失效）。 */
export type PushSender = (target: PushTarget, payload: string) => Promise<void>;

const THROTTLE_MS = 10 * 60_000;

/**
 * 推播通道（伺服器端）。瀏覽器要等 Service Worker（M4）才收得到；
 * 在那之前，訂閱 API 與送出邏輯已就緒，通知也會以應用內橫幅呈現。
 */
export class PushService implements Notifier {
  private lastSent = new Map<number, number>();

  constructor(
    private readonly repo: Repo,
    private readonly config: Pick<Config, "vapidPublicKey" | "vapidPrivateKey" | "vapidSubject">,
    private readonly now: () => number = Date.now,
    private sender: PushSender | null = null,
  ) {
    if (!this.sender && config.vapidPublicKey && config.vapidPrivateKey) {
      webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
      this.sender = (t, payload) => webpush.sendNotification(t, payload, { TTL: 3600 }).then(() => undefined);
    }
  }

  get enabled(): boolean {
    return this.sender !== null;
  }

  get publicKey(): string | null {
    return this.config.vapidPublicKey;
  }

  /** 同一座商場 10 分鐘內最多通知一次，避免洗版 */
  notify(mallId: number, payload: { title: string; body: string }): void {
    if (!this.sender) return;
    const last = this.lastSent.get(mallId) ?? 0;
    if (this.now() - last < THROTTLE_MS) return;
    this.lastSent.set(mallId, this.now());
    const body = JSON.stringify({ title: payload.title, body: payload.body, mallId });
    for (const sub of this.repo.pushSubsForMall(mallId)) {
      this.sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body).catch((e: { statusCode?: number }) => {
        if (e.statusCode === 404 || e.statusCode === 410) this.repo.removePushSub(sub.endpoint);
      });
    }
  }
}
