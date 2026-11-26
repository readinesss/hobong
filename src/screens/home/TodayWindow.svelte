<script lang="ts">
  import { formatDday, formatNumber } from '../../lib/app/format.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatMonthDay, weekdayName } from '../../lib/calc/date.ts';
  import { formatDuration, formatDurationKo } from '../../lib/calc/today.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Money from '../../lib/ui/Money.svelte';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const status = $derived(view.status);
  const earn = $derived(view.earn);
  const hidden = $derived(view.data.settings.hideAmounts);
  /** 지금 연가 중인지(오전 반차는 오전에만, 오후 반차는 오후에만) — 상태창의 호봉이와 같은 기준 */
  const onLeave = $derived(view.onLeaveNow);
  /** 반차인 날의 꼬리표 */
  const halfTag = $derived(
    view.leaveToday === 'am' ? '오전 반차' : view.leaveToday === 'pm' ? '오후 반차' : '',
  );
  /** 퇴근까지 남은 초: 오후 반차면 반차가 시작하는 때(그날의 퇴근)까지 */
  const secondsToLeave = $derived.by(() => {
    const left = status.secondsToEnd;
    if (left === null) return null;
    if (view.leaveToday !== 'pm') return left;
    return Math.max(0, left - (view.schedule.end - view.halfDaySplit) * 60);
  });
  /** 출근 시각: '9시 출근', '8시 30분 출근' */
  const startLabel = $derived.by(() => {
    const h = Math.floor(view.schedule.start / 60);
    const m = view.schedule.start % 60;
    return m === 0 ? `${h}시 출근` : `${h}시 ${m}분 출근`;
  });

  const headline = $derived.by(() => {
    if (onLeave) return '연가 중';
    switch (status.phase) {
      case 'off':
        return `쉬는 날 (${status.holidayName ?? `${weekdayName(status.date)}요일`})`;
      case 'before':
        return `출근까지 ${formatDurationKo(status.secondsToStart ?? 0)}`;
      case 'lunch':
        return '점심시간';
      case 'after':
        return '오늘 근무 끝';
      default:
        return '근무 중';
    }
  });

  function toggleHide() {
    app.updateSettings({ hideAmounts: !hidden }, false);
  }
</script>

<Win title="오늘" icon="icon-clock" id="today" area="today">
  {#snippet aside()}{formatMonthDay(view.today)}{/snippet}
  <div class="stack wide">
    <div class="stack">
      <div class="row between">
        <span class="muted">오늘 번 돈</span>
        <button
          type="button"
          class="btn small"
          aria-pressed={hidden}
          onclick={toggleHide}
          title="금액 가리기"
        >
          <!-- 이름은 그대로 두고 눌림 상태(aria-pressed)만 바꾼다: 글자·title·상태가 서로 어긋나지 않게 -->
          <Icon name={hidden ? 'icon-eye-off' : 'icon-eye'} />
          <span class="cap">금액 가리기</span>
        </button>
      </div>
      <p class="big earn"><Money value={earn.today} /></p>
      <p class="cap muted">
        이번 달 <Money value={earn.month} />{!hidden && status.workday
          ? ` · 근무 1초에 약 ${earn.perSecond.toFixed(1)}원`
          : ''}
      </p>
    </div>

    <div class="stack">
      <div class="kv">
        <span>
          {headline}
          {#if halfTag}<span class="tag gold">{halfTag}</span>{/if}
        </span>
        {#if onLeave}
          <span>푹 쉬세요</span>
        {:else if status.workday && status.phase === 'before'}
          <span class="num">{startLabel}</span>
        {:else if status.workday && secondsToLeave !== null}
          <span class="num">
            퇴근까지
            <strong>{formatDuration(secondsToLeave)}</strong>
          </span>
        {:else if status.workday}
          <span>수고하셨어요</span>
        {/if}
      </div>
      {#if status.workday && !onLeave}
        <Progress
          value={status.progress}
          label="오늘 근무 진행률"
          valueText="{Math.round(status.progress * 100)}%"
          tone="accent"
          cells={16}
        />
      {/if}
    </div>

    <ul class="cards">
      {#if !view.retired}<li class="well">
          <span class="cap muted row"><Icon name="icon-coin" /> 월급날</span>
          <strong class="num">{formatDday(view.today, view.payday)}</strong>
          <span class="cap muted">
            {formatMonthDay(view.payday)}{view.paydayHolidaysKnown ? '' : ' · 공휴일 반영 전'}
          </span>
        </li>{/if}
      <li class="well">
        <span class="cap muted row"><Icon name="icon-flag" /> 다음 공휴일</span>
        {#if view.nextHoliday}
          <strong class="num">{formatDday(view.today, view.nextHoliday.date)}</strong>
          <span class="cap muted">
            {view.nextHoliday.name} · {formatMonthDay(view.nextHoliday.date)}{view.nextHoliday
              .restDays >= 3
              ? ` · ${view.nextHoliday.restDays}일 연휴`
              : ''}
          </span>
        {:else}
          <strong>-</strong>
          <span class="cap muted">공휴일 데이터가 아직 없어요</span>
        {/if}
      </li>
    </ul>
    <p class="cap muted">
      월 봉급을 이번 달 근무일 {formatNumber(earn.workdays)}일과 하루 근무시간에 나눠 근무시간 동안
      쌓이는 것으로 본 추정치예요.
    </p>
  </div>
</Win>

<style>
  .earn {
    min-height: 36px;
  }
  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
  }
  .cards li {
    display: grid;
    gap: 3px;
    align-content: start;
    min-width: 0;
  }
  .cards strong {
    font-size: 15px;
  }
</style>
