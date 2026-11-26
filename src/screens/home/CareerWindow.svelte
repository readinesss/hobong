<script lang="ts">
  import { formatNumber, formatSpan } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean, spanBetween } from '../../lib/calc/date.ts';
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
        <p class="cap muted">
          계급정년에 이르는 날({formatKorean(retire.rankLimit.reachDate, false)})이 더 먼저라 그
          기준으로 퇴직해요.
        </p>
      {/if}
    </div>
  {:else}
    <p class="cap muted">정년 계산은 준비 중이에요. {view.retirementOff?.reason ?? ''}</p>
  {/if}
</Win>

<style>
  dl,
  dt,
  dd {
    margin: 0;
  }
</style>
