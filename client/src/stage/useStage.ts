import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Weather } from "@coidle/shared";
import type { StageFloor } from "./model";
import type { StageScene } from "./scene";

export const isDesktop = (): boolean => window.innerWidth > 760;

/** 場景載入失敗後自動重試前的等待（毫秒）；重試一次仍失敗才顯示「重新載入」 */
const RETRY_DELAY_MS = 1500;

export interface UseStageOptions {
  floor: StageFloor;
  selected: number | null;
  /** 有側邊／底部面板蓋住場景時為 true */
  panelOpen: boolean;
  minuteOfDay: number;
  /** 此刻的天氣（特效、天色、人潮疏密） */
  weather: Weather;
  /** 清潔等級：下雨天加派清潔員的依據 */
  cleaningLevel: 0 | 1 | 2;
  openHour: number;
  closeHour: number;
  /** 休息日（週末或假日）：人潮用假日的時段曲線 */
  weekend?: boolean;
  /** 點到店面格（slot）或空白處（null） */
  onTap: (slot: number | null) => void;
}

/**
 * 場景生命週期與資料同步，示範版與真實版共用：
 * 建立／銷毀 Pixi 場景、面板留白、換樓層與資料更新、時鐘與選取。
 * 場景載入失敗會自動重試一次，之後回報 failed（由畫面顯示「重新載入」，呼叫 retry）；
 * 手機回前景時 WebGL 畫面被回收（context lost），會自動銷毀並重建場景。
 */
export function useStage(host: { current: HTMLElement | null }, o: UseStageOptions) {
  const sceneRef = useRef<StageScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 每加 1 就重建一次場景（context lost、按下重新載入） */
  const [generation, setGeneration] = useState(0);
  const onTapRef = useRef(o.onTap);
  onTapRef.current = o.onTap;
  const lastFloor = useRef<string | null>(null);

  const retry = useCallback(() => {
    setFailed(false);
    setGeneration((g) => g + 1);
  }, []);

  useEffect(() => {
    let dead = false;
    let sc: StageScene | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setReady(false);

    const create = async (attempt: number): Promise<void> => {
      try {
        // Pixi 很大（約 450 KB）：登入、大廳不需要，進到畫面版才載入
        const { StageScene } = await import("./scene");
        if (dead) return;
        const s = await StageScene.create(host.current!, {
          onTap: (slot) => onTapRef.current(slot),
          onLost: () => {
            if (!dead) setGeneration((g) => g + 1);
          },
        });
        if (dead) return s.destroy();
        sc = s;
        sceneRef.current = s;
        if (import.meta.env.DEV) (window as unknown as { __stage?: StageScene }).__stage = s;
        setFailed(false);
        setReady(true);
      } catch (e) {
        console.error("場景載入失敗", e);
        if (dead) return;
        if (attempt < 1) timer = setTimeout(() => void create(attempt + 1), RETRY_DELAY_MS);
        else setFailed(true);
      }
    };
    void create(0);

    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      sceneRef.current = null;
      lastFloor.current = null;
      sc?.destroy();
    };
  }, [generation]);

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

  // 時鐘要在 setFloor 之前設好：換樓層時的人潮熱身要用現在的時間與平假日曲線
  useEffect(() => {
    sceneRef.current?.setClock(o.minuteOfDay, o.openHour, o.closeHour, o.weekend ?? false);
  }, [ready, o.minuteOfDay, o.openHour, o.closeHour, o.weekend]);

  // 換樓層 → 重建（人潮每層各留一份）；同一樓層資料更新 → 盡量只更新動態部分
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !ready) return;
    if (lastFloor.current !== o.floor.id) {
      lastFloor.current = o.floor.id;
      sc.setFloor(o.floor);
    } else sc.updateFloor(o.floor);
  }, [ready, o.floor]);

  useEffect(() => {
    sceneRef.current?.setCleaning(o.cleaningLevel);
  }, [ready, o.cleaningLevel]);

  useEffect(() => {
    sceneRef.current?.setWeather(o.weather);
  }, [ready, o.weather.kind, o.weather.temp]);

  useEffect(() => {
    sceneRef.current?.setSelected(o.selected);
  }, [ready, o.selected, o.floor.id]);

  return { sceneRef, ready, failed, retry };
}
