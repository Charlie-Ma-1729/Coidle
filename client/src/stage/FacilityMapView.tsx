import { useEffect, useRef } from "preact/hooks";
import type { FacilityScene } from "./facilityscene";
import { specKey, type FacilitySpec } from "./facilityspec";

/** 設施樓層（停車場、影城）的地圖：進到設施樓層才載入 Pixi。動畫只是示意，帳目以伺服器為準。 */
export function FacilityMapView(props: { spec: FacilitySpec; minute: number; open: number; close: number; weekend: boolean; flow: number }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<FacilityScene | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let dead = false;
    void import("./facilityscene").then(async ({ FacilityScene }) => {
      if (dead || !host.current) return;
      const sc = await FacilityScene.create(host.current);
      if (dead) return sc.destroy();
      scene.current = sc;
      const p = latest.current;
      sc.setClock({ minute: p.minute, open: p.open, close: p.close, weekend: p.weekend, flow: p.flow });
      sc.setSpec(p.spec);
    });
    return () => {
      dead = true;
      scene.current?.destroy();
      scene.current = null;
    };
  }, []);

  const key = specKey(props.spec);
  useEffect(() => {
    scene.current?.setClock({ minute: props.minute, open: props.open, close: props.close, weekend: props.weekend, flow: props.flow });
    scene.current?.setSpec(props.spec);
  }, [key, props.minute, props.open, props.close, props.weekend, props.flow]);

  return <div class="st-facmap" ref={host} aria-label="設施示意圖" />;
}
