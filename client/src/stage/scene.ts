// 伺服器的 CSP 是 script-src 'self'（不允許 eval）。Pixi 預設會用 new Function 產生著色器同步程式，
// 在正式環境會直接壞掉（畫面全黑）；這個模組換成不用 eval 的實作。一定要比 Application 先載入。
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import { CrowdSim, WARMUP_SECONDS, makeRng, type Agent } from "./crowd";
import { getFloorBackground } from "./background";
import { cleanCrewSize, type Weather } from "@coidle/shared";
import { CROWD_CAP, FPS_CAP, PerfGovernor, lampWithWeather, stageTint } from "./lighting";
import { WeatherFx } from "./weatherfx";
import { TILE, layoutFloor, type FloorPlan, type RoomRect } from "./floorplan";
import { isShopActive, lotSignature, planKey, type ShopFlag, type StageFloor, type StageShop } from "./model";
import { FURNITURE } from "./furniture";
import {
  ROOM_PX_H,
  ROOM_PX_W,
  getBubbleTexture,
  getEmptyLotTexture,
  getGlowTexture,
  getPersonTexture,
  getUmbrellaTexture,
  UMBRELLA_H,
  getRoomTextures,
  getScaffoldTexture,
  getSelectTexture,
  type IconKey,
} from "./sprites";

export interface SceneEvents {
  /** 點到店面格（slot）；點到空白處為 null。clientX/Y 供 HUD 定位彈出面板 */
  onTap(slot: number | null, clientX: number, clientY: number): void;
  /** WebGL 畫面已遺失（手機回前景時常見）：請上層銷毀這個場景並重建 */
  onLost?(): void;
}

const FLAG_ICON: Record<ShopFlag, IconKey> = {
  stockout: "box",
  broken: "wrench",
  complaint: "face",
  stale: "exclaim",
  regular: "star",
};
const FLAG_ORDER: ShopFlag[] = ["broken", "stockout", "complaint", "stale", "regular"];
const FLAG_TONE: Partial<Record<ShopFlag, "urgent" | "decision" | "opportunity">> = {
  broken: "urgent",
  stockout: "urgent",
  complaint: "decision",
  stale: "decision",
  regular: "opportunity",
};

interface Clock {
  minute: number;
  open: number;
  close: number;
  /** 休息日（週末或假日）：人潮用假日的時段曲線 */
  weekend: boolean;
}

/** 每層樓各留一份人潮：切走再切回來人還在，只補跑離開的那段時間 */
interface FloorCrowd {
  crowd: CrowdSim;
  plan: FloorPlan;
  key: string;
  leftAt: number;
}

export class StageScene {
  private app!: Application;
  private world = new Container();
  private labels = new Container();
  private bg = new Sprite();
  private baseLayer = new Container();
  private peopleLayer = new Container();
  private frontLayer = new Container();
  private overlayLayer = new Container();
  private markerLayer = new Container();
  private selectSprite = new Sprite();
  private night = new Graphics();
  private lightLayer = new Container();
  private fx = new WeatherFx();
  private weather: Weather = { kind: "clear", temp: 20 };
  private cleaningLevel: 0 | 1 | 2 = 1;
  private umbrellaSprites = new Map<number, Sprite>();
  /** 夜間的燈：base 是全亮時的不透明度，實際值 = base × 燈光亮度 */
  private lights: { s: Sprite | Graphics; base: number }[] = [];
  private spritePool: Sprite[] = [];
  private perf = new PerfGovernor();
  private perfTimer = 0;
  private vel = { x: 0, y: 0 };
  private lastMove = 0;
  private onVisibility: (() => void) | null = null;
  private onPageShow: (() => void) | null = null;
  private onContextLost: ((e: Event) => void) | null = null;
  /** WebGL context 已遺失，等回到前景（或立刻）請上層重建 */
  private lost = false;
  private lostNotified = false;

