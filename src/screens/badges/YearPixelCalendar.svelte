<script lang="ts">
  /**
   * 한 해를 하루 한 칸으로 보는 도트 달력(달 12줄 × 1~31일).
   * 칸은 그림(role="img")이라 낭독기는 요약 한 줄을 읽고, 날짜별 내용은 아래 '달마다 글로 보기'에 글로 둔다.
   * 칸마다 버튼을 두지 않는다(366개라 무겁고, 고를 일이 없다). 마우스로는 칸의 title 로 날짜를 볼 수 있다.
   */
  import { formatKorean, formatMonthDay } from '../../lib/calc/date.ts';
  import { formatLeaveHours } from '../../lib/calc/leave.ts';
  import { monthSummaries, type YearDay } from '../../lib/calc/recap.ts';

  interface Props {
    grid: readonly YearDay[];
    year: number;
    hoursPerDay: number;
    /** 그 해 공휴일 데이터가 있는지 */
    holidaysKnown: boolean;
  }

  let { grid, year, hoursPerDay, holidaysKnown }: Props = $props();

  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  /** 위쪽 날짜 눈금(그 칸에서 시작해 옆 칸까지 걸쳐 쓴다) */
  const TICKS = [
    { day: 1, span: 3 },
    { day: 10, span: 3 },
    { day: 20, span: 3 },
    { day: 30, span: 2 },
  ];

  const months = $derived(monthSummaries(grid, hoursPerDay));

  function cellClass(d: YearDay): string {
    const out = ['cell'];
    if (d.outside) out.push('out');
    else if (d.holiday) out.push('hol');
    else if (d.weekend) out.push('we');
    if (d.leave === 'full') out.push('full');
    else if (d.leave === 'am') out.push('am');
    else if (d.leave === 'pm') out.push('pm');
    else if (d.leave === 'hours') out.push('hrs');
    if (d.visited) out.push('v');
    if (d.raise) out.push('raise');
    if (d.future) out.push('fut');
    if (d.today) out.push('today');
    return out.join(' ');
  }

  /** 마우스용 날짜 이름: '2026. 10. 3. (토), 공휴일 개천절, 연가 1일, 들른 날' */
  function cellTitle(d: YearDay): string {
    const parts = [formatKorean(d.date)];
    if (d.holiday) parts.push(`공휴일 ${d.holiday}`);
    if (d.leave === 'full') parts.push('연가 1일');
    else if (d.leave === 'am') parts.push('연가 오전 반일');
    else if (d.leave === 'pm') parts.push('연가 오후 반일');
    else if (d.leave === 'hours') parts.push(`연가 ${d.hours}시간`);
    if (d.planned) parts.push('예정');
    if (d.visited) parts.push('들른 날');
    if (d.raise) parts.push('승급한 날');
    if (d.today) parts.push('오늘');
    if (d.outside) parts.push('재직 기간 밖');
    return parts.join(', ');
  }

  const summary = $derived.by(() => {
    const visits = grid.filter((d) => d.visited).length;
    const used = grid.reduce((sum, d) => sum + (d.leave && !d.planned ? d.hours : 0), 0);
    const planned = grid.reduce((sum, d) => sum + (d.planned ? d.hours : 0), 0);
    const holidays = grid.filter((d) => d.holiday !== null).length;
    const raises = grid.filter((d) => d.raise).map((d) => `${formatMonthDay(d.date, false)} 승급`);
    const today = grid.find((d) => d.today);
    const parts = [
      `들른 날 ${visits}일`,
      `연가 ${formatLeaveHours(used, hoursPerDay)}${planned > 0 ? `(예정 ${formatLeaveHours(planned, hoursPerDay)} 따로)` : ''}`,
      holidaysKnown ? `공휴일 ${holidays}일` : '공휴일 데이터 없음',
      ...raises,
      ...(today ? [`오늘 ${formatMonthDay(today.date, false)}`] : []),
    ];
    return `${year}년 달력. ${parts.join(', ')}`;
  });

  function monthText(m: (typeof months)[number]): string {
    const parts: string[] = [];
    if (m.visits > 0) parts.push(`들른 날 ${m.visits}일`);
    if (m.leaveText) parts.push(m.leaveText);
    if (m.holidays.length > 0) parts.push(`공휴일 ${m.holidays.join(', ')}`);
    if (m.raise) parts.push(`${formatMonthDay(m.raise, false)} 승급`);
    return parts.length > 0 ? parts.join(' · ') : '기록 없음';
  }

  const hasRaise = $derived(grid.some((d) => d.raise));
  const hasOutside = $derived(grid.some((d) => d.outside));
</script>

