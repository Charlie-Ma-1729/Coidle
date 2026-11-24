import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { Btn } from "./ui";

/** 新手導覽：第一次進商場自動出現；之後可以從「更多 → 說明」重看 */
export const tourOpen = signal(false);

const key = (userId: number | undefined, mallId: number | null) => `coidle.tour.${userId ?? 0}.${mallId ?? 0}`;
export function shouldShowTour(userId: number | undefined, mallId: number | null): boolean {
  try {
    return localStorage.getItem(key(userId, mallId)) === null;
  } catch {
    return false;
  }
}
export function markTourSeen(userId: number | undefined, mallId: number | null): void {
  try {
    localStorage.setItem(key(userId, mallId), "1");
  } catch {
    // 無痕模式等情況：下次再問一次也無妨
  }
}

interface Slide {
  icon: string;
  title: string;
  body: string[];
}

const SLIDES: Slide[] = [
  {
    icon: "🏬",
    title: "歡迎來到你的商場",
    body: [
      "你和朋友（最多約 6 人）一起經營一座緊鄰老街的近未來複合式商場。",
      "**不用一直盯著**：就算你們都不在線，商場也照常營業、照常賺錢。回來看營運日報、做幾個決定就好。",
    ],
  },
  {
    icon: "🧭",
    title: "五個主要分頁",
    body: [
      "🏠 **總覽**：資金、口碑、今天的狀況與待辦。",
      "🏬 **樓層**：每間店的位置，點開能調價格、補貨、升級；空店面可以開新店。",
      "🙋 **客人**：客訴、評價、巡場、常客——直接面對客人的地方。",
      "🧪 **工坊**：研發隱藏的招牌菜與新品。",
      "☰ **更多**：營運、行銷、供應商、商戰、招商、科技、稅務、目標與成就。",
    ],
  },
  {
    icon: "💴",
    title: "賺錢的幾個關鍵",
    body: [
      "客人會依**價格、品質、口碑、排隊**挑店。定價太高客人跑掉，太低賺不到。",
      "**缺貨**會讓客人白跑——設好自動補貨。",
      "清潔、設備、新菜單也會影響口碑；口碑越高，來的人越多。",
      "每天結束會有**日報**，告訴你賺了多少、哪裡出問題。",
    ],
  },
  {
    icon: "⏱️",
    title: "時間與暫停",
    body: [
      "標準流速：**真實 6 小時 = 遊戲 1 天**。你可以調慢，或直接暫停（營運頁），不用讓遊戲影響生活。",
      "沒人在線時，遇到「放著會吃大虧」的重要事件（供應商斷貨、稽查預告…），時間會**自動暫停**並通知你，處理完才繼續。",
    ],
  },
  {
    icon: "📜",
    title: "有真實感，但不繁瑣",
    body: [
      "稅金、保險、許可都是依日本的制度設計，但**全部自動扣款**——你只需要保持帳上有現金（總覽會提醒）。",
      "「更多 → 稅務」可以看帳單與規則。",
    ],
  },
  {
    icon: "👥",
    title: "和朋友一起",
    body: [
      "到「更多 → 團隊」複製邀請碼給朋友。每個人都能操作，動態牆會記下誰做了什麼。",
      "偶爾會有需要大家各認領一項任務的**團隊事件**，一起完成有額外獎勵。",
    ],
  },
  {
    icon: "🎯",
    title: "從新手任務開始",
    body: [
      "「更多 → 說明」有一份**新手任務**清單：調價格、設營業時間、開新店…完成就有獎金，照著做就能熟悉全部玩法。",
      "還有每日／每週目標、成就，以及一個藏在日常細節裡的小謎題：**這座商場在哪裡？** 😉",
    ],
  },
];

function renderLine(s: string) {
  const parts = s.split("**");
  return parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p));
}

export function Tutorial({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const slide = SLIDES[i]!;
  const last = i === SLIDES.length - 1;
  return (
    <div class="sheet-backdrop" role="dialog" aria-modal="true" aria-label="新手導覽">
      <div class="sheet" style={{ maxWidth: "460px" }}>
        <div class="sheet-body stack">
          <div style={{ fontSize: "2.4rem", textAlign: "center" }}>{slide.icon}</div>
          <h3 style={{ textAlign: "center", margin: 0 }}>{slide.title}</h3>
          {slide.body.map((b, k) => (
            <p key={k} class="small" style={{ margin: 0 }}>
              {renderLine(b)}
            </p>
          ))}
          <div class="row between">
            <span class="small dim">
              {i + 1}／{SLIDES.length}
            </span>
            <div class="row">
              {!last && (
                <Btn small onClick={onDone}>
                  略過
                </Btn>
              )}
              {i > 0 && (
                <Btn small onClick={() => setI(i - 1)}>
                  上一頁
                </Btn>
              )}
              <Btn small kind="primary" onClick={() => (last ? onDone() : setI(i + 1))}>
                {last ? "開始經營！" : "下一頁"}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
