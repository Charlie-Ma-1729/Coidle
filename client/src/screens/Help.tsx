import { useState } from "preact/hooks";
import { STARTER_QUESTS } from "@coidle/shared";
import { Btn, Card, Chip, Meter } from "../components/ui";
import { money } from "../format";
import { tourOpen } from "../components/Tutorial";
import { state } from "../store";

const FAQ: [string, string][] = [
  ["我不在線，商場會怎樣？", "照常營業、照常賺錢。自動補貨、預設的事件處理都會替你運作。只有「放著會吃大虧」的重要事件（供應商斷貨、稽查預告…）在沒人在線時會讓時間暫停並通知你。"],
  ["我太忙，怕商場一直在跑怎麼辦？", "到「更多 → 營運 → 時間流速」把速度調慢，或直接暫停。暫停時一切靜止：不營業、不扣成本，什麼都不會流失。任何隊員都可以調整。"],
  ["客人為什麼不來／少了？", "看總覽的警告：缺貨、太髒、設備老舊、菜單太老氣、定價太高，都會讓口碑下滑。也可能是對手商場在辦活動（更多 → 商戰）或時段不對（營運頁的客流曲線）。"],
  ["資金為負會怎樣？", "自動補貨會停止、帳單會逾期並加收延滯稅。先把價格調合理、降低成本，賺回來會自動補繳。總覽會提前警告「30 天內要繳多少錢」。"],
  ["稅金要我自己報嗎？", "不用。所有稅金與保險都依日本制度計算並自動扣款，你只需要保持帳上有現金。「更多 → 稅務」可以看帳單與規則。"],
  ["什麼是「新鮮感」與「招牌」？", "新鮮感：菜單與活動會慢慢退流行，換新菜單或研發新品可以補回來。招牌：在「工坊」研發出的隱藏配方，上架後提高品質與客群吸引力。"],
  ["怎麼解鎖新區域？", "商場升級（累計營收與整體口碑都要夠）。Lv.2 開 1F、Lv.3 開娛樂區與招商…每一級都會開放新的業態與事件。"],
  ["招商和自己開店差在哪？", "自己開店賺全部營收，但要付人事、進貨並承擔風險；招商由租戶自己營運，你收租金加營業額抽成，比較輕鬆也比較少。租戶不滿意會撤櫃。"],
  ["怎麼和朋友一起玩？", "「更多 → 團隊」複製邀請碼，朋友註冊後用邀請碼加入。每個人都能操作；團隊事件需要不同的隊員各認領一項任務。"],
  ["忘記密碼怎麼辦？", "目前沒有信箱，請聯絡站長用管理指令重設臨時密碼。登入後記得到「團隊 → 我的帳號」改掉。"],
];

const GLOSSARY: [string, string][] = [
  ["在地口碑／觀光熱度", "兩條人氣指標。在地客看口碑，觀光客看熱度；平均越高，客流越大，也是升級條件之一。"],
  ["客群", "六種客人：觀光客、在地常客、上班族、家庭、學生、情侶。各有偏好的店、價格敏感度與來店時段。"],
  ["尖峰／離峰", "每種客人在平日與假日各有客流高峰。營運頁的曲線可以幫你決定營業時間。"],
  ["遇事暫停", "沒人在線時遇到重要事件，時鐘停住等人處理。可以在營運頁關掉。"],
  ["合規分數", "稽查的表現紀錄。太低稽查會更頻繁。保持清潔、維護設備、準時繳稅都會加分。"],
  ["進項／銷項稅額", "消費稅 = 賣出時收的稅 − 進貨時付的稅，每季結算。跟沒登錄發票的小供應商進貨，付的稅只能部分扣抵。"],
];

export function Help() {
  const s = state.value;
  const [open, setOpen] = useState<number | null>(null);
  if (!s) return null;
  const done = STARTER_QUESTS.filter((q) => s.meta.achievements[q.id] !== undefined).length;
  return (
    <>
      <Card title="🌱 新手任務" right={<Chip tone={done === STARTER_QUESTS.length ? "green" : "amber"}>{done}／{STARTER_QUESTS.length}</Chip>}>
        <div class="stack">
          <Meter label="" value={(done / STARTER_QUESTS.length) * 100} hint={`${done}／${STARTER_QUESTS.length}`} tone="green" />
          {STARTER_QUESTS.map((q) => {
            const ok = s.meta.achievements[q.id] !== undefined;
            return (
              <div key={q.id} style={{ opacity: ok ? 0.6 : 1 }}>
                <div class="row between small">
                  <span>
                    {ok ? "✅" : "⬜"} {q.icon} <b>{q.name}</b>
                  </span>
                  <span class="dim">{ok ? "已完成" : `獎金 ${money(q.reward)}`}</span>
                </div>
                {!ok && <p class="small dim" style={{ margin: "2px 0 6px" }}>{q.hint}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="📖 導覽" right={<Btn small onClick={() => (tourOpen.value = true)}>重看新手導覽</Btn>}>
        <p class="small dim">快速複習這個遊戲的玩法：主要分頁、賺錢的關鍵、時間與暫停、稅務與團隊。</p>
      </Card>

      <Card title="❓ 常見問題">
        <div class="stack">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button class="linklike" style={{ textAlign: "left" }} onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? "▾" : "▸"} {q}
              </button>
              {open === i && <p class="small dim" style={{ margin: "4px 0 6px 14px" }}>{a}</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="📚 名詞表">
        <div class="stack">
          {GLOSSARY.map(([k, v]) => (
            <p class="small" key={k}>
              <b>{k}</b>：<span class="dim">{v}</span>
            </p>
          ))}
        </div>
      </Card>
    </>
  );
}
