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
  import Icon from '../../lib/ui/Icon.svelte';

  interface Props {
    /** 보고 있는 달의 1일 */
    month: Ymd;
    selected: Ymd;
    onselect: (date: Ymd) => void;
    onmonth: (month: Ymd) => void;
  }

  let { month, selected, onselect, onmonth }: Props = $props();

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const hoursByDate = $derived.by(() => {
    // 매번 새로 만들어 읽기만 하는 표라서 반응형 Map이 필요 없다.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<Ymd, number>();
    for (const r of view.data.leave.records) map.set(r.date, (map.get(r.date) ?? 0) + r.hours);
    return map;
  });

  interface Cell {
    date: Ymd;
    day: number;
    dow: number;
    holiday: string | null;
    off: boolean;
    hours: number;
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
      const hours = hoursByDate.get(date) ?? 0;
      const parts = [formatMonthDay(date)];
      if (holiday) parts.push(holiday);
      if (hours >= perDay) parts.push('연가 1일');
      else if (hours > 0) parts.push(`연가 ${hours}시간`);
      if (date === view.today) parts.push('오늘');
      out.push({
        date,
        day: d,
        dow,
        holiday,
        off: !calendar.isWorkday(date),
        hours,
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
    cells.filter((c): c is Cell => c !== null && c.holiday !== null).map((c) => `${c.day}일 ${c.holiday}`),
  );

  function move(delta: number) {
    onmonth(addMonthsClamped(month, delta));
  }

  /** 방향키로 날짜 이동(달을 넘어가면 달도 넘긴다) */
  function onKey(event: KeyboardEvent, date: Ymd) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDays(date, step);
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
              tabindex={cell.selected ? 0 : -1}
              data-date={cell.date}
              onclick={() => onselect(cell.date)}
              onkeydown={(e) => onKey(e, cell.date)}
            >
              <span class="n">{cell.day}</span>
              {#if cell.hours > 0}
                <span class="mark cap" aria-hidden="true">
                  {cell.hours >= view.rules.leave.units.hoursPerDay ? '연가' : `${cell.hours}h`}
                </span>
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
    <li><i class="sw hol"></i> 공휴일</li>
    <li><i class="sw today"></i> 오늘</li>
  </ul>
  {#if monthHolidays.length > 0}
    <p class="cap muted">이달의 공휴일: {monthHolidays.join(', ')}</p>
  {/if}
</div>

<style>
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
  .grid {
    display: grid;
    gap: 3px;
  }
  .week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
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
  .day.part .mark {
    color: var(--ink);
  }
  /* 예정(오늘 이후)은 빗금으로 구분한다 */
  .day.planned.full {
    background: repeating-linear-gradient(135deg, var(--good-fill) 0 6px, var(--c5) 6px 9px);
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
  .sw.hol {
    background: var(--warn-fill);
  }
  .sw.today {
    box-shadow: inset 0 0 0 var(--u) var(--ink);
  }
</style>
