<script lang="ts">
  import { formatDday, withRo } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean, type Ymd } from '../../lib/calc/date.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Money from '../../lib/ui/Money.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const DOT = ' · ';
  /** 바로 위 계급(없으면 null). 이름은 사다리의 이름('6급'·'경감') */
  const nextRank = $derived(view.careerRules.nextRank);
  const reached = (date: Ymd) => date <= view.today;
  const yearsOf = (months: number | null) => {
    if (months === null) return '';
    const y = Math.floor(months / 12);
    const m = months % 12;
    return m === 0 ? `${y}년` : `${y}년 ${m}개월`;
  };
</script>

<Win title="승급·승진" icon="icon-stairs" id="growth" area="growth">
  <ul class="items">
    <li>
      <div class="head">
        <span class="row"><Icon name="icon-arrow-up" /> 다음 정기승급</span>
        {#if view.nextRaise}<strong class="num">
            {formatDday(view.today, view.nextRaise.date)}
          </strong>{/if}
      </div>
      {#if view.nextRaise}
        <p class="cap muted">
          {formatKorean(view.nextRaise.date)} · {view.nextRaise.fromStep}호봉 → {view.nextRaise
            .toStep}호봉 · 봉급
          <Money value={view.nextRaise.diff} sign="+" />{view.nextRaise.confirmed
            ? ''
            : `(${view.salary?.tableYear ?? view.rules.year}년 봉급표 기준)`}
        </p>
      {:else if view.noRaiseReason === 'retire'}
        <p class="cap muted">정년퇴직일 전에 남은 정기승급이 없어요.</p>
      {:else if view.noRaiseReason === 'manual'}
        <p class="cap muted">
          {formatKorean(view.profile.nextStepDate)}(입력한 날){view.manualRaiseOverdue
            ? ' · 승급일이 지났어요. 내 정보에서 호봉을 고쳐 주세요.'
            : ''}
        </p>
      {:else if view.noRaiseReason === 'payOff'}
        <p class="cap muted">
          봉급표를 정할 수 없어 다음 승급일을 셀 수 없어요. {view.payOff?.reason ?? ''}
        </p>
      {:else}
        <p class="cap muted">{view.rankLabel}의 최고호봉({view.maxStep}호봉)이에요.</p>
      {/if}
    </li>

    <!-- 정년퇴직 뒤에는 승진·대우공무원 요건이 뜻이 없으니 보여 주지 않는다 -->
    {#if !view.retired && view.minService && nextRank}
      <li>
        <div class="head">
          <span class="row"><Icon name="icon-check" /> 승진소요최저연수</span>
          <strong class="num">
            {reached(view.minService) ? '충족' : formatDday(view.today, view.minService)}
          </strong>
        </div>
        <p class="cap muted">
          {formatKorean(view.minService)} · {withRo(view.rankLabel)}
          {yearsOf(view.minServiceMonths)} 재직
        </p>
      </li>
    {/if}

    {#if !view.retired && view.senior.applicable && view.senior.date}
      <li>
        <div class="head">
          <span class="row">
            <Icon name="icon-medal" />
            {view.senior.targetRank?.label ?? ''} 대우공무원
          </span>
          <strong class="num">
            {reached(view.senior.date) ? '요건 충족' : formatDday(view.today, view.senior.date)}
          </strong>
        </div>
        <p class="cap muted">
          {formatKorean(view.senior.date)}{view.senior.overridden
            ? ' (직접 입력)'
            : ` · ${yearsOf(view.senior.requiredMonths)} 근무 뒤 처음 오는 1일`}
          {#if view.seniorAllowance !== null}{DOT}선발되면 수당 월 <Money
              value={view.seniorAllowance}
              approx
            />{/if}
        </p>
      </li>
    {/if}

    {#if !view.retired && view.longService.applicable && view.longService.date}
      <li>
        <div class="head">
          <span class="row">
            <Icon name="icon-stairs" />
            {view.longService.targetRank?.label ?? ''} 근속승진 요건
          </span>
          <strong class="num">
            {reached(view.longService.date)
              ? '요건 충족'
              : formatDday(view.today, view.longService.date)}
          </strong>
        </div>
        <p class="cap muted">
          {formatKorean(view.longService.date)}{view.longService.overridden
            ? ' (직접 입력)'
            : ` · ${withRo(view.rankLabel)} ${yearsOf(view.longService.requiredMonths)} 재직`}
        </p>
        {#if view.promotion && view.promotion.diff !== null}
          <p class="cap muted">
            이때 승진하면 {view.promotion.toRank.label}
            {view.promotion.toStep}호봉 · 봉급
            <Money
              value={view.promotion.diff}
              sign={view.promotion.diff >= 0 ? '+' : ''}
              approx={!view.promotion.confirmed}
            />{view.promotion.confirmed ? '' : '(지금 봉급표 기준)'}
          </p>
        {:else if view.promotion?.toUnavailableReason}
          <p class="cap muted">{view.promotion.toUnavailableReason}</p>
        {/if}
        {#if view.longService.quotaNote}<p class="cap muted">{view.longService.quotaNote}</p>{/if}
      </li>
    {/if}
  </ul>
  {#if !view.retired}<p class="note">
      요건을 채우는 날이며 실제 승진·선발은 심사와 명부에 따라 달라요. 휴직·징계 기간은 반영하지
      않았으니, 해당하면 설정 &gt; 내 정보에서 날짜를 직접 넣어 주세요.
    </p>{/if}
</Win>

<style>
  .items {
    display: grid;
    gap: 12px;
  }
  .items li {
    display: grid;
    gap: 3px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
  }
</style>
