<script lang="ts">
  import { formatDday } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean, formatMonthDay } from '../../lib/calc/date.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import { isAvailable, type Unavailable } from '../../lib/rules/index.ts';
  import Money from '../../lib/ui/Money.svelte';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import { OFF_STATUS_LABEL, offSentence } from '../../lib/app/track.ts';
  import Win from '../../lib/ui/Win.svelte';

  const salary = $derived(view.salary);
  const allowances = $derived(view.careerRules.allowances);
  /** 정근수당·명절휴가비 중 꺼진 것(봉급은 계산하는 직종에서만 따로 알린다) */
  const bonusOff = $derived.by(() => {
    const out: { label: string; off: Unavailable }[] = [];
    const d = allowances.diligence;
    const h = allowances.holidayBonus;
    if (!isAvailable(d) && !isAvailable(h) && d.reason === h.reason)
      return [{ label: '정근수당·명절휴가비', off: d }];
    if (!isAvailable(d)) out.push({ label: '정근수당', off: d });
    if (!isAvailable(h)) out.push({ label: '명절휴가비', off: h });
    return out;
  });
  /** 정근수당 근무연수를 어림하는 직종(교원: 경력환산율)의 안내 */
  const diligenceNote = $derived(
    view.bonuses.some((b) => b.kind === 'diligence')
      ? (view.careerRules.track.applies?.diligence?.note ?? '')
      : '',
  );
  /** '직급'·'계급'(교원은 호봉만) */
  const noun = $derived(view.careerRules.ladder?.noun ?? '');
</script>

<Win title="지갑" icon="icon-coin" id="wallet" area="wallet">
  {#snippet aside()}{salary
      ? `${salary.tableYear}년 봉급표`
      : OFF_STATUS_LABEL[view.payOff?.status ?? 'pending']}{/snippet}
  <div class="stack wide">
    <div class="stack">
      <span class="muted">월 봉급</span>
      {#if salary}
        <p class="big"><Money value={salary.amount} /></p>
        <p class="cap muted">{view.rankStepLabel} · 공무원보수규정 {salary.annex}</p>
      {:else}
        <p class="cap muted" id="wallet-pay-off">
          {view.payOff ? offSentence('봉급', view.payOff) : '봉급 계산은 준비 중이에요.'}
        </p>
      {/if}
      {#if salary && view.salaryPending}
        <p class="note warn">
          {view.rules.year}년 봉급표가 아직 반영되지 않아 {salary.tableYear}년 표로 계산했어요. 새
          봉급표가 나오면 금액이 달라져요.
        </p>
      {/if}
    </div>

    {#if view.yearToDate !== null && view.cumulative}
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
          지금 {view.rankLabel ? noun : '호봉'}과 {view.cumulative.tableYear}년 봉급표({salary?.annex ??
            ''})를 임용일부터 그대로 적용한 어림값이에요({view.rankLabel
            ? `과거 봉급표·승진 전 ${noun}은`
            : '과거 봉급표는'} 반영하지 않음).
        </p>
      </dl>
    {/if}

    <!-- 봉급을 계산하지 않으면 인상·추정치 안내도 쓸모가 없다(곧 금액이 나올 것처럼 읽히지 않게) -->
    {#if salary}<div class="stack">
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
      </div>{/if}

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
                  bonus.holidaysKnown ? '' : '그 해 공휴일 반영 전(지급일이 앞당겨질 수 있음)',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          {/each}
        </ul>
        {#if diligenceNote}<p class="cap muted">{diligenceNote}</p>{/if}
        {#if view.bonusGapYear}
          <p class="cap muted">
            {view.bonusGapYear}년 공휴일이 아직 반영되지 않아 그 해의 명절휴가비는 여기 나오지
            않아요.
          </p>
        {/if}
      </div>
    {/if}

    {#each bonusOff as item (item.label)}
      <OffNote label={item.label} off={item.off} />
    {/each}

    {#if salary}
      <p class="note">
        모든 금액은 봉급표 기준 추정치예요. 수당·세금·기여금이 빠져 있어 실수령액과 달라요.
      </p>
    {/if}
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
