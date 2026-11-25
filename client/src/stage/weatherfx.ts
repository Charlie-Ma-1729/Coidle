/**
 * 天氣的畫面特效（Pixi）：
 *  - 中庭天窗（露天樓層則是整層）：色罩、日光束、雨絲、閃電
 *  - 街門／車站通道口：被風吹進來的雨，入口的積水
 * 只畫在世界座標，疊在夜色之上；位置與數量的規則在 lighting.ts（純函式、有測試）。
 */
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import type { WeatherKind } from "@coidle/shared";
import { TILE, type FloorPlan } from "./floorplan";
import { FX, dropCount, nextFlashDelay, type PerfLevel } from "./lighting";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Drop {
  s: Sprite;
  area: Rect;
  speed: number;
}

export class WeatherFx {
  /** 雨絲、色罩、日光束、積水（疊在夜色上） */
  readonly layer = new Container();
  /** 閃電的白光（疊在最上面，蓋過整個場景） */
  readonly flashLayer = new Container();

  private sky = new Graphics();
  private beams = new Graphics();
  private puddles = new Graphics();
  private bolt = new Graphics();
  private flashRect = new Graphics();
  private drops: Drop[] = [];

  private kind: WeatherKind = "clear";
  private perf: PerfLevel = 0;
  private plan: FloorPlan | null = null;
  private outdoor = false;
  private areas: Rect[] = [];
  private time = 0;
  private lamp = 0;
  private nextFlash = Infinity;
  private flashLeft = 0;
  private seed = 1;

  constructor() {
    this.layer.addChild(this.sky, this.puddles, this.beams);
    this.beams.blendMode = "add";
    this.flashRect.blendMode = "add";
    this.bolt.blendMode = "add";
    this.flashLayer.addChild(this.flashRect, this.bolt);
    this.flashLayer.visible = false;
  }

  /** 確定性的小亂數（雨絲位置、閃電間隔不需要真的隨機，但每次不要一模一樣） */
  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** 換樓層或版型改變：重新決定哪裡看得到天空 */
  build(plan: FloorPlan, outdoor: boolean): void {
    this.plan = plan;
    this.outdoor = outdoor;
    const W = plan.width * TILE;
    const H = plan.height * TILE;
    if (outdoor) this.areas = [{ x: 0, y: 0, w: W, h: H }];
    else {
      // 中庭是貫穿的天井，雨會直接落進來；街門與車站口只有一小條
      this.areas = [{ x: plan.atrium.x0 * TILE, y: TILE, w: (plan.atrium.x1 - plan.atrium.x0) * TILE, h: H - 2 * TILE }];
      const lane = plan.corridors[plan.mainCorridor]!;
      for (const side of ["left", "right"] as const) {
        const kind = plan.ends[side];
        if (kind === "street" || kind === "rail" || kind === "parking") {
          const w = 3 * TILE;
          this.areas.push({ x: side === "left" ? 0 : W - w, y: lane.y * TILE, w, h: lane.h * TILE });
        }
      }
    }
    this.rebuild();
  }

  setWeather(kind: WeatherKind): void {
    if (kind === this.kind && this.plan) return;
    this.kind = kind;
    this.nextFlash = nextFlashDelay(kind, this.rnd());
    this.rebuild();
  }

  setPerf(level: PerfLevel): void {
    if (level === this.perf) return;
    this.perf = level;
    this.syncDrops();
  }

  /** 燈光亮度（0–1）：決定日光束／月光與積水反光 */
  setLamp(lamp: number): void {
    this.lamp = lamp;
  }

  private rebuild(): void {
    const plan = this.plan;
    if (!plan) return;
    const cfg = FX[this.kind];

    // 天窗色罩
    this.sky.clear();
    this.sky.visible = cfg.sky.alpha > 0;
    if (cfg.sky.alpha > 0) for (const a of this.areas) this.sky.rect(a.x, a.y, a.w, a.h).fill({ color: cfg.sky.color, alpha: cfg.sky.alpha });

    // 入口的積水：下雨天從外面帶進來的水
    this.puddles.clear();
    if (this.kind === "rain" || this.kind === "storm") {
      for (const e of plan.entrances) {
        const px = e.at.x * TILE;
        const py = e.at.y * TILE + 10;
        const rx = e.kind === "street" || e.kind === "rail" ? 16 : 13;
        this.puddles.ellipse(px, py, rx, 5).fill({ color: 0x6fa8d8, alpha: 0.38 });
        this.puddles.ellipse(px - 3, py - 1, rx * 0.5, 2).fill({ color: 0xdff2ff, alpha: 0.35 });
      }
    }

    this.flashRect.clear().rect(0, 0, plan.width * TILE, plan.height * TILE).fill(0xffffff);
    this.bolt.clear();
    this.flashLayer.visible = false;
    this.flashLeft = 0;
    this.beams.clear();
    this.syncDrops();
  }

