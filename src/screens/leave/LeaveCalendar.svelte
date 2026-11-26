<script lang="ts">
  import { calendar, view } from '../../lib/app/view.svelte.ts';
  import {
    addDays,
    addMonthsClamped,
    dayOfWeek,
    daysInMonth,
    formatMonthDay,
    formatYmd,
    parseYmd,
    type Ymd,
  } from '../../lib/calc/date.ts';
  import { kindLabel } from '../../lib/calc/leave.ts';
  import type { LeaveKind } from '../../lib/store/schema.ts';
  import Icon from '../../lib/ui/Icon.svelte';

  interface Props {
    /** 보고 있는 달의 1일 */
    month: Ymd;
    selected: Ymd;
    onselect: (date: Ymd) => void;
    onmonth: (month: Ymd) => void;
  }

  let { month, selected, onselect, onmonth }: Props = $props();
  /** 보고 있는 달이 속한 해의 공휴일이 규정 데이터에 있는지 */
  const holidaysKnown = $derived(calendar.hasHolidayData(parseYmd(month).y));

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  /** 날짜별 연가 시간과 기록 종류(반일 기록 하나뿐이면 오전·오후를 칸에 적는다) */
  const hoursByDate = $derived.by(() => {
    // 매번 새로 만들어 읽기만 하는 표라서 반응형 Map이 필요 없다.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<Ymd, { hours: number; kinds: LeaveKind[] }>();
    for (const r of view.data.leave.records) {
      const entry = map.get(r.date) ?? { hours: 0, kinds: [] };
      entry.hours += r.hours;
      entry.kinds.push(r.kind);
      map.set(r.date, entry);
    }
    return map;
  });

  interface Cell {
    date: Ymd;
    day: number;
    dow: number;
    holiday: string | null;
    off: boolean;
    hours: number;
    /** 칸에 적는 짧은 표시: '연가', '오전', '오후', '2시간' */
    mark: string;
    today: boolean;
    selected: boolean;
    planned: boolean;
    label: string;
  }

  const cells = $derived.by(() => {
    const { y, m } = parseYmd(month);
    const perDay = view.rules.leave.units.hoursPerDay;
    const out: (Cell | null)[] = [];
    const lead = dayOfWeek(formatYmd({ y, m, d: 1 }));
    for (let i = 0; i < lead; i += 1) out.push(null);
    for (let d = 1; d <= daysInMonth(y, m); d += 1) {
      const date = formatYmd({ y, m, d });
      const dow = dayOfWeek(date);
      const holiday = calendar.holidayName(date);
      const entry = hoursByDate.get(date);
      const hours = entry?.hours ?? 0;
      const half = entry?.kinds.length === 1 && (entry.kinds[0] === 'am' || entry.kinds[0] === 'pm');
      const halfKind = half ? (entry?.kinds[0] as LeaveKind) : null;
      const parts = [formatMonthDay(date)];
      if (holiday) parts.push(holiday);
      if (hours >= perDay) parts.push('연가 1일');
      else if (halfKind) parts.push(`연가 ${kindLabel(halfKind, hours)}`);
      else if (hours > 0) parts.push(`연가 ${hours}시간`);
      // 빗금(예정)은 색으로만 구분되므로 낭독 문구에도 적는다
      if (hours > 0 && date > view.today) parts.push('예정');
      if (date === view.today) parts.push('오늘');
      out.push({
        date,
        day: d,
        dow,
        holiday,
        off: !calendar.isWorkday(date),
        hours,
        mark:
          hours >= perDay
            ? '연가'
            : halfKind === 'am'
              ? '오전'
              : halfKind === 'pm'
                ? '오후'
                : hours > 0
                  ? `${hours}시간`
                  : '',
        today: date === view.today,
        selected: date === selected,
        planned: date > view.today,
        label: parts.join(', '),
      });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  });

  const title = $derived.by(() => {
    const { y, m } = parseYmd(month);
    return `${y}년 ${m}월`;
  });

  const monthHolidays = $derived(
    cells
      .filter((c): c is Cell => c !== null && c.holiday !== null)
      .map((c) => `${c.day}일 ${c.holiday}`),
  );

  /**
   * Tab 으로 들어올 칸(하나만 tabindex=0): 보는 달에 고른 날이 있으면 그 날,
   * 없으면 오늘(그 달이면), 그것도 아니면 그 달 1일
   */
  const rovingDate = $derived.by<Ymd>(() => {
    const ym = month.slice(0, 7);
    if (selected.slice(0, 7) === ym) return selected;
    if (view.today.slice(0, 7) === ym) return view.today;
    return `${ym}-01`;
  });

  function move(delta: number) {
    onmonth(addMonthsClamped(month, delta));
  }

  /**
   * 방향키로 날짜 이동(달을 넘어가면 달도 넘긴다).
   * Home/End 는 그 주의 처음(일)·끝(토), PageUp/PageDown 은 한 달 앞·뒤의 같은 날.
   */
  function onKey(event: KeyboardEvent, date: Ymd) {
    const dow = dayOfWeek(date);
    let next: Ymd | null = null;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step !== undefined) next = addDays(date, step);
    else if (event.key === 'Home') next = addDays(date, -dow);
    else if (event.key === 'End') next = addDays(date, 6 - dow);
    else if (event.key === 'PageUp') next = addMonthsClamped(date, -1);
    else if (event.key === 'PageDown') next = addMonthsClamped(date, 1);
    if (next === null) return;
    event.preventDefault();
    if (next.slice(0, 7) !== month.slice(0, 7)) onmonth(`${next.slice(0, 7)}-01`);
    onselect(next);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus();
    });
  }