  private floor: StageFloor | null = null;
  private plan: FloorPlan | null = null;
  private shops = new Map<number, StageShop | null>();
  private crowd: CrowdSim | null = null;
  private crowds = new Map<string, FloorCrowd>();
  private agentSprites = new Map<number, Sprite>();
  private staffSprites: { s: Sprite; baseY: number; phase: number }[] = [];
  private markerSprites: { s: Sprite; baseY: number; phase: number }[] = [];
  private labelTexts: { t: Text; wx: number; wy: number }[] = [];
  private selected: number | null = null;
  private slotsKey = "";
  private roomSig = "";
  private clock: Clock = { minute: 13 * 60, open: 10, close: 22, weekend: false };
  private time = 0;
  /** 人物動畫用的時間：隨商場時間流速走（暫停就停，加速最多 2 倍） */
  private animTime = 0;
  /** 商場時間流速倍率：暫停 0、追趕加速 2／3／6、平常 1 */
  private flow = 1;

  private insetR = 0;
  private insetB = 0;
  private zoom = 2;
  private ox = 0;
  private oy = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = false;
  private pinchDist = 0;
  private downAt = { x: 0, y: 0 };
  private destroyed = false;
  private disposeDom: (() => void) | null = null;
  private seed = 20270401;

  private constructor(private host: HTMLElement, private ev: SceneEvents) {}

  static async create(host: HTMLElement, ev: SceneEvents): Promise<StageScene> {
    const s = new StageScene(host, ev);
    await s.init();
    return s;
  }

  private async init(): Promise<void> {
    const app = new Application();
    await app.init({
      background: 0x0a0e1d,
      resizeTo: this.host,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      roundPixels: true,
    });
    if (this.destroyed) {
      app.destroy(true, { children: true });
      return;
    }
    this.app = app;
    this.host.appendChild(app.canvas);
    app.canvas.style.touchAction = "none";
    app.canvas.style.display = "block";

    this.peopleLayer.sortableChildren = true;
    this.world.addChild(this.bg, this.baseLayer, this.peopleLayer, this.frontLayer, this.overlayLayer, this.night, this.lightLayer, this.fx.layer, this.selectSprite, this.markerLayer, this.fx.flashLayer);
    this.selectSprite.texture = getSelectTexture();
    this.selectSprite.visible = false;
    this.selectSprite.tint = 0xffe29a;
    app.stage.addChild(this.world, this.labels);

    app.ticker.add((t) => this.tick(t.deltaMS / 1000));
    // 分頁在背景時停掉 ticker（省電）；回來時 start() 會重設時間基準，不會一次補一大段
    // 手機在背景時系統可能回收 WebGL context，回來就是空白：偵測到就請上層整個重建場景
    this.onContextLost = (e) => {
      e.preventDefault();
      this.lost = true;
      if (!document.hidden) this.notifyLost();
    };
    app.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.onVisibility = () => {
      if (document.hidden) return app.ticker.stop();
      this.resume();
    };
    this.onPageShow = () => {
      if (!document.hidden) this.resume();
    };
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pageshow", this.onPageShow);
    this.bindInput();
  }

  /** 回到前景：context 掉了就請上層重建，否則校正畫布大小並重啟 ticker */
  private resume(): void {
    if (this.destroyed || !this.app) return;
    if (this.lost || this.contextIsLost()) {
      this.lost = true;
      this.notifyLost();
      return;
    }
    this.app.resize();
    this.app.ticker.start();
  }

  private contextIsLost(): boolean {
    const gl = (this.app.renderer as unknown as { gl?: { isContextLost?: () => boolean } }).gl;
    return !!gl?.isContextLost?.();
  }

  private notifyLost(): void {
    if (this.lostNotified || this.destroyed) return;
    this.lostNotified = true;
    this.ev.onLost?.();
  }

  // ───────── 公開 API ─────────

