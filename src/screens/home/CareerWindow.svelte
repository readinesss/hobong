<script lang="ts">
  import { formatLongDate, formatNumber, formatSpan } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean, spanBetween } from '../../lib/calc/date.ts';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  // 째깍이는 연출로 소수 다섯 자리까지 보이되, 낭독은 정수 %로 한다
  const percent = $derived((view.careerRatio * 100).toFixed(5));
  const percentSpoken = $derived(`${Math.floor(view.careerRatio * 100)}%`);
</script>

<Win title="정년까지의 길" icon="icon-flag" id="career" area="career">
  {#if view.retire && view.career}
    {@const retire = view.retire}
    {@const career = view.career}
    <div class="stack wide">
      <div class="stack">
        <div class="kv">
          <span>임용에서 정년까지</span>
          <strong class="num" aria-hidden="true">{percent}%</strong>
          <span class="sr-only">{percentSpoken}</span>
        </div>
        <Progress
          value={view.careerRatio}
          label="임용부터 정년까지의 진행률"
          valueText={percentSpoken}
          tone="gold"
        />
      </div>
      <dl class="stack">
        <div class="kv">
          <dt>정년퇴직일</dt>
          <dd>
            {formatKorean(retire.retireDate, false)}{#if career.retired}
              · <strong>퇴직</strong>{/if}
          </dd>
        </div>
        <div class="kv">
          <dt>재직</dt>
          <dd>
            {formatNumber(career.daysServed)}일째
            <span class="cap muted">({formatSpan(view.tenure)})</span>
          </dd>
        </div>
        <div class="kv">
          <dt>남은 날</dt>
          <dd class="num">
            {formatNumber(career.daysLeft)}일
            {#if !career.retired}<span class="cap muted">
                ({formatSpan(spanBetween(view.today, retire.retireDate))})
              </span>{/if}
          </dd>
        </div>
      </dl>
      <p class="cap muted">
        정년 {retire.age}세가 되는 날({formatKorean(retire.reachDate, false)})이 {retire.periodText}에
        퇴직해요({retire.basis}).
      </p>
      {#if retire.cause === 'rankLimit' && retire.rankLimit}
        {@const limit = retire.rankLimit}
        <p class="cap muted" id="career-rank-limit">
          {limit.years !== null
            ? `계급정년(${view.homeRankLabel ? `${view.homeRankLabel} ` : ''}${limit.years}년) 기준`
            : `직접 넣은 계급정년에 이르는 날(${formatKorean(limit.reachDate, false)}) 기준`} · 연령정년({retire.age}세)은
          {formatLongDate(retire.ageRetireDate)} · 승진하면 달라져요.
        </p>
        {#if limit.years !== null}
          <p class="cap muted">
            계급정년에 이르는 날은 현 {view.careerRules.ladder?.noun ?? '계급'} 임용일부터 {limit.years}년이
            되는 날({formatLongDate(limit.reachDate)})로 셌어요.
          </p>
        {/if}
        {#if limit.boundary && !limit.overridden}
          <p class="note warn" id="career-rank-limit-boundary">
            하루 차이로 퇴직일이 6개월 달라질 수 있어요. 인사 담당 부서에 확인해 주세요.
          </p>
        {/if}
      {/if}
      {#if retire.leapAltRetireDate}
        <p class="note warn" id="career-leap-birth">
          2월 29일생은 평년에는 3월 1일에 {retire.age}세가 된다고 보아 {formatLongDate(
            retire.ageRetireDate,
          )}로 계산했어요. 2월 28일로 보면 {formatLongDate(retire.leapAltRetireDate)}이라, 인사 담당
          부서에 확인해 주세요.
        </p>
      {/if}
    </div>
  {:else}
    {#if view.retirementOff?.status === 'input'}
      <!-- 원문 미확인이 아니라 계급을 고르지 않은 것: '준비 중'이라고 하지 않는다 -->
      <OffNote label="정년" off={view.retirementOff} />
    {:else if view.retirementOff}
      <!-- 꼬리표가 이미 '준비 중'을 말하므로 같은 문장을 앞에 두지 않는다 -->
      <OffNote label="정년" off={view.retirementOff} />
    {:else}
      <p class="cap muted">정년 계산은 준비 중이에요.</p>
    {/if}
    <p class="cap muted">재직 {formatSpan(view.tenure)}째예요.</p>
  {/if}
</Win>

<style>
  dl,
  dt,
  dd {
    margin: 0;
  }
</style>
