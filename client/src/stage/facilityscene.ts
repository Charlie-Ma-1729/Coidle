// 設施樓層（地下停車場、影城、保齡球館…）的小畫面：自己一個 Pixi 場景，進到設施樓層才載入。
// 各種設施的平面圖與人車模擬在 facility/ 底下一種一個模組（見 facility/types.ts）；這裡只管場景、縮放、時鐘。
// Pixi 要先載入不用 eval 的實作（見 scene.ts 開頭說明）。
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics } from "pixi.js";
import { makeRng } from "./crowd";
import { createFacilityView } from "./facility/registry";
import type { FacilityClock, FacilityView } from "./facility/types";
import { specKey, type FacilitySpec } from "./facilityspec";

export type { FacilityClock } from "./facility/types";

export class FacilityScene {
  private app!: Application;
  private world = new Container();
  private bg = new Graphics();
  private dyn = new Graphics();
  private view: FacilityView | null = null;
  private key = "";
  private clock: FacilityClock = { minute: 13 * 60, open: 10, close: 22, weekend: false, flow: 1 };
  private destroyed = false;
  private ro: ResizeObserver | null = null;

  private constructor(private host: HTMLElement) {}

  static async create(host: HTMLElement): Promise<FacilityScene> {
    const s = new FacilityScene(host);
    const app = new Application();
    await app.init({ background: 0x0a0e1d, resizeTo: host, antialias: false, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, roundPixels: true });
    if (s.destroyed) {
      app.destroy(true, { children: true });
      return s;
    }
    s.app = app;
    host.appendChild(app.canvas);
    app.canvas.style.display = "block";
    // 容器大小會因版面（面板、視窗縮放）改變；Pixi 的 resizeTo 只聽 window，所以自己監看
    s.ro = new ResizeObserver(() => {
      if (s.destroyed || !s.app) return;
      s.app.resize();
      s.fit();
    });
    s.ro.observe(host);
    s.world.addChild(s.bg, s.dyn);
    app.stage.addChild(s.world);
    app.ticker.add((t) => s.tick(t.deltaMS / 1000));
    return s;
  }

  setClock(c: FacilityClock): void {
    this.clock = c;
  }

  setSpec(spec: FacilitySpec): void {
    const key = specKey(spec);
    if (key === this.key) return;
    this.key = key;
    this.bg.clear();
    this.view = createFacilityView(spec, makeRng(0x5eed + key.length * 131 + key.charCodeAt(2) * 17), this.clock);
    this.view.drawStatic(this.bg);
    this.fit();
  }

  destroy(): void {
    this.destroyed = true;
    this.ro?.disconnect();
    if (this.app) {
      this.app.ticker.stop();
      this.app.destroy(true, { children: true });
    }
  }

  /** 整數倍放大（像素圖才不會糊）；放不下時才縮小 */
  private fit(): void {
    if (!this.app || !this.view) return;
    const { w, h } = this.view.size;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const raw = Math.min(sw / w, sh / h);
    const scale = raw >= 1 ? Math.floor(raw) : raw;
    this.world.scale.set(scale);
    this.world.position.set(Math.round((sw - w * scale) / 2), Math.round((sh - h * scale) / 2));
  }

  private tick(realDt: number): void {
    if (!this.view || !this.app) return;
    this.fit();
    this.view.update(Math.min(realDt, 0.1) * this.clock.flow, this.clock);
    this.dyn.clear();
    this.view.drawDynamic(this.dyn, this.clock);
  }
}
