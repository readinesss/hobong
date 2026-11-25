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
  const onLeave = $derived(view.leave.todayHours >= view.rules.leave.units.hoursPerDay);

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
          title={hidden ? '금액 보이기' : '금액 가리기'}
        >
          <Icon name={hidden ? 'icon-eye-off' : 'icon-eye'} />
          <span class="cap">{hidden ? '금액 가림' : '금액 가리기'}</span>
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
        <span>{headline}</span>
        {#if status.workday && status.secondsToEnd !== null}
          <span class="num">퇴근까지 <strong>{formatDuration(status.secondsToEnd)}</strong></span>
        {:else if status.workday}
          <span>수고하셨습니다</span>
        {/if}
      </div>
      {#if status.workday}
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
      <li class="well">
        <span class="cap muted row"><Icon name="icon-coin" /> 월급날</span>
        <strong class="num">{formatDday(view.today, view.payday)}</strong>
        <span class="cap muted">{formatMonthDay(view.payday)}</span>
      </li>
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