  setFloor(floor: StageFloor): void {
    if (!this.app) return;
    // 記下離開這層的時間：切回來時只補跑離開的那段，人不會消失
    const prev = this.floor ? this.crowds.get(this.floor.id) : undefined;
    if (prev) prev.leftAt = this.time;
    this.floor = floor;
    const key = planKey(floor);
    this.slotsKey = key;
    this.syncShops();
    const cached = this.crowds.get(floor.id);
    let away = WARMUP_SECONDS;
    if (cached && cached.key === key) {
      this.plan = cached.plan;
      this.crowd = cached.crowd;
      away = Math.min(WARMUP_SECONDS, Math.max(0, this.time - cached.leftAt));
    } else {
      // 第一次看這層，或店面格增減（擴建）：重排平面圖、重新生成人潮並熱身到穩態
      this.plan = layoutFloor(
        floor.lots.map((l) => l.slot),
        { ground: floor.ground, links: floor.links },
      );
      this.crowd = new CrowdSim({ plan: this.plan, rng: makeRng(this.seed + floor.id.length * 7919), maxAgents: CROWD_CAP[this.perf.level] });
      this.crowds.set(floor.id, { crowd: this.crowd, plan: this.plan, key, leftAt: this.time });
    }
    this.crowd.setWeather(this.weather);
    this.crowd.setMax(CROWD_CAP[this.perf.level]);
    const { minute, open, close, weekend } = this.clock;
    this.crowd.warmUp(away, this.shops, minute, open, close, weekend);
    this.rebuild();
    this.fit();
  }

  /**
   * 資料有變時呼叫（WS 推來新狀態）。盡量少重建：
   * - 店面格增減（擴建）→ 重排平面圖與人潮
   * - 店的狀態／類型／施工進度變了 → 重畫房間
   * - 只有價格、旗標、營收之類 → 只更新店員、氣泡、文字
   */
  updateFloor(floor: StageFloor): void {
    if (!this.app || !this.floor || this.floor.id !== floor.id) return this.setFloor(floor);
    if (planKey(floor) !== this.slotsKey) return this.setFloor(floor);
    this.floor = floor;
    if (lotSignature(floor) !== this.roomSig) return this.rebuild();
    this.syncShops();
    this.buildDynamic();
  }

  setCleaning(level: 0 | 1 | 2): void {
    this.cleaningLevel = level;
  }

  /** 天氣變了（日期換天、事件強制天氣）：更新特效、天色、燈光與人潮疏密 */
  setWeather(w: Weather): void {
    if (w.kind === this.weather.kind && w.temp === this.weather.temp) return;
    this.weather = w;
    this.crowd?.setWeather(w);
    this.fx.setWeather(w.kind);
    this.updateNight();
  }

  /** 商場時間流速（暫停 0、追趕中＝追趕速度、平常 1）：人物與天氣動畫跟著暫停／加速 */
  setTimeScale(flow: number): void {
    this.flow = Math.max(0, flow);
  }

  setClock(minute: number, open: number, close: number, weekend = false): void {
    this.clock = { minute, open, close, weekend };
    this.updateNight();
  }

  setSelected(slot: number | null): void {
    this.selected = slot;
    this.updateSelect();
  }

  /** 螢幕座標（相對 host）→ 房間中心的畫面位置，供 HUD 錨定 */
  roomScreenRect(slot: number): { x: number; y: number; w: number; h: number } | null {
    const room = this.plan?.rooms.find((r) => r.slot === slot);
    if (!room) return null;
    return { x: this.ox + room.x * TILE * this.zoom, y: this.oy + room.y * TILE * this.zoom, w: room.w * TILE * this.zoom, h: room.h * TILE * this.zoom };
  }

  /** 除錯用：目前場上的人數與 ticker 是否在跑 */
  debugInfo(): { agents: number; flow: number; staff: number; fps: number; zoom: number } {
    return { agents: this.crowd?.agents.length ?? 0, flow: this.flow, staff: this.staffSprites.length, fps: Math.round(this.app?.ticker.FPS ?? 0), zoom: this.zoom };
  }

  /** 除錯用：窗格隱藏時 ticker 不會跑，手動快轉模擬 N 秒 */
  debugAdvance(seconds: number): void {
    for (let t = 0; t < seconds; t += 0.05) this.tick(0.05, false);
  }

