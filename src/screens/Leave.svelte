<script lang="ts">
  import { untrack } from 'svelte';
  import { busiestMonthText, formatWon, MASKED_WON } from '../lib/app/format.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { calendar, view } from '../lib/app/view.svelte.ts';
  import {
    addDays,
    formatKorean,
    formatMonthDay,
    parseYmd,
    startOfMonth,
    weekdayName,
    yearOf,
    type Ymd,
  } from '../lib/calc/date.ts';
  import {
    checkNewLeave,
    formatLeaveHours,
    hoursOfKind,
    kindLabel,
    recordsOfYear,
    workdaysInRange,
  } from '../lib/calc/leave.ts';
  import { LIMITS, type LeaveKind } from '../lib/store/schema.ts';
  import DateInput from '../lib/ui/DateInput.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Progress from '../lib/ui/Progress.svelte';
  import Stepper from '../lib/ui/Stepper.svelte';
  import Win from '../lib/ui/Win.svelte';
  import LeaveCalendar from './leave/LeaveCalendar.svelte';

  const leave = $derived(view.leave);
  const hpd = $derived(leave.hoursPerDay);
  const rules = $derived(view.rules.leave);

  function firstWorkdayFrom(date: Ymd): Ymd {
    let cur = date;
    for (let i = 0; i < 14 && !calendar.isWorkday(cur); i += 1) cur = addDays(cur, 1);
    return cur;
  }

  let selected = $state<Ymd>(untrack(() => firstWorkdayFrom(view.today)));
  let month = $state<Ymd>(untrack(() => startOfMonth(firstWorkdayFrom(view.today))));
  let hours = $state(2);
  let memo = $state('');
  let message = $state('');
  let showGrant = $state(false);
  let showRange = $state(false);
  let entryEl = $state<HTMLElement>();

  const selectedIsWorkday = $derived(calendar.isWorkday(selected));
  const selectedHoliday = $derived(calendar.holidayName(selected));
  const todayIsWorkday = $derived(calendar.isWorkday(view.today));
  const selectedHours = $derived(
    view.data.leave.records.filter((r) => r.date === selected).reduce((sum, r) => sum + r.hours, 0),
  );
  const listYear = $derived(yearOf(month));
  const yearRecords = $derived([...recordsOfYear(view.data.leave.records, listYear)].reverse());
  const maxMonthHours = $derived(Math.max(hpd, ...leave.byMonth));

  function select(date: Ymd) {
    selected = date;
    message = '';
    if (date.slice(0, 7) !== month.slice(0, 7)) month = startOfMonth(date);
  }

  function add(kind: LeaveKind) {
    const entry = { date: selected, kind, hours: kind === 'hours' ? hours : 0 };
    const problem = checkNewLeave(
      rules,
      calendar,
      view.data.leave.records,
      view.profile.hireDate,
      entry,
    );
    if (problem) {
      message = problem;
      return;
    }
    message = '';
    const amount = hoursOfKind(rules, kind, hours);
    const before = new Set(view.data.leave.records.map((r) => r.id));
    app.addLeave([{ date: selected, kind, hours: amount, memo }]);
    const added = view.data.leave.records.filter((r) => !before.has(r.id)).map((r) => r.id);
    memo = '';
    app.toast(
      `${formatMonthDay(selected)} ${kindLabel(kind, amount)} 연가를 ${selected > view.today ? '예정으로 ' : ''}기록했어요.`,
      'good',
      'icon-palm',
      6000,
      { label: '되돌리기', run: () => added.forEach((id) => app.removeLeave(id)) },
    );
  }

  function remove(id: string) {
    const removed = app.removeLeave(id);
    if (!removed) return;
    app.toast(`${formatMonthDay(removed.date)} 기록을 지웠어요.`, 'info', 'icon-trash', 6000, {
      label: '되돌리기',
      run: () => app.restoreLeave(removed),
    });
  }

  // ── 부여 일수 직접 수정 ──────────────────────────────────────────────
  let grantDays = $state(0);
  let grantHours = $state(0);
  function openGrant() {
    grantDays = Math.floor(leave.grantedHours / hpd);
    grantHours = leave.grantedHours % hpd;
    showGrant = true;
  }
  function saveGrant() {
    app.setGrantOverride(leave.year, grantDays * hpd + grantHours);
    showGrant = false;
    app.toast('올해 부여 일수를 고쳤어요.', 'good', 'icon-pencil');
  }
  function resetGrant() {
    app.setGrantOverride(leave.year, null);
    showGrant = false;
    app.toast('재직기간으로 자동 계산하도록 되돌렸어요.', 'info', 'icon-undo');
  }

  // ── 여러 날 한꺼번에 ─────────────────────────────────────────────────
  let rangeFrom = $state<Ymd | ''>('');
  let rangeTo = $state<Ymd | ''>('');
  const rangeDays = $derived.by(() => {
    if (!rangeFrom || !rangeTo || rangeTo < rangeFrom) return [];
    const taken = new Set(view.data.leave.records.map((r) => r.date));
    return workdaysInRange(calendar, rangeFrom, rangeTo).filter(
      (d) => !taken.has(d) && d >= view.profile.hireDate,
    );
  });
  function openRange() {
    rangeFrom = selected;
    rangeTo = selected;
    showRange = true;
  }
  function saveRange() {
    const days = rangeDays;
    if (days.length === 0) return;
    const before = new Set(view.data.leave.records.map((r) => r.id));
    app.addLeave(days.map((date) => ({ date, kind: 'day' as const, hours: hpd, memo })));
    const added = view.data.leave.records.filter((r) => !before.has(r.id)).map((r) => r.id);
    showRange = false;
    memo = '';
    select(days[0] as Ymd);
    app.toast(`${days.length}일 연가를 기록했어요.`, 'good', 'icon-palm', 6000, {
      label: '되돌리기',
      run: () => added.forEach((id) => app.removeLeave(id)),
    });
  }

  function pickBridge(dates: Ymd[]) {
    select(dates[0] as Ymd);
    entryEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  const bridges = $derived(view.bridges.slice(0, 4));
  const selParts = $derived(parseYmd(selected));
</script>

<div class="page">
  <div class="col">
    <Win title="올해 연가" icon="icon-palm" id="leave-summary" area="summary">
      {#snippet aside()}{leave.year}년{/snippet}
      <div class="stack wide">
        <div class="kv">
          <span>남은 연가</span>
          <strong class="big" class:warn={leave.remainingHours < 0}>
            {formatLeaveHours(leave.remainingHours, hpd)}
          </strong>
        </div>
        <Progress
          value={leave.rate}
          label="올해 연가 사용률"
          valueText="{Math.round(leave.rate * 100)}% 사용"
          cells={Math.max(4, Math.min(24, Math.round(leave.grantedHours / hpd)))}
        />
        <dl class="stack">
          <div class="kv">
            <dt>부여</dt>
            <dd>
              {formatLeaveHours(leave.grantedHours, hpd)}
              <span class="cap muted">
                {leave.overridden ? '(직접 수정)' : '(재직기간으로 계산)'}
              </span>
            </dd>
          </div>
          <div class="kv">
            <dt>사용</dt>
            <dd>
              {formatLeaveHours(leave.usedHours, hpd)}
              {#if leave.plannedHours > 0}<span class="cap muted">
                  (예정 {formatLeaveHours(leave.plannedHours, hpd)} 포함)
                </span>{/if}
            </dd>
          </div>
          <div class="kv">
            <dt>사용률</dt>
            <dd class="num">{Math.round(leave.rate * 100)}%</dd>
          </div>
        </dl>
        {#if leave.nextChange}
          <p class="note">
            {formatKorean(leave.nextChange.date)}부터 재직기간이 늘어 올해 연가가 {formatLeaveHours(
              leave.nextChange.hours,
              hpd,
            )}로 늘어요.
          </p>
        {/if}
        {#if leave.grantedHours === 0 && !leave.overridden}
          <p class="note">임용 후 1개월이 지나면 연가가 생겨요.</p>
        {/if}
        {#if leave.remainingHours < 0}
          <p class="note warn">
            부여된 연가보다 많이 썼어요. 다음 재직기간의 연가를 미리 쓰는 한도는 지금 {view.advanceLimit}일이에요(복무규정
            제16조).
          </p>
        {/if}
        <div class="btn-row">
          <button type="button" class="btn small" onclick={openGrant}>
            <Icon name="icon-pencil" /> 부여 일수 고치기
          </button>
        </div>
        <p class="cap muted">가산·저축·이월 연가가 있으면 부여 일수를 직접 고쳐 주세요.</p>
      </div>
    </Win>

    <section
      class="win"
      id="leave-entry"
      style="grid-area:entry"
      bind:this={entryEl}
      aria-labelledby="leave-entry-title"
    >
      <header class="win-title">
        <Icon name="icon-plus" />
        <h2 id="leave-entry-title">연가 기록하기</h2>
      </header>
      <div class="win-body stack wide">
        <div class="picked">
          <span class="muted">고른 날</span>
          <strong>{selParts.m}월 {selParts.d}일 ({weekdayName(selected)})</strong>
          {#if selected === view.today}<span class="tag blue">
              오늘
            </span>{:else if selected > view.today}<span class="tag">예정</span>{/if}
          {#if selectedHours > 0}<span class="tag gold">
              {formatLeaveHours(selectedHours, hpd)} 기록됨
            </span>{/if}
        </div>
        {#if !selectedIsWorkday}
          <p class="note">
            {selectedHoliday
              ? `이날은 공휴일(${selectedHoliday})이라`
              : `이날은 ${weekdayName(selected)}요일이라`} 연가를 쓰지 않아도 돼요. 아래 달력에서 다른
            날을 골라 주세요.
          </p>
        {:else if !calendar.hasHolidayData(selParts.y)}
          <p class="note">
            {selParts.y}년 공휴일이 아직 반영되지 않아, 이날이 공휴일인지는 확인하지 못했어요.
          </p>
        {/if}
        <div class="units">
          <button
            type="button"
            class="btn primary"
            onclick={() => add('day')}
            disabled={!selectedIsWorkday}
          >
            1일
          </button>
          <button type="button" class="btn" onclick={() => add('am')} disabled={!selectedIsWorkday}>
            오전 반일
          </button>
          <button type="button" class="btn" onclick={() => add('pm')} disabled={!selectedIsWorkday}>
            오후 반일
          </button>
        </div>
        <div class="hours">
          <Stepper
            id="leave-hours"
            label="시간 연가"
            bind:value={hours}
            min={1}
            max={hpd - 1}
            unit="시간"
          />
          <button
            type="button"
            class="btn"
            onclick={() => add('hours')}
            disabled={!selectedIsWorkday}
          >
            {hours}시간 기록
          </button>
        </div>
        <div class="field">
          <label for="leave-memo">메모 <span class="cap muted">선택</span></label>
          <input
            id="leave-memo"
            class="input"
            type="text"
            maxlength={LIMITS.memoMax}
            autocomplete="off"
            placeholder="예: 가족 여행"
            bind:value={memo}
            aria-describedby="leave-memo-hint"
          />
          <span class="hint cap" id="leave-memo-hint">
            이름이나 민감한 내용은 적지 마세요. 백업 파일에 그대로 담겨요.
          </span>
        </div>
        {#if message}<p class="note warn" role="alert">{message}</p>{/if}
        <div class="btn-row">
          <button
            type="button"
            class="btn small"
            onclick={() => select(firstWorkdayFrom(view.today))}
          >
            {todayIsWorkday ? '오늘로' : '가까운 근무일로'}
          </button>
          <button type="button" class="btn small" onclick={openRange}>
            <Icon name="icon-calendar" /> 여러 날 한꺼번에
          </button>
        </div>
      </div>
    </section>
  </div>
  <div class="col">
    <Win title="달력" icon="icon-calendar" id="leave-calendar" area="calendar">
      <LeaveCalendar {month} {selected} onselect={select} onmonth={(m) => (month = m)} />
      {#if listYear !== leave.year}
        <p class="note">
          {listYear}년 날짜의 기록은 {listYear}년 장부에 들어가요. 위의 남은 연가는 {leave.year}년
          기준이에요.
        </p>
      {/if}
    </Win>

    <Win title="징검다리 찾기" icon="icon-bridge" id="leave-bridges" area="bridges">
      {#if bridges.length === 0}
        <p class="muted">가까운 징검다리 연휴가 없어요.</p>
      {:else}
        <ul class="bridges">
          {#each bridges as bridge (bridge.leaveDates.join())}
            <li class="well">
              <div class="kv">
                <strong>{bridge.totalDays}일 연휴</strong>
                <span class="cap muted">
                  {formatMonthDay(bridge.from)} ~ {formatMonthDay(bridge.to)}
                </span>
              </div>
              <p class="cap muted">
                {bridge.leaveDates.map((d) => formatMonthDay(d)).join(', ')}에 연가 {bridge
                  .leaveDates.length}일 · {bridge.holidayNames.join(', ')}
              </p>
              {#if bridge.alreadyTaken}
                <span class="tag gold">이미 기록함</span>
              {:else}
                <button
                  type="button"
                  class="btn small"
                  onclick={() => pickBridge(bridge.leaveDates)}
                >
                  이 날 고르기
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <p class="cap muted">공휴일과 주말 사이에 낀 평일(1~2일)을 찾아요.</p>
    </Win>
  </div>
  <div class="col c3">
    <Win title="기록" icon="icon-document" id="leave-records" area="records">
      {#snippet aside()}{listYear}년 · {yearRecords.length}건{/snippet}
      {#if yearRecords.length === 0}
        <p class="muted">
          {listYear}년 기록이 아직 없어요. 달력에서 날짜를 고르고 "1일"을 눌러 보세요.
        </p>
      {:else}
        <ul class="records">
          {#each yearRecords as record (record.id)}
            <li>
              <div class="grow stack">
                <span>
                  {formatKorean(record.date)}
                  {#if record.date > view.today}<span class="tag">예정</span>{/if}
                </span>
                <span class="cap muted">
                  {kindLabel(record.kind, record.hours)}{record.memo ? ` · ${record.memo}` : ''}
                </span>
              </div>
              <button
                type="button"
                class="btn small"
                onclick={() => remove(record.id)}
                aria-label="{formatMonthDay(record.date)} 기록 지우기"
              >
                <Icon name="icon-trash" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </Win>

    <Win title="월별 사용" icon="icon-list" id="leave-months" area="months">
      {#snippet aside()}{leave.year}년{/snippet}
      <div
        class="months"
        role="img"
        aria-label="월별 연가 사용. {leave.byMonth
          .map((h, i) => `${i + 1}월 ${formatLeaveHours(h, hpd)}`)
          .join(', ')}"
      >
        {#each leave.byMonth as h, i (i)}
          <div class="m">
            <span class="cap val">
              {h > 0 ? (h % hpd === 0 ? h / hpd : (h / hpd).toFixed(1)) : ''}
            </span>
            <i style="height:{Math.round((h / maxMonthHours) * 60)}px" class:zero={h === 0}></i>
            <span class="cap muted">{i + 1}</span>
          </div>
        {/each}
      </div>
      <p class="cap muted">
        {busiestMonthText(leave.byMonth)}
      </p>
    </Win>
  </div>
  <section class="about">
    <p class="note">
      공식 인사시스템(e-사람 등)의 기록이 기준이며 이 장부는 참고용이에요. 연가 일수는
      재직기간으로만 계산하고(복무규정 제15조), 휴직·결근 공제와 병가·공가·특별휴가는 다루지 않아요.
      {#if view.leaveProrated}
        올해는 정년퇴직하는 해라 퇴직일까지 근무하는 개월 수만큼만 계산했어요(제17조제2항).
      {/if}
    </p>
    <p class="note">
      연가보상비 1일 단가: {view.data.settings.hideAmounts
        ? MASKED_WON
        : `약 ${formatWon(view.leaveDayPrice)}`} (월 봉급 × {Math.round(
        rules.compensation.rate * 100,
      )}% ÷
      {rules.compensation.divisor}, 수당규정 제18조의5). 보상 일수와 지급 여부는 권장연가 등 기관
      방침에 따라 달라요(최대 {rules.compensation.maxDays}일).
    </p>
  </section>
</div>

{#if showGrant}
  <Modal title="올해 부여 일수 고치기" icon="icon-pencil" onclose={() => (showGrant = false)}>
    <div class="stack wide">
      <p>
        가산 연가, 저축·이월 연가, 휴직에 따른 공제처럼 계산으로 알 수 없는 사정이 있으면 e-사람에
        나온 일수를 그대로 넣어 주세요.
      </p>
      <div class="grant">
        <Stepper id="grant-days" label="일" bind:value={grantDays} min={0} max={60} unit="일" />
        <Stepper
          id="grant-hours"
          label="시간"
          bind:value={grantHours}
          min={0}
          max={hpd - 1}
          unit="시간"
        />
      </div>
      <p class="cap muted">재직기간으로 계산한 값: {formatLeaveHours(leave.autoHours, hpd)}</p>
    </div>
    {#snippet actions()}
      {#if leave.overridden}
        <button type="button" class="btn" onclick={resetGrant}>자동 계산으로 되돌리기</button>
      {/if}
      <button type="button" class="btn primary" data-autofocus onclick={saveGrant}>저장</button>
    {/snippet}
  </Modal>
{/if}

{#if showRange}
  <Modal title="여러 날 한꺼번에" icon="icon-calendar" onclose={() => (showRange = false)}>
    <div class="stack wide">
      <DateInput id="range-from" label="첫날" bind:value={rangeFrom} />
      <DateInput
        id="range-to"
        label="마지막 날"
        bind:value={rangeTo}
        min={rangeFrom || undefined}
      />
      {#if rangeFrom && rangeTo && rangeTo < rangeFrom}
        <p class="note warn" role="alert">마지막 날이 첫날보다 앞이에요.</p>
      {:else if rangeFrom && rangeTo}
        <p class="note">
          토요일·일요일·공휴일과 이미 기록한 날은 빼고 <strong>{rangeDays.length}일</strong>을 1일
          연가로 기록해요.
        </p>
      {/if}
    </div>
    {#snippet actions()}
      <button type="button" class="btn" onclick={() => (showRange = false)}>취소</button>
      <button
        type="button"
        class="btn primary"
        onclick={saveRange}
        disabled={rangeDays.length === 0}
      >
        {rangeDays.length}일 기록
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .page {
    display: grid;
    gap: 9px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'summary'
      'entry'
      'calendar'
      'records'
      'months'
      'bridges'
      'about';
    align-items: start;
  }
  dl,
  dt,
  dd {
    margin: 0;
  }
  .picked {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .units {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 3px;
  }
  .units .btn {
    min-height: 54px;
    padding-left: 3px;
    padding-right: 3px;
  }
  .hours {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 9px;
  }
  .grant {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .months {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 3px;
    align-items: end;
    min-height: 102px;
  }
  .m {
    display: grid;
    justify-items: center;
    align-content: end;
    gap: 3px;
    height: 100%;
  }
  .m i {
    width: 100%;
    max-width: 24px;
    min-height: 3px;
    background: var(--good-fill);
    box-shadow: inset 0 3px 0 0 rgba(255, 255, 255, 0.28);
  }
  .m i.zero {
    background: var(--panel-2);
    box-shadow: none;
  }
  .val {
    min-height: 18px;
  }
  .records {
    display: grid;
    gap: 3px;
    max-height: 420px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .records li {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 3px 6px 9px;
    background: var(--panel-2);
  }
  .bridges {
    display: grid;
    gap: 9px;
    margin-bottom: 9px;
  }
  .bridges li {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .bridges .kv {
    width: 100%;
  }
  .about {
    grid-area: about;
    display: grid;
    gap: 9px;
  }
  .col {
    display: contents;
  }
  @media (min-width: 720px) {
    .page {
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas: none;
    }
    .col {
      display: grid;
      gap: 12px;
      min-width: 0;
      align-content: start;
    }
    .col :global(.win) {
      grid-area: auto !important;
    }
    .c3 {
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
    .about {
      grid-area: auto;
      grid-column: 1 / -1;
    }
  }
  @media (min-width: 1100px) {
    .page {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr);
    }
    .c3 {
      grid-column: auto;
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
