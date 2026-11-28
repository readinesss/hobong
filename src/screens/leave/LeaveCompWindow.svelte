<script lang="ts">
  /**
   * 연가보상비 어림(#33 묶음 1) — 6월 30일·12월 31일 기준 일수와 합계 금액.
   * 금액은 늘 일수까지 곱한 뒤 10원 미만을 버린 합계다(leave-bank.ts compensationAmount). '1일 단가'는 보이지 않는다.
   * 상반기 지급 여부와 12월 보상 일수는 그 해 연가 정리 값(leave.years[Y], #33 묶음 2)에 저장한다.
   * 화면은 직종 이름이 아니라 규정 데이터(연가보상비·저축·끝수 각주)와 계산 결과만 본다.
   */
  import { cite as citeOf } from '../../lib/app/cite.ts';
  import { dayText, midConditionText } from '../../lib/app/leave-comp-copy.ts';
  import { MASKED_WON } from '../../lib/app/format.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import type { Ymd } from '../../lib/calc/date.ts';
  import { formatLeaveHours } from '../../lib/calc/leave.ts';
  import { isAvailable } from '../../lib/rules/index.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { focusAfterDismiss } from '../../lib/app/dismiss.ts';
  import { session } from '../../lib/app/session.svelte.ts';
  import ChipRadio from '../../lib/ui/ChipRadio.svelte';
  import DismissButton from '../../lib/ui/DismissButton.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Money from '../../lib/ui/Money.svelte';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Stepper from '../../lib/ui/Stepper.svelte';
  import Win from '../../lib/ui/Win.svelte';

  interface Props {
    /** [부여 일수 고치기](연가 화면의 대화상자를 연다) */
    onEditGrant: () => void;
    /** [연말 정리](연가 화면의 대화상자를 연다) */
    onYearEnd: () => void;
  }
  let { onEditGrant, onYearEnd }: Props = $props();

  type MidChoice = 'paid' | 'none' | 'unknown';
  const MID_OPTIONS: readonly { value: MidChoice; label: string }[] = [
    { value: 'paid', label: '받았어요' },
    { value: 'none', label: '받지 않았어요' },
    { value: 'unknown', label: '모르겠어요' },
  ];
  /** 저장된 올해 정리 값(없으면 모름·최대로) */
  const plan = $derived(view.leaveYearPlan);
  const midChoice = $derived<MidChoice>(plan?.midYear ?? 'unknown');
  const comp = $derived(view.retired ? null : view.leaveComp);
  /** 상반기 지급 여부를 고른다(저장. '모르겠어요'는 null) */
  function setMid(v: MidChoice) {
    app.setLeaveYear(view.leave.year, { midYear: v === 'unknown' ? null : v });
  }
  /**
   * 12월 보상 일수를 고른다(저장. 최대와 같으면 null — '최대로 보면'으로 돌아간다).
   * 연말 정리에서 저축을 고른 해는 그 값을 그대로 둔다(정리한 해의 값이 '최대로'로 바뀌어 사라지지 않게)
   */
  function setDays(v: number, max: number, carryDays: number) {
    app.setLeaveYear(view.leave.year, { compDays: v === max && carryDays === 0 ? null : v });
  }
  /** 부여 일수를 자동 값보다 크게 고친 해의 띠: 그 해·고친 값마다 한 번 닫는다(값이 바뀌면 다시 뜬다, #15 와 같은 방식) */
  const overrideKey = $derived(
    `leave-override:${view.leave.year}:${view.data.leave.grantOverrideHours[String(view.leave.year)] ?? ''}`,
  );
  const showOverride = $derived(
    comp !== null &&
      comp.kind !== 'needsGrant' &&
      (comp.kind === 'year' ? comp.end.overrideAboveAuto : comp.overrideAboveAuto) &&
      !session.isDismissed(overrideKey),
  );
  function closeOverride() {
    session.dismiss(overrideKey);
    void focusAfterDismiss();
  }
  const hpd = $derived(view.leave.hoursPerDay);
  const hidden = $derived(view.data.settings.hideAmounts);
  const laws = $derived(view.rules.laws);
  const rule = $derived(comp ? comp.rule : null);
  /** 공무원보수 등의 업무지침(국가)을 근거로 둔 직종만 지침의 절 번호를 붙인다(지방 일반직은 그 지침을 따르지 않는다) */
  const directive = $derived(rule?.source.also?.find((a) => a.law === 'payDirective') ?? null);
  const directiveName = $derived(directive ? (laws[directive.law]?.name ?? '') : '');
  const saving = $derived(isAvailable(view.careerRules.leave.saving));
  const rounding = $derived(view.careerRules.track.compRoundingNote ?? null);
  const days = (n: number) => `${n}일`;
  /** '5일분'(뒤에 금액이 붙으면 한 칸 띄운다 — 줄바꿈된 태그 사이 공백에 기대지 않는다) */
  const portion = (n: number, more: boolean) => `${n}일분${more ? ' ' : ''}`;
  /** 정산하는 때: 12월(12월 31일 기준), 7월 1일~12월 30일 퇴직이면 '퇴직 때'(제18조의5제4항제2호) */
  const settleWord = $derived(
    comp?.kind === 'year' && comp.end.retireDate && !comp.end.date.endsWith('-12-31')
      ? '퇴직 때'
      : '12월',
  );
  const md = (d: Ymd) => dayText(d);