<div class="yearcal">
  <div class="grid" role="img" aria-label={summary}>
    <span class="corner"></span>
    {#each TICKS as tick (tick.day)}
      <span class="tick cap" style="grid-column:{tick.day + 1} / span {tick.span}">{tick.day}</span>
    {/each}
    {#each MONTHS as m (m)}
      <span class="mname cap">{m}월</span>
      {#each grid.filter((d) => d.month === m) as d (d.date)}
        <i class={cellClass(d)} title={cellTitle(d)}></i>
      {/each}
    {/each}
  </div>

  <ul class="legend cap" aria-hidden="true">
    <li><i class="cell v"></i>들른 날</li>
    <li><i class="cell full"></i>연가 하루</li>
    <li><i class="cell am"></i><i class="cell pm"></i>반일(위 오전·아래 오후)</li>
    <li><i class="cell hrs"></i>시간 연가</li>
    <li><i class="cell hol"></i>공휴일</li>
    <li><i class="cell we"></i>주말</li>
    {#if hasRaise}<li><i class="cell raise"></i>승급한 날</li>{/if}
    <li><i class="cell today"></i>오늘</li>
    <li><i class="cell fut"></i>흐린 칸: 아직 오지 않은 날</li>
    {#if hasOutside}<li><i class="cell out"></i>빈칸: 재직 기간 밖</li>{/if}
  </ul>

  <details class="months">
    <summary class="btn small">달마다 글로 보기</summary>
    <ul class="cap">
      {#each months as m (m.month)}
        <li><strong>{m.month}월</strong> {monthText(m)}</li>
      {/each}
    </ul>
  </details>
</div>

<style>
  .yearcal {
    container-type: inline-size;
    display: grid;
    gap: 9px;
    min-width: 0;
  }
  /* 칸 크기는 창 폭에 맞춰 정수 px 로만 바꾼다(가로 간격 2px, 달 사이 간격은 이름표가 들어가게 더 넓게) */
  .grid {
    --c: 6px;
    --dot: 2px;
    --half: 3px;
    --cg: 2px;
    --rg: 6px;
    display: grid;
    grid-template-columns: max-content repeat(31, var(--c));
    column-gap: var(--cg);
    row-gap: var(--rg);
    align-items: center;
    justify-content: start;
  }
  @container (min-width: 300px) {
    .grid {
      --c: 7px;
      --dot: 3px;
      --half: 3px;
      --rg: 5px;
    }
  }
  @container (min-width: 400px) {
    .grid {
      --c: 10px;
      --dot: 4px;
      --half: 5px;
      --rg: 3px;
    }
  }
  .corner {
    grid-column: 1;
  }
  .tick {
    color: var(--ink-2);
    line-height: 12px;
    white-space: nowrap;
    overflow: visible;
    width: var(--c);
  }
  .mname {
    grid-column: 1;
    padding-right: 3px;
    line-height: 12px;
    color: var(--ink-2);
    text-align: right;
  }
  .cell {
    position: relative;
    display: block;
    width: var(--c);
    height: var(--c);
    background: color-mix(in srgb, var(--ink-2) 24%, var(--panel));
  }
  .cell.we {
    background: color-mix(in srgb, var(--ink-2) 10%, var(--panel));
  }
  .cell.hol {
    background: color-mix(in srgb, var(--ink-2) 60%, var(--panel));
  }
  .cell.out {
    background: transparent;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-2) 30%, transparent);
  }
  .cell.full {
    background: var(--good-fill);
  }
  .cell.am {
    background-image: linear-gradient(var(--good-fill) 0 var(--half), transparent var(--half));
  }
  .cell.pm {
    background-image: linear-gradient(
      transparent calc(var(--c) - var(--half)),
      var(--good-fill) calc(var(--c) - var(--half))
    );
  }
  .cell.hrs {
    box-shadow: inset 0 0 0 2px var(--good-fill);
  }
  /* 출근 도장: 칸 가운데의 작은 네모(연가 바탕과 겹쳐도 보인다) */
  .cell.v::after {
    content: '';
    position: absolute;
    inset: calc((var(--c) - var(--dot)) / 2);
    /* 어두운 테마에서는 밝은 산호색(--warn)이라 어두운 칸 위에서도 보인다 */
    background: var(--warn);
  }
  .cell.raise {
    outline: 2px solid var(--accent);
    outline-offset: 0;
    z-index: 1;
  }
  .cell.today {
    outline: 2px solid var(--ink);
    outline-offset: 0;
    z-index: 2;
  }
  .cell.fut {
    opacity: 0.45;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 12px;
    color: var(--ink-2);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .legend .cell {
    --c: 10px;
    --dot: 4px;
    --half: 5px;
    flex: none;
  }
  .legend .cell + .cell {
    margin-left: -3px;
  }
  .months summary {
    list-style: none;
    width: fit-content;
  }
  .months summary::-webkit-details-marker {
    display: none;
  }
  .months ul {
    display: grid;
    gap: 3px;
    margin-top: 9px;
  }
  .months strong {
    font-weight: 400;
    color: var(--ink);
    margin-right: 3px;
  }
  /* 고대비: 색을 직접 정하고(칸 테두리·채움), 범례 글과 '달마다 글로 보기'로 색에만 기대지 않는다 */
  @media (forced-colors: active) {
    .grid,
    .legend {
      forced-color-adjust: none;
    }
    .cell {
      background: Canvas;
      box-shadow: inset 0 0 0 1px CanvasText;
    }
    .cell.we {
      background: Canvas;
      box-shadow: inset 0 0 0 1px GrayText;
    }
    .cell.hol {
      background: GrayText;
    }
    .cell.out {
      background: Canvas;
      box-shadow: none;
    }
    .cell.full {
      background: CanvasText;
    }
    .cell.am {
      background-image: linear-gradient(CanvasText 0 var(--half), transparent var(--half));
    }
    .cell.pm {
      background-image: linear-gradient(
        transparent calc(var(--c) - var(--half)),
        CanvasText calc(var(--c) - var(--half))
      );
    }
    .cell.hrs {
      box-shadow: inset 0 0 0 2px CanvasText;
    }
    .cell.v::after {
      background: Highlight;
    }
    .cell.raise {
      outline-color: LinkText;
    }
    .cell.today {
      outline-color: CanvasText;
    }
  }
</style>