  zoomBy(factor: number): void {
    if (!this.app) return;
    this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, factor);
  }

  /** HUD 面板佔掉的區域（右側／底部），場景置中與平移上限都會避開 */
  setInsets(right: number, bottom: number): void {
    this.insetR = right;
    this.insetB = bottom;
    this.clampCamera();
    this.applyCamera();
  }

  /** 把某間店移到可見區域中央（面板打開後呼叫） */
  focusSlot(slot: number): void {
    const room = this.plan?.rooms.find((r) => r.slot === slot);
    if (!room || !this.app) return;
    const cx = (room.x + room.w / 2) * TILE * this.zoom;
    const cy = (room.y + room.h / 2) * TILE * this.zoom;
    const visW = this.app.screen.width - this.insetR;
    const visH = this.app.screen.height - this.insetB;
    this.ox = visW / 2 - cx;
    this.oy = visH / 2 - cy;
    this.clampCamera();
    this.applyCamera();
  }

  fit(): void {
    if (!this.plan || !this.app) return;
    const vw = this.app.screen.width - this.insetR;
    const vh = this.app.screen.height - this.insetB - 56; // 56：頂部 HUD
    const mw = this.plan.width * TILE;
    const mh = this.plan.height * TILE;
    const z = Math.min(vw / mw, vh / mh);
    this.zoom = z >= 2 ? Math.min(4, Math.floor(z * 4) / 4) : Math.max(1.1, z);
    this.ox = (vw - mw * this.zoom) / 2;
    this.oy = 56 + (vh - mh * this.zoom) / 2;
    this.clampCamera();
    this.applyCamera();
  }

  destroy(): void {
    this.destroyed = true;
    this.disposeDom?.();
    if (this.onVisibility) document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.onPageShow) window.removeEventListener("pageshow", this.onPageShow);
    if (this.app) {
      if (this.onContextLost) this.app.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      this.app.destroy(true, { children: true });
    }
    this.crowds.clear();
  }

  // ───────── 建場景 ─────────

  private rebuild(): void {
    if (!this.plan || !this.floor) return;
    const plan = this.plan;
    this.bg.texture = getFloorBackground(plan, this.floor.id);
    this.roomSig = lotSignature(this.floor);
    this.staffSprites = [];
    this.baseLayer.removeChildren().forEach((c) => c.destroy());
    this.frontLayer.removeChildren().forEach((c) => c.destroy());
    this.overlayLayer.removeChildren().forEach((c) => c.destroy());
    this.peopleLayer.removeChildren().forEach((c) => c.destroy());
    this.agentSprites.clear();
    this.umbrellaSprites.clear();
    this.spritePool = [];
    this.fx.setWeather(this.weather.kind);
    this.fx.build(plan, !!this.floor.outdoor);
    this.syncShops();

    for (const room of plan.rooms) {
      const shop = this.shops.get(room.slot) ?? null;
      const ox = room.x * TILE;
      const oy = room.y * TILE;
      if (!shop || shop.state === "empty" || shop.state === "building") {
        const e = new Sprite(getEmptyLotTexture(room.row));
        e.position.set(ox, oy);
        this.baseLayer.addChild(e);
        if (this.floor.lockedLevel != null) {
          const dim = new Graphics();
          dim.rect(ox, oy, ROOM_PX_W, ROOM_PX_H).fill({ color: 0x080a18, alpha: 0.55 });
          this.overlayLayer.addChild(dim);
        }
        if (shop?.state === "building") {
          const sc = new Sprite(getScaffoldTexture());
          sc.position.set(ox, oy);
          this.overlayLayer.addChild(sc);
          const bar = new Graphics();
          bar.rect(ox + 20, oy + ROOM_PX_H - 12, ROOM_PX_W - 40, 5).fill(0x241f33);
          bar.rect(ox + 21, oy + ROOM_PX_H - 11, (ROOM_PX_W - 42) * (shop.progress ?? 0), 3).fill(0xffc857);
          this.overlayLayer.addChild(bar);
        }
        continue;
      }
      const tex = getRoomTextures(shop.archetype, shop.color, room.row);
      const base = new Sprite(tex.base);
      base.position.set(ox, oy);
      this.baseLayer.addChild(base);
      const front = new Sprite(tex.front);
      front.position.set(ox, oy);
      this.frontLayer.addChild(front);

      if (shop.state === "closed") {
        const dim = new Graphics();
        dim.rect(ox, oy, ROOM_PX_W, ROOM_PX_H).fill({ color: 0x080a18, alpha: 0.5 });
        this.overlayLayer.addChild(dim);
      }
    }
    this.buildDynamic();
    this.updateSelect();
    // 精靈剛被清空：馬上依目前人潮補回，不要等下一幀（切樓層、施工進度更新時才不會閃）
    if (this.crowd) this.syncAgents(this.crowd.agents);
  }

  private syncShops(): void {
    this.shops.clear();
    for (const l of this.floor?.lots ?? []) this.shops.set(l.slot, l.shop);
  }

  /** 店員、氣泡、文字標籤：資料變動時重建 */
  private buildDynamic(): void {
    if (!this.plan) return;
    // 店員
    for (const s of this.staffSprites) s.s.destroy();
    this.staffSprites = [];
    for (const room of this.plan.rooms) {
      const shop = this.shops.get(room.slot);
      if (!isShopActive(shop)) continue;
      const spots = FURNITURE[shop.archetype].staff;
      const n = Math.min(spots.length, shop.level >= 2 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const spot = spots[i]!;
        const sp = new Sprite(getPersonTexture(room.slot * 3 + i, "idle", true));
        sp.anchor.set(0.5, 1);
        const wy = room.y * TILE + spot.y;
        sp.position.set(room.x * TILE + spot.x, wy);
        sp.zIndex = wy;
        this.peopleLayer.addChild(sp);
        this.staffSprites.push({ s: sp, baseY: wy, phase: room.slot + i });
      }
    }
    // 氣泡
    for (const m of this.markerSprites) m.s.destroy();
    this.markerSprites = [];
    this.markerLayer.removeChildren();
    for (const room of this.plan.rooms) {
      const shop = this.shops.get(room.slot);
      const icons: { icon: IconKey; tone?: "urgent" | "decision" | "opportunity" }[] = [];
      if (shop?.state === "building") icons.push({ icon: "hammer" });
      if (shop && shop.state !== "building") {
        for (const f of FLAG_ORDER) if (shop.flags.includes(f)) icons.push({ icon: FLAG_ICON[f], tone: FLAG_TONE[f] });
        if (shop.state === "closed" && !shop.flags.includes("broken")) icons.push({ icon: "exclaim", tone: "urgent" });
      }
      icons.slice(0, 3).forEach((ic, i) => {
        const sp = new Sprite(getBubbleTexture(ic.icon, ic.tone));
        sp.anchor.set(0.5, 1);
        const wy = room.y * TILE + 17;
        sp.position.set(room.x * TILE + ROOM_PX_W - 22 - i * 16, wy);
        this.markerLayer.addChild(sp);
        this.markerSprites.push({ s: sp, baseY: wy, phase: room.slot * 0.7 + i });
      });
    }
    // 文字
    this.labels.removeChildren().forEach((c) => c.destroy());
    this.labelTexts = [];
    const mk = (text: string, wx: number, wy: number, o: { size?: number; fill?: number; weight?: "bold" | "normal" } = {}) => {
      const t = new Text({
        text,
        style: {
          fontFamily: '"Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif',
          fontSize: o.size ?? 12,
          fontWeight: o.weight ?? "bold",
          fill: o.fill ?? 0xffffff,
          stroke: { color: 0x12101e, width: 3 },
          align: "center",
        },
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      t.anchor.set(0.5);
      this.labels.addChild(t);
      this.labelTexts.push({ t, wx, wy });
    };
    for (const room of this.plan.rooms) {
      const shop = this.shops.get(room.slot);
      const cx = room.x * TILE + ROOM_PX_W / 2;
      const ry = room.y * TILE;
      if (!shop || shop.state === "empty") {
        const lv = this.floor?.lockedLevel;
        if (lv != null) mk(`Lv.${lv} 解鎖`, cx, ry + 64, { size: 12, fill: 0x8a90b8 });
        else mk("空地・點此開店", cx, ry + 64, { size: 12, fill: 0xb8b8e8 });
      }
      else if (shop.state === "building") {
        mk(shop.name, cx, ry + 11, { size: 12 });
        mk(`施工中 ${Math.round((shop.progress ?? 0) * 100)}%`, cx, ry + 52, { size: 12, fill: 0xffc857 });
      } else {
        mk(shop.name, cx, ry + 11, { size: 12 });
        if (shop.state === "closed") mk("暫停營業", cx, ry + 62, { size: 13, fill: 0xff8a8a });
      }
    }
    this.updateLabels();
    this.buildLights();
    this.updateNight();
  }

  /** 天色（清晨暖橘、黃昏橘紅、夜晚深藍；打烊更暗）與燈光亮度 */
  private updateNight(): void {
    if (!this.plan) return;
    const { minute, open, close } = this.clock;
    const tint = stageTint(minute, open, close, this.weather.kind);
    this.night.clear();
    if (tint.alpha > 0.005) this.night.rect(0, 0, this.plan.width * TILE, this.plan.height * TILE).fill({ color: tint.color, alpha: tint.alpha });
    const lamp = lampWithWeather(minute, this.weather.kind);
    this.fx.setLamp(lamp);
    this.lightLayer.visible = lamp > 0.01;
    for (const l of this.lights) l.s.alpha = l.base * lamp;
  }

  /**
   * 夜間的燈：營業中的店面室內暖光＋門口外溢的光、走道天花燈、噴水池與電扶梯的光。
   * 全部用 add 混合疊在夜色上；白天（燈光亮度 0）整層隱藏，不花繪製成本。
   */
  private buildLights(): void {
    for (const l of this.lights) l.s.destroy();
    this.lights = [];
    this.lightLayer.removeChildren();
    const plan = this.plan;
    if (!plan) return;
    const glow = (wx: number, wy: number, size: number, tint: number, base: number) => {
      const s = new Sprite(getGlowTexture());
      s.anchor.set(0.5);
      s.position.set(wx, wy);
      s.width = size;
      s.height = size * 0.8;
      s.tint = tint;
      s.blendMode = "add";
      this.lightLayer.addChild(s);
      this.lights.push({ s, base });
    };
    for (const room of plan.rooms) {
      if (!isShopActive(this.shops.get(room.slot))) continue;
      const wash = new Graphics();
      wash.rect(room.x * TILE + 2, room.y * TILE + 2, ROOM_PX_W - 4, ROOM_PX_H - 4).fill(0xffc980);
      wash.blendMode = "add";
      this.lightLayer.addChild(wash);
      this.lights.push({ s: wash, base: 0.13 });
      const doorX = room.door.x * TILE;
      const doorY = room.row === "top" ? (room.y + room.h) * TILE + 6 : room.y * TILE - 2;
      glow(doorX, doorY, 120, 0xffd9a0, 0.55);
    }
    const { x0, x1 } = plan.atrium;
    for (const cor of plan.corridors)
      for (let i = 0; i < plan.width; i += 5) {
        const lx = i * TILE + 24;
        if (lx > x0 * TILE - 8 && lx < x1 * TILE + 8) continue;
        glow(lx, cor.laneY * TILE, 84, 0xfff1b8, 0.4);
      }
    glow(plan.fountain.x * TILE, plan.fountain.y * TILE, 110, 0x9fe0ff, 0.5);
    const e = plan.escalator;
    glow((e.x + e.w / 2) * TILE, (e.y + e.h / 2) * TILE, 90, 0xffe29a, 0.4);
  }

  private updateSelect(): void {
    const room = this.plan?.rooms.find((r) => r.slot === this.selected);
    if (!room) {
      this.selectSprite.visible = false;
      return;
    }
    this.selectSprite.visible = true;
    this.selectSprite.position.set(room.x * TILE, room.y * TILE);
  }

  // ───────── 每幀 ─────────

  /** 效能吃緊時降級（人潮上限、幀率上限）；穩定後再升回來 */
  private applyPerf(fps: number): void {
    const before = this.perf.level;
    const level = this.perf.sample(fps);
    if (level === before) return;
    this.crowd?.setMax(CROWD_CAP[level]);
    this.fx.setPerf(level);
    this.app.ticker.maxFPS = FPS_CAP[level];
  }

  /** 放開手指後的慣性滑動 */
  private coast(dt: number): void {
    if (this.pointers.size > 0) return;
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed < 8) {
      this.vel.x = this.vel.y = 0;
      return;
    }
    this.ox += this.vel.x * dt;
    this.oy += this.vel.y * dt;
    const k = Math.exp(-dt * 5);
    this.vel.x *= k;
    this.vel.y *= k;
    this.clampCamera();
    this.applyCamera();
  }

  /** real：由 ticker 驅動（才量幀率）；debugAdvance 的快轉不算 */
  private tick(dt: number, real = true): void {
    if (!this.plan || !this.crowd) return;
    this.time += dt;
    if (real) {
      this.perfTimer += dt;
      if (this.perfTimer >= 1) {
        this.perfTimer = 0;
        if (!document.hidden) this.applyPerf(this.app.ticker.FPS);
      }
      this.coast(dt);
    }
    const { minute, open, close, weekend } = this.clock;
    // 商場時間暫停（flow=0）人物與天氣定格；追趕加速時人物照倍率走（移動、停留、生成都乘上 flow）。
    // 走路的步伐動畫最多加到 2 倍，不然 6× 會閃爍。
    this.fx.update(this.flow > 0 ? dt : 0);
    this.animTime += dt * Math.min(this.flow, 2);
    this.crowd.ensureCleaners(cleanCrewSize(this.cleaningLevel, this.weather, this.floorHasProblems()));
    this.crowd.update(Math.min(dt, 0.1) * this.flow, this.shops, minute, open, close, weekend);
    this.syncAgents(this.crowd.agents);

    for (const s of this.staffSprites) s.s.y = s.baseY + (Math.sin(this.animTime * 2 + s.phase) > 0.6 ? -1 : 0);
    for (const m of this.markerSprites) m.s.y = m.baseY + Math.round(Math.sin(this.time * 4 + m.phase) * 1.5);
    if (this.selectSprite.visible) this.selectSprite.alpha = 0.55 + 0.35 * Math.sin(this.time * 5);
    if (Math.floor(this.time * 2) !== Math.floor((this.time - dt) * 2)) this.updateNight();
  }

  private floorHasProblems(): boolean {
    for (const sh of this.shops.values()) if (sh && sh.flags.includes("complaint")) return true;
    return false;
  }

  private syncAgents(agents: Agent[]): void {
    const alive = new Set<number>();
    for (const a of agents) {
      alive.add(a.id);
      let sp = this.agentSprites.get(a.id);
      if (!sp) {
        // 離場的人的精靈放回池子重用，避免一直建立／銷毀物件
        sp = this.spritePool.pop();
        if (!sp) {
          sp = new Sprite();
          sp.anchor.set(0.5, 1);
          this.peopleLayer.addChild(sp);
        }
        sp.visible = true;
        this.agentSprites.set(a.id, sp);
      }
      const frame = a.phase === "dwell" && a.sitting ? "sit" : a.moving ? (Math.floor(this.animTime * 6 + a.id) % 2 === 0 ? "stepA" : "stepB") : "idle";
      sp.texture = getPersonTexture(a.variant, frame, a.kind === "cleaner");
      sp.position.set(Math.round(a.x), Math.round(a.y));
      sp.scale.x = a.face;
      sp.zIndex = a.y + (a.phase === "dwell" && a.sitting ? 3 : 0);

      // 下雨天從街門進來的人撐著傘，走進館內就收起來
      let um = this.umbrellaSprites.get(a.id);
      if (a.umbrella) {
        if (!um) {
          um = new Sprite(getUmbrellaTexture(a.variant));
          um.anchor.set(0.5, 1);
          this.peopleLayer.addChild(um);
          this.umbrellaSprites.set(a.id, um);
        }
        um.position.set(Math.round(a.x) + (a.face === 1 ? 1 : -1), Math.round(a.y) - (UMBRELLA_H));
        um.zIndex = a.y + 1;
      } else if (um) {
        um.destroy();
        this.umbrellaSprites.delete(a.id);
      }
    }
    for (const [id, sp] of this.agentSprites) {
      if (!alive.has(id)) {
        this.umbrellaSprites.get(id)?.destroy();
        this.umbrellaSprites.delete(id);
        sp.visible = false;
        this.spritePool.push(sp);
        this.agentSprites.delete(id);
      }
    }
  }

  // ───────── 攝影機與輸入 ─────────

  private applyCamera(): void {
    this.world.scale.set(this.zoom);
    this.world.position.set(Math.round(this.ox), Math.round(this.oy));
    this.updateLabels();
  }

  private updateLabels(): void {
    for (const l of this.labelTexts) {
      l.t.position.set(Math.round(this.ox + l.wx * this.zoom), Math.round(this.oy + l.wy * this.zoom));
      l.t.visible = this.zoom >= 1;
    }
  }

  private clampCamera(): void {
    if (!this.plan || !this.app) return;
    const vw = this.app.screen.width - this.insetR;
    const vh = this.app.screen.height - this.insetB;
    const mw = this.plan.width * TILE * this.zoom;
    const mh = this.plan.height * TILE * this.zoom;
    const pad = 48;
    // 上方留給 HUD 的條
    const top = 56;
    this.ox = mw <= vw ? (vw - mw) / 2 : Math.min(pad, Math.max(vw - mw - pad, this.ox));
    this.oy = mh <= vh - top ? top + (vh - top - mh) / 2 : Math.min(pad + top, Math.max(vh - mh - pad, this.oy));
  }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const nz = Math.max(1, Math.min(6, this.zoom * factor));
    const k = nz / this.zoom;
    this.ox = sx - (sx - this.ox) * k;
    this.oy = sy - (sy - this.oy) * k;
    this.zoom = nz;
    this.clampCamera();
    this.applyCamera();
  }

  private bindInput(): void {
    const el = this.app.canvas;
    const rectOf = () => el.getBoundingClientRect();
    const local = (e: PointerEvent | WheelEvent) => {
      const b = rectOf();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };

    const down = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, local(e));
      this.vel.x = this.vel.y = 0;
      this.lastMove = performance.now();
      if (this.pointers.size === 1) {
        this.dragMoved = false;
        this.downAt = local(e);
      } else if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        this.dragMoved = true;
      }
    };
    const move = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = local(e);
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) {
        if (!this.dragMoved && Math.hypot(cur.x - this.downAt.x, cur.y - this.downAt.y) > 6) this.dragMoved = true;
        if (this.dragMoved) {
          const now = performance.now();
          const dtMs = Math.max(1, now - this.lastMove);
          // 以最近幾次移動的速度平滑估計，放手時當作慣性的初速
          this.vel.x = this.vel.x * 0.5 + ((cur.x - prev.x) / dtMs) * 1000 * 0.5;
          this.vel.y = this.vel.y * 0.5 + ((cur.y - prev.y) / dtMs) * 1000 * 0.5;
          this.lastMove = now;
          this.ox += cur.x - prev.x;
          this.oy += cur.y - prev.y;
          this.clampCamera();
          this.applyCamera();
        }
      } else if (this.pointers.size === 2) {
        const [p1, p2] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this.pinchDist > 0) this.zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, d / this.pinchDist);
        this.pinchDist = d;
      }
    };
    const up = (e: PointerEvent) => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      // 停頓超過 80ms 才放手，就不要慣性；初速也設上限，避免一甩就飛出去
      if (!wasSingle || performance.now() - this.lastMove > 80) this.vel.x = this.vel.y = 0;
      else {
        const sp = Math.hypot(this.vel.x, this.vel.y);
        if (sp > 2200) {
          this.vel.x *= 2200 / sp;
          this.vel.y *= 2200 / sp;
        }
      }
      if (wasSingle && !this.dragMoved) {
        const p = local(e);
        const wx = (p.x - this.ox) / this.zoom;
        const wy = (p.y - this.oy) / this.zoom;
        const hit = this.plan?.rooms.find((r: RoomRect) => wx >= r.x * TILE && wx < (r.x + r.w) * TILE && wy >= r.y * TILE && wy < (r.y + r.h) * TILE);
        this.ev.onTap(hit ? hit.slot : null, e.clientX, e.clientY);
      }
    };
    const cancel = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinchDist = 0;
      this.vel.x = this.vel.y = 0;
    };
    // 手機長按會跳出選單，會打斷拖曳
    const noMenu = (e: Event) => e.preventDefault();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      this.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    const resize = () => {
      this.clampCamera();
      this.applyCamera();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    window.addEventListener("resize", resize);
    this.disposeDom = () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("resize", resize);
    };
  }
}