</script>

<div class="cal">
  <div class="nav">
    <button type="button" class="btn small" onclick={() => move(-1)} aria-label="이전 달">
      <Icon name="icon-chevron-left" />
    </button>
    <strong class="title" aria-live="polite">{title}</strong>
    <button type="button" class="btn small" onclick={() => move(1)} aria-label="다음 달">
      <Icon name="icon-chevron-right" />
    </button>
  </div>

  {#if !holidaysKnown}
    <p class="cap muted note-line">
      {parseYmd(month).y}년 공휴일이 아직 반영되지 않았어요. 이 달력에는 주말만 쉬는 날로 나와요.
    </p>
  {/if}

  <div class="grid" role="grid" aria-label="{title} 달력">
    <div class="week head" role="row">
      {#each WEEKDAYS as name, i (name)}
        <span role="columnheader" class="cap" class:sun={i === 0} class:sat={i === 6}>{name}</span>
      {/each}
    </div>
    {#each { length: cells.length / 7 } as _, week (week)}
      <div class="week" role="row">
        {#each cells.slice(week * 7, week * 7 + 7) as cell, i (cell ? cell.date : `e${week}-${i}`)}
          {#if cell}
            <button
              type="button"
              role="gridcell"
              class="day"
              class:off={cell.off}
              class:holiday={cell.holiday !== null || cell.dow === 0}
              class:sat={cell.dow === 6}
              class:today={cell.today}
              class:selected={cell.selected}
              class:full={cell.hours >= view.rules.leave.units.hoursPerDay}
              class:part={cell.hours > 0 && cell.hours < view.rules.leave.units.hoursPerDay}
              class:planned={cell.planned && cell.hours > 0}
              aria-label={cell.label}
              aria-selected={cell.selected}
              aria-current={cell.today ? 'date' : undefined}
              tabindex={cell.date === rovingDate ? 0 : -1}
              data-date={cell.date}
              onclick={() => onselect(cell.date)}
              onkeydown={(e) => onKey(e, cell.date)}
            >
              <span class="n">{cell.day}</span>
              {#if cell.hours > 0}
                <span class="mark cap" aria-hidden="true">{cell.mark}</span>
              {:else if cell.holiday}
                <span class="mark cap hol" aria-hidden="true">휴</span>
              {/if}
            </button>
          {:else}
            <span class="day empty" role="gridcell" aria-hidden="true"></span>
          {/if}
        {/each}
      </div>
    {/each}
  </div>

  <ul class="legend cap muted">
    <li><i class="sw full"></i> 연가 1일</li>
    <li><i class="sw part"></i> 반일·시간</li>
    <li><i class="sw planned"></i> 빗금: 예정</li>
    <li><span class="sw-hol" aria-hidden="true">휴</span> 빨간 숫자·휴: 공휴일</li>
    <li><i class="sw today"></i> 오늘</li>
  </ul>
  {#if monthHolidays.length > 0}
    <p class="cap muted">이달의 공휴일: {monthHolidays.join(', ')}</p>
  {/if}
</div>

<style>
  .note-line {
    margin: 0 0 6px;
  }
  .cal {
    display: grid;
    gap: 9px;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
  }
  .title {
    font-weight: 400;
  }
  /* 날짜 칸은 폭 44px 이상이어야 손가락으로 누를 수 있다: 칸 사이를 1px 로 줄이고,
     너무 넓어지지 않게 달력 폭은 480px 까지만 쓴다 */
  .cal {
    max-width: 480px;
    width: 100%;
    margin-inline: auto;
  }
  .grid {
    display: grid;
    gap: 1px;
  }
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 1px;
  }
  .head span {
    text-align: center;
    color: var(--ink-2);
  }
  .head .sun,
  .day.holiday .n {
    color: var(--warn);
  }
  .head .sat,
  .day.sat .n {
    color: var(--accent);
  }
  .day {
    position: relative;
    display: grid;
    align-content: start;
    justify-items: center;
    min-height: 48px;
    padding: 3px 0 0;
    border: 0;
    background: var(--panel-2);
    color: var(--ink);
    cursor: pointer;
    touch-action: manipulation;
  }
  .day.empty {
    background: transparent;
    cursor: default;
  }
  .day.off {
    background: transparent;
  }
  .day .n {
    line-height: 21px;
  }
  .mark {
    line-height: 15px;
    color: var(--ink-2);
  }
  .mark.hol {
    color: var(--warn);
  }
  .day.full {
    background: var(--good-fill);
  }
  .day.full .n,
  .day.full .mark {
    color: #1a1c2c;
  }
  .day.part {
    background: linear-gradient(135deg, var(--good-fill) 0 50%, var(--panel-2) 50% 100%);
  }
  /* 반일·시간 칸은 초록과 바탕이 반씩이라, 어두운 테마의 밝은 숫자가 초록 위에서 읽히지 않는다.
     숫자와 표시 밑에 바탕색 상자를 깔아 어느 테마에서나 바탕 위에 놓이게 한다. */
  .day.part .n,
  .day.part .mark {
    padding: 0 3px;
    background: var(--panel-2);
    color: var(--ink);
  }
  .day.part.holiday .n {
    color: var(--warn);
  }
  .day.part.sat .n {
    color: var(--accent);
  }
  /* 예정(오늘 이후)은 빗금으로 구분한다(반일도 같다) */
  .day.planned.full {
    background: repeating-linear-gradient(135deg, var(--good-fill) 0 6px, var(--c5) 6px 9px);
  }
  .day.planned.part {
    background:
      repeating-linear-gradient(135deg, transparent 0 6px, var(--c5) 6px 9px),
      linear-gradient(135deg, var(--good-fill) 0 50%, var(--panel-2) 50% 100%);
  }
  .day.today {
    box-shadow: inset 0 0 0 var(--u) var(--ink);
  }
  .day.selected {
    box-shadow:
      inset 0 0 0 var(--u) var(--accent),
      0 0 0 var(--u) var(--accent);
    z-index: 1;
  }
  .day:focus-visible {
    outline-offset: 2px;
    z-index: 2;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 12px;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 12px;
    height: 12px;
    background: var(--panel-2);
  }
  .sw.full {
    background: var(--good-fill);
  }
  .sw.part {
    background: linear-gradient(135deg, var(--good-fill) 0 50%, var(--panel-2) 50% 100%);
  }
  .sw.planned {
    background: repeating-linear-gradient(135deg, var(--good-fill) 0 4px, var(--c5) 4px 6px);
  }
  /* 공휴일 견본은 실제 칸처럼 빈 바탕에 빨간 '휴' */
  .sw-hol {
    width: 12px;
    line-height: 12px;
    text-align: center;
    color: var(--warn);
  }
  .sw.today {
    box-shadow: inset 0 0 0 var(--u) var(--ink);
  }
</style>
