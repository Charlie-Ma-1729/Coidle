import { useState } from "preact/hooks";
import { Btn, Card, Chip } from "./ui";
import { canInstall, disablePush, enablePush, installed, promptInstall, pushOn, pushPermission, pushSupported } from "../pwa";
import { toast } from "../store";

/** 這台裝置的設定：安裝成 App、遇事暫停時的推播通知 */
export function DeviceCard() {
  const [working, setWorking] = useState(false);
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const supported = pushSupported();

  const toggle = async () => {
    setWorking(true);
    try {
      if (pushOn.value) {
        await disablePush();
        toast("已關閉這台裝置的通知");
      } else {
        const err = await enablePush();
        toast(err ?? "已開啟通知：遇事暫停時會提醒你", err ? "error" : "info");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失敗", "error");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Card title="📲 這台裝置" right={installed.value ? <Chip tone="green">已安裝成 App</Chip> : undefined}>
      <div class="stack">
        {!installed.value && (
          <div class="row between">
            <span class="small">
              {canInstall.value ? "安裝後像一般 App 一樣從桌面開啟，不用每次找網址。" : iOS ? "iPhone／iPad：點分享按鈕 →「加入主畫面」就能安裝。" : "從瀏覽器選單選「安裝應用程式」或「加到主畫面」。"}
            </span>
            {canInstall.value && (
              <Btn small kind="primary" onClick={() => promptInstall()}>
                安裝
              </Btn>
            )}
          </div>
        )}
        <div class="row between">
          <span class="small">
            🔔 遇事暫停通知：商場因重要事件停下來等你時，手機會跳通知。
            {!supported && <span class="dim">（{iOS ? "iPhone 要先把網頁安裝到主畫面才能收通知" : "這個瀏覽器不支援"}）</span>}
            {pushPermission.value === "denied" && <span class="dim">（通知被瀏覽器封鎖了，請到網站設定開啟）</span>}
          </span>
          <Btn small kind={pushOn.value ? "ghost" : "primary"} disabled={!supported || working || pushPermission.value === "denied"} onClick={toggle}>
            {pushOn.value ? "關閉通知" : "開啟通知"}
          </Btn>
        </div>
      </div>
    </Card>
  );
}
