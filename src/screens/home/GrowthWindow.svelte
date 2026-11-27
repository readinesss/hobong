<script lang="ts">
  import { formatDday, withRo } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { diffDays, formatKorean, type Ymd } from '../../lib/calc/date.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import { isAvailable, type Unavailable } from '../../lib/rules/index.ts';
  import Money from '../../lib/ui/Money.svelte';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const DOT = ' · ';
  /** 공개 설정('홈에 직렬·계급 이름 보이기')을 끄면 계급 이름 대신 쓰는 말 */
  const noun = $derived(view.careerRules.ladder?.noun ?? '계급');
  const rankWord = $derived(view.homeRankLabel ?? `지금 ${noun}`);
  const rankName = (rank: { label: string } | null | undefined) =>
    view.showIdentityHome && rank ? `${rank.label} ` : '';
  /** 바로 위 계급(없으면 null). 이름은 사다리의 이름('6급'·'경감') */
  const nextRank = $derived(view.careerRules.nextRank);
  const c = $derived(view.careerRules);
  /** 계급(직급)이 없는 직종(교원): 승진 계열 대신 안내 */
  const noLadderRank = $derived(c.rank?.hideLabel === true);
  /** 꺼진 승진 계열(준비 중 등). 사유가 같으면 한 줄로 묶는다 */
  const promotionOff = $derived.by(() => {
    if (noLadderRank || view.retired) return [];
    const items: { label: string; off: Unavailable }[] = [];
    if (view.minServiceOff) items.push({ label: '승진소요최저연수', off: view.minServiceOff });
    if (view.longServiceOff) items.push({ label: '근속승진', off: view.longServiceOff });
    if (view.seniorOff) items.push({ label: '대우공무원', off: view.seniorOff });
    const merged: typeof items = [];
    for (const item of items) {
      const same = merged.find(
        (m) => m.off.status === item.off.status && m.off.reason === item.off.reason,
      );
      if (same) same.label = `${same.label}·${item.label}`;
      else merged.push({ ...item });
    }
    return merged;
  });
  /** 근속승진 '할 수 있다' 규정 안내(경찰·해양경찰·소방) */
  /** 공개 설정을 끄면 뺀다(계급 이름 '경감으로의 근속승진은…'을 담는다) */
  const discretionNote = $derived(
    isAvailable(c.longService) && view.showIdentityHome ? (c.longService.discretionNote ?? '') : '',
  );
  const showsPromotion = $derived(
    !view.retired &&
      !noLadderRank &&
      ((view.minService !== null && nextRank !== null) ||
        (view.senior.applicable && view.senior.date !== null) ||
        (view.longService.applicable && view.longService.date !== null)),
  );
  const reached = (date: Ymd) => date <= view.today;
  const yearsOf = (months: number | null) => {
    if (months === null) return '';
    const y = Math.floor(months / 12);
    const m = months % 12;
    return m === 0 ? `${y}년` : `${y}년 ${m}개월`;
  };
</script>

<Win title={noLadderRank ? '성장' : '승급·승진'} icon="icon-stairs" id="growth" area="growth">
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
          입력한 날: {formatKorean(view.profile.nextStepDate)}{view.manualRaiseOverdue
            ? ' · 승급일이 지났어요. 내 정보에서 호봉을 고쳐 주세요.'
            : ''}
        </p>
      {:else if view.noRaiseReason === 'payOff'}
        <p class="cap muted">
          {view.payOff?.status === 'input'
            ? `${view.payOff.reason} 그러면 다음 승급일을 셀 수 있어요.`
            : `봉급표를 정할 수 없어 다음 승급일을 셀 수 없어요. ${view.payOff?.reason ?? ''}`}
        </p>
      {:else}
        <p class="cap muted">
          {view.homeRankLabel ? `${view.homeRankLabel}의 ` : ''}최고호봉({view.maxStep}호봉)이에요.
        </p>
      {/if}
    </li>

    {#if noLadderRank}
      <li id="growth-no-rank">
        <p class="cap muted">
          교원 봉급표에는 직급이 없어 호봉만 올라요. 교감·교장 등 직위는 여기서 계산하지 않아요.
        </p>
      </li>
    {/if}

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
          {formatKorean(view.minService)} · {withRo(rankWord)}
          {yearsOf(view.minServiceMonths)} 재직
        </p>
      </li>
    {/if}

    {#if !view.retired && view.senior.applicable && view.senior.date}
      <li>
        <div class="head">
          <span class="row">
            <Icon name="icon-medal" />
            {rankName(view.senior.targetRank)}대우공무원
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
            {rankName(view.longService.targetRank)}근속승진 요건
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
            : ` · ${withRo(rankWord)} ${yearsOf(view.longService.requiredMonths)} 재직`}
        </p>
        {#if view.promotion && view.promotion.diff !== null}
          <p class="cap muted">
            이때 승진하면 {rankName(view.promotion.toRank)}{view.promotion.toStep}호봉 · 봉급
            <Money
              value={view.promotion.diff}
              sign={view.promotion.diff >= 0 ? '+' : ''}
              approx={!view.promotion.confirmed}
            />{view.promotion.confirmed ? '' : '(지금 봉급표 기준)'}
          </p>
        {:else if view.promotion?.toUnavailableReason}
          <p class="cap muted">{view.promotion.toUnavailableReason}</p>
        {/if}
        {#if view.longService.reviewFrom && !reached(view.longService.date)}
          <p class="cap muted">
            근속승진 심사는 요건일 {diffDays(view.longService.reviewFrom, view.longService.date)}일
            전({formatKorean(view.longService.reviewFrom, false)})부터 할 수 있어요.
          </p>
        {/if}
        <!-- 정원 안내도 계급 이름('경감으로의…')을 담아 공개 설정을 끄면 뺀다 -->
        {#if view.longService.quotaNote && view.showIdentityHome}<p class="cap muted">
            {view.longService.quotaNote}
          </p>{/if}
        {#if discretionNote}<p class="cap muted">{discretionNote}</p>{/if}
      </li>
    {/if}
  </ul>
  {#each promotionOff as item (item.label)}
    <!-- 승진 계열의 '준비 중' 사유는 계급 이름('우정7~9급')을 담으므로 공개 설정을 끄면 사유를 뺀다 -->
    <OffNote
      label={item.label}
      off={view.showIdentityHome ? item.off : { ...item.off, reason: '' }}
    />
  {/each}
  {#if showsPromotion}<p class="note">
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