  /** 雨絲的數量隨天氣與效能調整；依各區域面積分配 */
  private syncDrops(): void {
    const total = dropCount(this.kind, this.perf, this.outdoor);
    const cfg = FX[this.kind];
    // 先清掉不再需要的
    while (this.drops.length > total) this.drops.pop()!.s.destroy();
    const totalArea = this.areas.reduce((a, r) => a + r.w * r.h, 0) || 1;
    const pick = (): Rect => {
      let t = this.rnd() * totalArea;
      for (const a of this.areas) {
        t -= a.w * a.h;
        if (t <= 0) return a;
      }
      return this.areas[0]!;
    };
    // 區域變了或天氣變了：全部重新分配
    for (const d of this.drops) this.place(d, pick(), true, cfg.speed);
    while (this.drops.length < total) {
      const s = new Sprite(Texture.WHITE);
      s.width = 1.2;
      s.anchor.set(0.5, 0);
      this.layer.addChild(s);
      const d: Drop = { s, area: pick(), speed: cfg.speed };
      this.place(d, d.area, true, cfg.speed);
      this.drops.push(d);
    }
  }

  private place(d: Drop, area: Rect, anywhere: boolean, baseSpeed: number): void {
    const cfg = FX[this.kind];
    const z = this.rnd();
    d.area = area;
    d.speed = baseSpeed * (0.75 + z * 0.5);
    d.s.height = this.kind === "storm" ? 9 : 7;
    d.s.rotation = -Math.atan(cfg.slant);
    d.s.tint = 0xcfe6ff;
    d.s.alpha = 0.42 + z * 0.45;
    d.s.x = area.x + this.rnd() * area.w;
    d.s.y = anywhere ? area.y + this.rnd() * area.h : area.y - 8;
  }

  update(dt: number): void {
    if (!this.plan) return;
    this.time += dt;
    const cfg = FX[this.kind];

    // 雨絲
    if (this.drops.length > 0) {
      for (const d of this.drops) {
        d.s.y += d.speed * dt;
        d.s.x += d.speed * cfg.slant * dt;
        const a = d.area;
        if (d.s.y > a.y + a.h) this.place(d, a, false, cfg.speed);
        else if (d.s.x > a.x + a.w) d.s.x = a.x;
      }
    }

    // 日光（白天）或月光（夜裡）的光束，緩慢飄動
    this.beams.clear();
    if (cfg.beams && this.areas[0]) {
      const a = this.areas[0];
      const day = 1 - this.lamp;
      const alpha = day > 0.05 ? 0.1 * day : 0.045 * this.lamp;
      const color = day > 0.05 ? 0xfff1b8 : 0x9fb4ff;
      for (let i = 0; i < 3; i++) {
        const x = a.x + (a.w / 3) * i + Math.sin(this.time * 0.25 + i * 2) * 5;
        const w = a.w / 5;
        const tilt = a.h * 0.28;
        this.beams
          .poly([x, a.y, x + w, a.y, x + w - tilt, a.y + a.h, x - tilt, a.y + a.h])
          .fill({ color, alpha: alpha * (0.7 + 0.3 * Math.sin(this.time * 0.8 + i)) });
      }
    }

    // 閃電
    if (cfg.flash) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = nextFlashDelay(this.kind, this.rnd());
        this.flashLeft = 0.45;
        this.drawBolt();
      }
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      // 兩次閃爍：亮、暗、再亮、淡出
      const t = 0.45 - Math.max(0, this.flashLeft);
      const a = t < 0.08 ? 0.55 : t < 0.14 ? 0.1 : t < 0.22 ? 0.4 : Math.max(0, 0.4 * (1 - (t - 0.22) / 0.23));
      this.flashRect.alpha = a;
      this.bolt.alpha = Math.min(1, a * 2.2);
      this.flashLayer.visible = this.flashLeft > 0;
    } else if (this.flashLayer.visible) this.flashLayer.visible = false;
  }

  /** 中庭（或露天樓層）上方劈下一道閃電 */
  private drawBolt(): void {
    const a = this.areas[0];
    if (!a) return;
    this.bolt.clear();
    let x = a.x + a.w * (0.2 + this.rnd() * 0.6);
    let y = a.y;
    const pts: number[] = [x, y];
    while (y < a.y + a.h * 0.7) {
      y += 10 + this.rnd() * 12;
      x += (this.rnd() - 0.5) * 22;
      pts.push(x, y);
    }
    this.bolt.poly(pts, false).stroke({ width: 2, color: 0xfff6c8 });
  }

  destroy(): void {
    for (const d of this.drops) d.s.destroy();
    this.drops = [];
    this.layer.destroy({ children: true });
    this.flashLayer.destroy({ children: true });
  }
}
