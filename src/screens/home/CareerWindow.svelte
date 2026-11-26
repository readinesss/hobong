<script lang="ts">
  import { formatDday, formatNumber, formatSpan } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  // 째깍이는 연출로 소수 다섯 자리까지 보이되, 낭독은 정수 %로 한다
  const percent = $derived((view.careerRatio * 100).toFixed(5));
  const percentSpoken = $derived(`${Math.floor(view.careerRatio * 100)}%`);
</script>

<Win title="정년까지의 길" icon="icon-flag" id="career" area="career">
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
          {formatKorean(view.retire.retireDate, false)}{#if view.career.retired}
            · <strong>퇴직</strong>{/if}
        </dd>
      </div>
      <div class="kv">
        <dt>재직</dt>
        <dd>
          {formatNumber(view.career.daysServed)}일째
          <span class="cap muted">({formatSpan(view.tenure)})</span>
        </dd>
      </div>
      <div class="kv">
        <dt>남은 날</dt>
        <dd class="num">
          {formatNumber(view.career.daysLeft)}일
          {#if !view.career.retired}<span class="cap muted">
              · {formatDday(view.today, view.retire.retireDate)}
            </span>{/if}
        </dd>
      </div>
    </dl>
    <p class="cap muted">
      정년 {view.rules.retirement.age}세가 되는 생일({formatKorean(view.retire.reachDate, false)})이
      1~6월이면 6월 30일, 7~12월이면 12월 31일에 퇴직해요(국가공무원법 제74조).
    </p>
  </div>
</Win>

<style>
  dl,
  dt,
  dd {
    margin: 0;
  }
</style>
