<script lang="ts">
  import { formatDday, formatNumber, formatSpan } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const percent = $derived((view.careerRatio * 100).toFixed(5));
</script>

<Win title="정년까지의 길" icon="icon-flag" id="career" area="career">
  <div class="stack wide">
    <div class="stack">
      <div class="kv">
        <span>임용에서 정년까지</span>
        <strong class="num">{percent}%</strong>
      </div>
      <Progress value={view.careerRatio} label="임용부터 정년까지의 진행률" valueText="{percent}%" tone="gold" />
    </div>
    <dl class="stack">
      <div class="kv">
        <dt>정년퇴직일</dt>
        <dd>
          {formatKorean(view.retire.retireDate, false)}
          <strong class="num">{view.career.retired ? '퇴직' : formatDday(view.today, view.retire.retireDate)}</strong>
        </dd>
      </div>
      <div class="kv">
        <dt>재직</dt>
        <dd>{formatNumber(view.career.daysServed)}일째 <span class="cap muted">({formatSpan(view.tenure)})</span></dd>
      </div>
      <div class="kv">
        <dt>남은 날</dt>
        <dd class="num">{formatNumber(view.career.daysLeft)}일</dd>
      </div>
    </dl>
    <p class="cap muted">
      정년 {view.rules.retirement.age}세가 되는 생일({formatKorean(view.retire.reachDate, false)})이 1~6월이면 6월 30일, 7~12월이면 12월
      31일에 퇴직해요(국가공무원법 제74조).
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
