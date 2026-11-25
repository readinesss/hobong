<script lang="ts">
  import { formatDday } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean, formatMonthDay } from '../../lib/calc/date.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Money from '../../lib/ui/Money.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const salary = $derived(view.salary);
</script>

<Win title="지갑" icon="icon-coin" id="wallet" area="wallet">
  {#snippet aside()}{salary.tableYear}년 봉급표{/snippet}
  <div class="stack wide">
    <div class="stack">
      <span class="muted">월 봉급</span>
      <p class="big"><Money value={salary.amount} /></p>
      <p class="cap muted">{salary.grade}급 {salary.step}호봉 · 공무원보수규정 별표 3</p>
      {#if view.salaryPending}
        <p class="note warn">
          {view.rules.year}년 봉급표가 아직 반영되지 않아 {salary.tableYear}년 표로 계산했어요. 새
          봉급표가 나오면 금액이 달라져요.
        </p>
      {/if}
    </div>

    <dl class="stack">
      <div class="kv">
        <dt>올해 번 봉급</dt>
        <dd><Money value={view.yearToDate} /></dd>
      </div>
      <div class="kv">
        <dt>지금까지 번 봉급</dt>
        <dd><Money value={view.cumulative.total} short approx /></dd>
      </div>
      <p class="cap muted">
        지금 직급과 {view.cumulative.tableYear}년 봉급표를 임용일부터 그대로 적용한
        어림값이에요(과거 봉급표·승진 전 직급은 반영하지 않음).
      </p>
    </dl>

    <div class="stack">
      <span class="muted">다음 인상</span>
      {#if view.nextRaise}
        <div class="kv">
          <span class="row"><Icon name="icon-arrow-up" /> 정기승급</span>
          <span>
            <Money value={view.nextRaise.diff} sign="+" />
            <span class="cap muted">{formatKorean(view.nextRaise.date, false)}</span>
          </span>
        </div>
      {/if}
      <div class="kv">
        <span class="row"><Icon name="icon-document" /> 새 봉급표</span>
        <span class="cap muted">해마다 1월 시행 · 금액은 확정되면 반영</span>
      </div>
    </div>

    {#if view.bonuses.length > 0}
      <div class="stack">
        <span class="muted">다가오는 보너스</span>
        <ul class="bonus">
          {#each view.bonuses as bonus (bonus.kind + bonus.date)}
            <li class="well">
              <div class="kv">
                <span class="row"><Icon name="icon-gift" /> {bonus.title}</span>
                <strong class="num">{formatDday(view.today, bonus.date)}</strong>
              </div>
              <div class="kv">
                <span class="cap">{formatMonthDay(bonus.date)}</span>
                <span><Money value={bonus.amount} approx /></span>
              </div>
              <p class="cap muted">
                {[
                  `봉급의 ${Math.round(bonus.rate * 100)}%${bonus.years !== null ? ` (근무연수 ${bonus.years}년)` : ''}${
                    bonus.proration ? ` × ${bonus.proration.months}/${bonus.proration.of}개월` : ''
                  }`,
                  bonus.dateNote,
                  bonus.salaryConfirmed ? '' : '그 해 봉급표 확정 전',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <p class="note">
      모든 금액은 봉급표 기준 추정치예요. 수당·세금·기여금이 빠져 있어 실수령액과 달라요.
    </p>
  </div>
</Win>

<style>
  dl,
  dt,
  dd {
    margin: 0;
  }
  .bonus {
    display: grid;
    gap: 9px;
  }
  .bonus li {
    display: grid;
    gap: 3px;
  }
</style>