</script>

{#if comp && rule}
  <Win title="연가보상비 어림" icon="icon-coin" id="leave-comp" area="comp">
    {#snippet aside()}{comp.year}년{/snippet}
    <div class="stack wide">
      {#if showOverride}
        <div class="note warn band" id="leave-comp-override">
          <div class="band-body">
            <p>
              부여 일수에 저축연가를 더해 두셨다면 어림이 실제보다 커요. 저축연가는 정해진 몇 가지
              경우를 빼고 보상비가 없어요. 가산 연가만 더했다면 그대로 두세요.
            </p>
            <button type="button" class="btn small" onclick={onEditGrant}>
              <Icon name="icon-pencil" /> 부여 일수 고치기
            </button>
          </div>
          <DismissButton label="부여 일수 안내 닫기" onclick={closeOverride} />
        </div>
      {/if}

      {#if comp.kind === 'needsGrant'}
        <p class="note" id="leave-comp-needs-grant">
          올해 부여 일수를 넣으면 보상받을 수 있는 일수와 금액을 셀 수 있어요.
        </p>
        <div class="btn-row">
          <button type="button" class="btn small" onclick={onEditGrant}>
            <Icon name="icon-pencil" /> 부여 일수 넣기
          </button>
        </div>
      {:else if comp.kind === 'retire'}
        <dl class="rows">
          <div class="row">
            <dt>
              {md(comp.retireDate)} 퇴직
              <span class="cap muted">
                · 퇴직일 전날({md(comp.salaryDate)}) 봉급 기준 · 최대 {days(
                  rule.retire.beforeJulyMaxDays,
                )}
              </span>
            </dt>
            <dd>
              {#if comp.total !== null}{days(comp.chosenDays)}분 <Money
                  value={comp.total}
                  approx
                />{:else}{days(comp.chosenDays)}분{/if}
            </dd>
          </div>
        </dl>
        <p class="cap muted">
          그날 남은 연가 {formatLeaveHours(comp.remainingHours, hpd)} · {md(comp.retireDate)} 이전에 퇴직하면
          보상일수는 {days(rule.retire.beforeJulyMaxDays)} 이내예요({citeOf(laws, rule.source)}).
        </p>
        {#if comp.maxDays > 0}
          <Stepper
            id="leave-comp-days"
            label="보상받을 일수"
            value={comp.chosenDays}
            min={0}
            max={comp.maxDays}
            unit="일"
            hint={`최대 ${days(comp.maxDays)}${comp.usedMax ? ' · 최대로 보면' : ''}`}
            onchange={(v) => setDays(v, comp.maxDays, comp.carryDays)}
          />
        {/if}
        {#if comp.salary === null && view.payOff}
          <OffNote label="금액" off={view.payOff} id="leave-comp-pay-off" />
        {/if}
      {:else}
        {@const mid = comp.mid}
        {@const end = comp.end}
        <section class="part" aria-labelledby="leave-comp-mid-title">
          <h3 id="leave-comp-mid-title" class="kv">
            <span>{md(mid.date)} 기준</span>
            {#if mid.beforeHire}
              <span class="muted">없음</span>
            {:else if mid.eligible}
              <span class="num">
                {portion(mid.days, mid.amount !== null)}{#if mid.amount !== null}<Money
                    value={mid.amount}
                    approx
                  />{/if}
              </span>
            {:else}
              <span class="muted">받을 수 있는 조건이 아니에요</span>
            {/if}
          </h3>
          {#if mid.salary && !mid.beforeHire}
            <p class="cap muted">
              {md(mid.date)} 봉급 <Money value={mid.salary.amount} />
            </p>
          {/if}
          <p class="cap" id="leave-comp-mid-cond">
            {midConditionText(mid, hpd, citeOf(laws, rule.source))}
          </p>
          {#if mid.eligible && !mid.upcoming}
            <span class="cap muted" id="leave-comp-mid-ask">상반기 연가보상비를 받았나요?</span>
            <ChipRadio
              options={MID_OPTIONS}
              value={midChoice}
              onchange={setMid}
              labelledby="leave-comp-mid-ask"
              describedby="leave-comp-mid-cond"
            />
          {/if}
          {#if mid.eligible && midChoice === 'unknown' && rule.midYear.optional}
            <p class="cap muted" id="leave-comp-mid-optional">
              상반기 보상은 기관이 하지 않을 수도 있어요{directive
                ? `(${directiveName} 가.4))`
                : ''}. 이 어림은 받았다고 보고 12월에 셈해요.
            </p>
          {/if}
          {#if end.retiringSecondHalf && !mid.beforeHire && directive}
            <!-- 근거는 국가 업무지침의 예외대상자 예시뿐이다. 지방 일반직은 위 '기관이 하지 않을 수도' 한 줄로 갈음한다 -->
            <p class="cap muted" id="leave-comp-mid-retire">
              하반기에 퇴직하는 사람은 기관이 상반기 보상에서 뺄 수 있어요({directiveName} 가.4) ④).
            </p>
          {/if}
        </section>

        <section class="part" aria-labelledby="leave-comp-end-title">
          <h3 id="leave-comp-end-title" class="kv">
            <span>
              {end.retireDate && !end.date.endsWith('-12-31')
                ? `7월 1일~${md(end.date)}(퇴직일)`
                : `${md(end.date)} 기준`}
            </span>
            <span class="cap muted">
              {end.maxDays > 0 ? `최대 ${days(end.maxDays)}` : '보상받을 날 없음'}
            </span>
          </h3>
          {#if end.maxDays > 0}
            <Stepper
              id="leave-comp-days"
              label="보상받을 일수"
              value={end.chosenDays}
              min={0}
              max={end.maxDays}
              unit="일"
              hint={`최대 ${days(end.maxDays)}${end.usedMax ? ' · 최대로 보면' : ''}`}
              onchange={(v) => setDays(v, end.maxDays, end.carryDays)}
            />
            {#if end.carryDays > 0}
              <p class="cap muted" id="leave-comp-carry">
                연말 정리에서 저축 {days(end.carryDays)}을 골라 보상은 {days(end.maxDays)}까지예요.
              </p>
            {/if}
          {:else}
            <p class="cap">
              {end.carryDays > 0
                ? `연말 정리에서 남은 연가를 모두 저축으로 골라 보상받을 날이 없어요(저축 ${days(end.carryDays)}).`
                : `${md(end.date)}에 남는 연가가 없거나 하루가 되지 않아 보상받을 날이 없어요(남은 연가 ${formatLeaveHours(end.remainingHours, hpd)}).`}
            </p>
          {/if}
          {#if end.clamped && plan?.compDays != null}
            <p class="cap muted" id="leave-comp-clamped">
              넣어 둔 보상 일수({days(plan.compDays)})가 한도보다 커서 {days(end.maxDays)}로
              셈했어요.
            </p>
          {/if}
          {#if plan?.unpaidDays == null && end.maxDays > 0}
            <p class="cap muted" id="leave-comp-unpaid-hint">
              기관이 보상하지 않기로 한 일수(권장 연가 등)가 있으면 연말 정리에서 넣어 주세요.
            </p>
          {/if}
          {#if end.total !== null && end.net !== null && end.midPaid !== null}
            <p class="sum" id="leave-comp-end-sum" aria-live="polite">
              {#if hidden}
                {settleWord} 정산 {MASKED_WON}
              {:else if end.midPaid > 0}
                {days(end.chosenDays)}분 <Money value={end.total} approx /> − 6월분
                <Money value={end.midPaid} />
                <br />
                {#if end.net >= 0}
                  = {settleWord}에 <strong><Money value={end.net} approx /></strong>
                {:else}
                  = <strong><Money value={-end.net} approx /></strong>을 돌려내요(환수)
                {/if}
              {:else}
                {days(end.chosenDays)}분 · {settleWord}에
                <strong><Money value={end.total} approx /></strong>
              {/if}
            </p>
          {/if}
          {#if end.salary}
            <p class="cap muted">
              {md(end.salaryDate)} 봉급 <Money
                value={end.salary.amount}
              />{#if end.salaryDate !== end.date}
                (퇴직일 전날){/if}
            </p>
          {/if}
          {#if end.retireDate && end.date.endsWith('-12-31')}
            <p class="cap muted">{md(end.date)} 퇴직은 퇴직일 전날 봉급으로 셈했어요.</p>
          {/if}
          {#if end.salary === null && view.payOff}
            <OffNote label="금액" off={view.payOff} id="leave-comp-pay-off" />
          {/if}
        </section>
      {/if}

      {#if comp.kind !== 'needsGrant'}
        <div class="btn-row">
          <button type="button" class="btn small" onclick={onYearEnd} id="leave-comp-year-end">
            <Icon name="icon-calendar" /> 연말 정리
          </button>
        </div>
      {/if}

      <div class="foot cap muted">
        <p>
          월 봉급 × {Math.round(rule.rate * 100)}% × 1/{rule.divisor} × 일수를 곱한 뒤 {rule.roundTo}원
          미만은 버려요({citeOf(laws, rule.source)}). 보상 일수는 {rule.maxDays}일 이내예요.
        </p>
        <p>
          실제 지급 여부와 일수는 {rule.payCondition}에 따라 달라요. 봉급표 기준 추정치예요.
        </p>
        {#if rounding}<p id="leave-comp-rounding">{rounding.text}</p>{/if}
        {#if directive}
          <p>
            30일 이상 국외출장·해외 주재 등 제외기간이 있으면 보상 일수가 줄 수 있어요({directiveName}
            다.5)②). 연봉제를 적용받으면 기준 금액이 달라요(다.4)나)).
          </p>
        {/if}
        {#if saving}
          <p id="leave-comp-saving-note">
            저축연가에서 쓴 기록은 올해 연가에서 빼지 않아요. 저축연가에는 정해진 몇 가지 경우를
            빼고 보상비가 없어요.
          </p>
        {/if}
      </div>
    </div>
  </Win>
{/if}

<style>
  .rows {
    margin: 0;
  }
  .row,
  .kv {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 3px 9px;
  }
  dt,
  dd {
    margin: 0;
  }
  .part {
    display: grid;
    gap: 6px;
    padding: 9px;
    background: var(--panel-2);
  }
  h3 {
    margin: 0;
    font-size: inherit;
    font-weight: 700;
  }
  .sum {
    margin: 0;
  }
  .foot {
    display: grid;
    gap: 3px;
  }
  .foot p {
    margin: 0;
  }
  .note.warn {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .note.warn p {
    margin: 0;
  }
  .note.band {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .band-body {
    display: grid;
    gap: 6px;
    justify-items: start;
    flex: 1;
    min-width: 0;
  }
</style>
