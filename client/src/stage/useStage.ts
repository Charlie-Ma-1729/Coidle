import { useEffect, useRef, useState } from "preact/hooks";
import type { StageFloor } from "./model";
import type { StageScene } from "./scene";

export const isDesktop = (): boolean => window.innerWidth > 760;

export interface UseStageOptions {
  floor: StageFloor;
  selected: number | null;
  /** 有側邊／底部面板蓋住場景時為 true */
  panelOpen: boolean;
  minuteOfDay: number;
  openHour: number;
  closeHour: number;
  /** 點到店面格（slot）或空白處（null） */
  onTap: (slot: number | null) => void;
}

/**
 * 場景生命週期與資料同步，示範版與真實版共用：
 * 建立／銷毀 Pixi 場景、面板留白、換樓層與資料更新、時鐘與選取。
 */
export function useStage(host: { current: HTMLElement | null }, o: UseStageOptions) {
  const sceneRef = useRef<StageScene | null>(null);
  const [ready, setReady] = useState(false);
  const onTapRef = useRef(o.onTap);
  onTapRef.current = o.onTap;
  const lastFloor = useRef<string | null>(null);

  useEffect(() => {
    let dead = false;
    let sc: StageScene | null = null;
    // Pixi 很大（約 450 KB）：登入、大廳不需要，進到畫面版才載入
    import("./scene")
      .then(({ StageScene }) => (dead ? null : StageScene.create(host.current!, { onTap: (slot) => onTapRef.current(slot) })))
      .then((s) => {
        if (!s) return;
        if (dead) return s.destroy();
        sc = s;
        sceneRef.current = s;
        if (import.meta.env.DEV) (window as unknown as { __stage?: StageScene }).__stage = s;
        setReady(true);
      })
      .catch((e) => console.error("場景載入失敗", e));
    return () => {
      dead = true;
      sceneRef.current = null;
      lastFloor.current = null;
      sc?.destroy();
    };
  }, []);

  // 面板／dock 佔掉的區域：必須在 setFloor 之前設好，初次置中縮放才會避開 dock
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !ready) return;
    const dockPad = isDesktop() ? 72 : 62;
    if (o.panelOpen) {
      if (isDesktop()) sc.setInsets(362, dockPad);
      else sc.setInsets(0, Math.round(window.innerHeight * 0.5));
      if (o.selected !== null) sc.focusSlot(o.selected);
    } else sc.setInsets(0, dockPad);
  }, [ready, o.panelOpen, o.selected]);

  // 換樓層 → 重建；同一樓層資料更新 → 盡量只更新動態部分
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !ready) return;
    if (lastFloor.current !== o.floor.id) {
      lastFloor.current = o.floor.id;
      sc.setFloor(o.floor);
    } else sc.updateFloor(o.floor);
  }, [ready, o.floor]);

  useEffect(() => {
    sceneRef.current?.setClock(o.minuteOfDay, o.openHour, o.closeHour);
  }, [ready, o.minuteOfDay, o.openHour, o.closeHour]);

  useEffect(() => {
    sceneRef.current?.setSelected(o.selected);
  }, [ready, o.selected, o.floor.id]);

  return { sceneRef, ready };
}
