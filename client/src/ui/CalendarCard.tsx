import { WEEKDAY_NAMES, calendarDay, calendarEffectLines, calendarLabel, dayOfTick, upcomingCalendar, type CalendarDay } from "@coidle/shared";

const dateOf = (c: CalendarDay) => `${c.m}/${c.d} ${WEEKDAY_NAMES[c.dow]}`;

/** 今天的日本日曆（國定假日、連休、節日）與接下來一陣子的預告：日期是固定的，提前備貨、排班用 */
export function CalendarCard(props: { tick: number; /** 往後看幾個遊戲日 */ lookAhead?: number; /** 最多列幾個 */ max?: number }) {
  const today = calendarDay(dayOfTick(props.tick));
  const todayLabel = calendarLabel(today);
  const ahead = upcomingCalendar(today.day + 1, props.lookAhead ?? 30).slice(0, props.max ?? 5);
  const lines = calendarEffectLines(today);
  return (
    <div class="st-calendar-card">
      <p class="small">
        <b>今天（{dateOf(today)}）：</b>
        {todayLabel ?? (today.offDay ? "假日" : "平日")}
        {today.streak && <span class="dim">　連休第 {today.streak.index}／{today.streak.length} 天</span>}
      </p>
      {today.observances.slice(0, 3).map((o) => (
        <p class="small dim" key={o.id}>
          {o.icon} {o.name}：{o.note}
        </p>
      ))}
      {lines.map((l) => (
        <p class="small dim" key={l}>
          {l}
        </p>
      ))}
      {ahead.length > 0 ? (
        <>
          <p class="small">
            <b>接下來：</b>
          </p>
          <ul class="small dim" style={{ margin: "2px 0 0", paddingLeft: "1.2em" }}>
            {ahead.map((c) => (
              <li key={c.day}>
                {dateOf(c)}　{calendarLabel(c) ?? "連休"}
                {c.streak ? `（連休 ${c.streak.index}/${c.streak.length}）` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p class="small dim">接下來 30 個遊戲日沒有特別的節日。</p>
      )}
    </div>
  );
}
