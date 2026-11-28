<script lang="ts">
  /**
   * '생애 봉급' 창(#30): 임용일부터 끝나는 날(기본은 정년퇴직일)까지의 봉급 합계 추정과 그 가운데 지금까지 번 만큼,
   * 남은 월급날·정기승급·정근수당 횟수.
   *
   * - 직종 이름으로 가르지 않는다. view 의 계산 결과(payOff·retirementOff·retire.cause·lifeEnd)와
   *   규정 데이터의 표시(pay.longServiceAddOn)만 본다.
   * - 금액은 봉급만의 추정이다. 고지 한 줄을 막대 아래에 늘 보인다.
   * - 금액 가리기: 금액 셋은 Money 가 가린다. 저장된 퇴직 예정 달이 있으면(view.lifeMasked) 본문 전체를 한 줄로
   *   줄이고, 그때는 lifetime·lifePaydays·정한 달을 읽지도 않는다(조건문의 첫 갈래). 폼은 빈 칸으로 열고,
   *   정한 뒤 알리는 말에서도 달을 뺀다.
   * - 퇴직 예정 달(연·월)은 창 안에서 펼쳐지는 폼으로 정한다(모달이 아니다). 열면 연도 칸으로, 닫으면 연 버튼으로
   *   포커스가 간다. Enter 는 정하기, Esc 는 닫기. 정한 달은 이 창의 셈에만 쓴다.
   * - 문구는 lib/app/lifetime-copy.ts 한 곳에 있다.
   */
  import { tick, untrack } from 'svelte';
  import {
    LIFETIME_BAR_LABEL,
    LIFETIME_DETAILS_SUMMARY,
    LIFETIME_EARNED_LABEL,
    LIFETIME_MASKED,
    LIFETIME_MASKED_ISSUE,
    LIFETIME_REMAINING_LABEL,
    LIFETIME_SPEAKER,
    LIFETIME_TITLE,
    LIFETIME_TOTAL_LABEL,
    PAYDAY_HOLIDAY_GAP,
    PLAN_CLOSE,
    PLAN_DISCARD,
    PLAN_EDIT,
    PLAN_FILL,
    PLAN_LABEL,
    PLAN_MONTH_ONLY,
    PLAN_OFFER,
    PLAN_OPEN,
    PLAN_RANK_LIMIT_OFFER,
    PLAN_STORAGE_NOTE,
    PLAN_SUBMIT,
    PLAN_RETIRED_LEFTOVER,
    PLAN_TAG,
    planWhyMonth,
    payCalcCite,
    PLAN_WHY_SUMMARY,
    assumptions,
    beyondRankLimitNote,
    checkRetirePlan,
    headline,
    hobongLine,
    maskedUnhideNote,
    notice,
    paydayLine,
    pendingTableNote,
    planAnnouncement,
    planIssueNote,
    planPreview,
    planReference,
    planResetLabel,
    planScopeNote,
    planUnsavedAnnouncement,
    raiseLine,
    rankLimitNote,
    sameMonthNote,
    shownPercent,
    shownRemaining,
    spanYearsMonths,
    spokenSummary,
    spokenSummaryMasked,
    type LifetimeSources,
  } from '../../lib/app/lifetime-copy.ts';
  import { formatNumber } from '../../lib/app/format.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { OFF_STATUS_LABEL } from '../../lib/app/track.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { raisePeriodOf } from '../../lib/calc/career-profile.ts';
  import { spanBetween } from '../../lib/calc/date.ts';
  import { isAvailable, type Unavailable } from '../../lib/rules/index.ts';
  import Money from '../../lib/ui/Money.svelte';
  import MonthInput from '../../lib/ui/MonthInput.svelte';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Progress from '../../lib/ui/Progress.svelte';
  import Win from '../../lib/ui/Win.svelte';

  const hidden = $derived(view.data.settings.hideAmounts);
  /** 계급 낱말('직급'·'계급'·'직무등급'). 계급 이름이 없는 봉급표(교원)는 '' */
  const noun = $derived(view.rankLabel ? (view.careerRules.ladder?.noun ?? '') : '');
  /** 봉급은 켜져 있는데 정기승급을 계산하지 않아 합계를 낼 수 없는 직종 */
  const raiseOff = $derived<Unavailable | null>(
    isAvailable(view.careerRules.stepRaise) ? null : view.careerRules.stepRaise,
  );
  /** 정년과 봉급이 같은 사유로 꺼져 있는지(한 줄로 묶어 같은 말을 두 번 하지 않는다) */
  const offsMerged = $derived.by(() => {
    const r = view.retirementOff;
    const p = view.payOff;
    return r !== null && p !== null && r.status === p.status && r.reason === p.reason;
  });
  /** 끝나는 날이 없을 때(정년을 계산하지 못함) 보일 꺼진 항목. 사유가 같으면 한 줄로 묶는다 */
  const offs = $derived.by(() => {
    const out: { label: string; off: Unavailable }[] = [];
    const r = view.retirementOff;
    const p = view.payOff;
    if (r && offsMerged) return [{ label: '정년·봉급', off: r }];
    if (r) out.push({ label: '정년', off: r });
    if (p) out.push({ label: '봉급', off: p });
    return out;
  });
  /** 근거 글자의 재료: 직종 해석 결과의 근거(국가 공무원보수규정 / 지방공무원 보수규정) */
  const lifeSources = $derived<LifetimeSources>({
    laws: view.rules.laws,
    stepRaise: isAvailable(view.careerRules.stepRaise) ? view.careerRules.stepRaise.source : null,
    payday: view.careerRules.payday.source,
    payCalc: view.careerRules.payCalc,
  });
  /** 끝나는 날의 근거 조문: 계급정년이 먼저 오면 계급정년 조항, 아니면 연령정년 조항 */
  const retireBasis = $derived.by(() => {
    const retire = view.retire;
    const rules = view.careerRules.retirement;
    if (!retire) return '';
    if (retire.cause !== 'rankLimit' || !isAvailable(rules) || !rules.rankLimit)
      return retire.basis;
    const source = rules.rankLimit.source;
    return `${view.rules.laws[source.law]?.name ?? source.law} ${source.article}`;
  });
  /** 제목 줄 오른쪽: 금액을 보일 때만 봉급표 연도, 아니면 꺼진 상태 이름 */
  const asideText = $derived.by(() => {
    if (view.lifeEnd.date !== null && view.salary && !raiseOff)
      return `${view.salary.tableYear}년 봉급표`;
    const off = view.payOff ?? view.retirementOff ?? raiseOff;
    return off ? OFF_STATUS_LABEL[off.status] : '';
  });

  // ── 퇴직 예정 달 정하기 ──
  /** 저장된 퇴직 예정 달이 있고 화면이 그것을 다룬다(정년퇴직일이 지난 뒤에는 다루지 않는다) */
  const held = $derived(view.lifeEnd.planHeld);
  /** 돌아갈 '정년까지'가 있는지(정년을 계산하지 못하면 정한 달을 지울 뿐이다) */
  const hasRetirement = $derived(view.retire !== null);
  /** 계급정년이 있는 직종의 계급정년 규정(상한이 '연령정년 퇴직일'임을 밝히고, 예외 설명과 근거를 그대로 보인다) */
  const rankLimitRule = $derived(
    isAvailable(view.careerRules.retirement)
      ? (view.careerRules.retirement.rankLimit ?? null)
      : null,
  );
  const planCheck = $derived({
    minMonth: view.lifeEnd.minMonth,
    ageRetireDate: view.lifeAgeRetireDate,
    hasRankLimit: rankLimitRule !== null,
    hireDate: view.profile.hireDate,
  });

  let formOpen = $state(false);
  /** 폼을 연 때의 app.dataGeneration(그 사이 다른 탭의 값을 따라갔으면 정하지 않고 알린다) */
  let formBase = 0;
  /** 폼에 치는 중인 값('YYYY-MM' 또는 덜 채웠으면 '') */
  let draft = $state('');
  /** [정하기]를 한 번이라도 눌렀는지(빈 칸의 "넣어 주세요"는 그 뒤에만 보인다) */
  let tried = $state(false);
  /** 정하거나 되돌린 결과·오류를 알리는 말(aria-live) */
  let announce = $state('');
  /** 그 말에 정한 달이 들어 있는지("…2030년 3월로 정했어요") */
  let announceNamesMonth = $state(false);
  /** 그 말이 [정하기]로 낸 오류인지(칸을 고치면 지운다 — 고친 뒤에도 지난 오류가 낭독 영역에 남지 않게) */
  let announceIsError = false;
  /**
   * 화면에 두는 알림 글. 달을 말한 알림이 남아 있는 채로 금액 가리기를 켜면 그 글을 비운다 —
   * 가린 뒤에는 보이지 않는 글(낭독 영역)에도 정한 달이 남지 않게.
   */
  const liveText = $derived(hidden && announceNamesMonth ? '' : announce);
  // 폼이 열린 채로 금액 가리기가 켜지면(이 탭·다른 탭 어디서든) 폼을 닫는다: 칸에 든 값이 저장된 달일 수 있다.
  // 가리기 중에 다시 열면 빈 칸으로 열린다.
  $effect(() => {
    if (hidden) untrack(() => (formOpen = false));
  });
  let monthInput = $state<MonthInput>();

  /** 맞는 달을 다 쳤는데 고를 수 없는 달이면 바로, 빈 칸·덜 채운 칸은 [정하기]를 누른 뒤에 알린다 */
  const draftError = $derived(
    draft === ''
      ? tried
        ? checkRetirePlan('', planCheck)
        : null
      : checkRetirePlan(draft, planCheck),
  );
  // 칸을 고쳐 친 값이 바뀌면 지난 오류 알림을 지운다(화면의 오류 글은 draftError 가 새로 맞춘다)
  $effect(() => {
    void draft;
    untrack(() => {
      if (!announceIsError) return;
      announce = '';
      announceIsError = false;
    });
  });
  /**
   * 폼의 기준 날: 연령정년 퇴직일(고를 수 있는 마지막 달). 빈 칸에 보기 값으로 흐리게 넣지 않고(친 값처럼 보인다)
   * 글로 알리고, 누르면 그 달로 채우는 버튼을 둔다. 정년 규정이 꺼진 직종은 없다.
   */
  const referenceDate = $derived(view.lifeAgeRetireDate);
  const referenceMonth = $derived(
    referenceDate !== null && checkRetirePlan(referenceDate.slice(0, 7), planCheck) === null
      ? referenceDate.slice(0, 7)
      : null,
  );
  /** 창(영역)의 설명으로 잇는 숨긴 낭독 요약이 있는지(가린 갈래에서는 lifetime 을 읽지 않는다) */
  const summaryOn = $derived(
    !view.lifeMasked && view.lifeEnd.date !== null && view.lifetime !== null,
  );

  async function focusOpener() {
    await tick();
    document.getElementById('lifetime-plan-open')?.focus();
  }

  function fillReference() {
    if (referenceMonth) draft = referenceMonth;
  }

  async function openForm() {
    // 금액 가리기 중에는 저장된 달을 처음 값으로 넣지 않는다(입력 칸으로 정한 달이 새지 않게)
    draft = hidden ? '' : (view.retirePlanMonth ?? '');
    tried = false;
    announce = '';
    announceNamesMonth = false;
    announceIsError = false;
    formBase = untrack(() => app.dataGeneration);
    formOpen = true;
    await tick();
    monthInput?.focus();
    monthInput?.reveal();
  }

  function closeForm() {
    formOpen = false;
    void focusOpener();
  }

  /**
   * 정한 달을 저장하거나(month) 지운다(null). 저장소에 쓰지 못했으면(이 탭에서만 바뀜) 정했다고만 말하지 않는다.
   * 화면 위 안내(저장하지 못했어요)도 함께 뜬다.
   */
  function save(month: string | null) {
    const result = app.setRetirePlan(month, formBase);
    if (!result) return;
    formOpen = false;
    if (result === 'discarded') {
      // 다른 탭이 바꾼 저장본을 따라갔다: 정했다고 하지 않는다(app 이 알림으로 알린다). 창은 따라간 값으로 그린다
      announce = '';
      announceNamesMonth = false;
      announceIsError = false;
      void focusOpener();
      return;
    }
    announce =
      result === 'saved'
        ? // 정년이 지난 뒤 남은 달을 지울 때는 '정년까지로 되돌렸어요'가 아니라 '지웠어요'
          planAnnouncement(month, { masked: hidden, hasRetirement: hasRetirement && !view.retired })
        : planUnsavedAnnouncement(month, { masked: hidden });
    announceNamesMonth = month !== null && !hidden;
    announceIsError = false;
    void focusOpener();
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    const problem = checkRetirePlan(draft, planCheck);
    if (problem) {
      announce = problem;
      announceNamesMonth = false;
      announceIsError = true;
      monthInput?.focus();
      // 오류 글이 그려진 뒤, 화면 키보드에 가려지지 않게 칸과 함께 보이도록 맞춘다
      void tick().then(() => monthInput?.reveal());
      return;
    }
    save(draft);
  }

  function onFormKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeForm();
  }
</script>

{#snippet planControls()}
  {#if formOpen}
    <!-- 폼의 키 처리는 Esc 로 닫기뿐이다(칸·버튼은 저마다 키보드로 다뤄진다) -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <form
      class="plan stack"
      id="lifetime-plan-form"
      novalidate
      onsubmit={submit}
      onkeydown={onFormKey}
    >
      <MonthInput
        bind:this={monthInput}
        id="lifetime-plan-month"
        label={PLAN_LABEL}
        bind:value={draft}
        error={draftError ?? undefined}
        describedby={referenceDate
          ? 'lifetime-plan-reference lifetime-plan-preview'
          : 'lifetime-plan-preview'}
      />
      {#if referenceDate}
        <div class="reference">
          <p class="cap muted" id="lifetime-plan-reference">
            {planReference(referenceDate, rankLimitRule !== null)}
          </p>
          {#if referenceMonth}
            <button type="button" class="btn small" id="lifetime-plan-fill" onclick={fillReference}>
              {PLAN_FILL}
            </button>
          {/if}
        </div>
      {/if}
      <p class="cap muted" id="lifetime-plan-preview">{planPreview(draftError ? '' : draft)}</p>
      <div class="btn-row">
        <button type="submit" class="btn primary" id="lifetime-plan-submit">{PLAN_SUBMIT}</button>
        {#if held}
          <button type="button" class="btn" id="lifetime-plan-reset" onclick={() => save(null)}>
            {planResetLabel(hasRetirement)}
          </button>
        {/if}
        <button type="button" class="btn ghost" id="lifetime-plan-close" onclick={closeForm}>
          {PLAN_CLOSE}
        </button>
      </div>
      <p class="cap muted" id="lifetime-plan-month-only">{PLAN_MONTH_ONLY}</p>
      <details class="cap fold" id="lifetime-plan-why">
        <summary>{PLAN_WHY_SUMMARY}</summary>
        <p class="muted">{planWhyMonth(payCalcCite(lifeSources))}</p>
      </details>
      <p class="cap muted">{planScopeNote(hasRetirement)}</p>
      <p class="cap muted" id="lifetime-plan-storage">{PLAN_STORAGE_NOTE}</p>
    </form>
  {:else}
    <div class="btn-row" id="lifetime-plan-actions">
      <button type="button" class="btn" id="lifetime-plan-open" onclick={openForm}>
        {held ? PLAN_EDIT : PLAN_OPEN}
      </button>
      {#if view.lifeEnd.planIssue}
        <button type="button" class="btn" id="lifetime-plan-discard" onclick={() => save(null)}>
          {PLAN_DISCARD}
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

<!-- 저장된 정한 달을 쓰지 못할 때(금액 가리기 중에는 이 갈래에 오지 않는다) -->
{#snippet planIssue()}
  {#if view.lifeEnd.planIssue && view.retirePlanMonth}
    <p class="note warn" id="lifetime-plan-issue">
      {planIssueNote({
        issue: view.lifeEnd.planIssue,
        month: view.retirePlanMonth,
        ageRetireDate: view.lifeAgeRetireDate,
        hasRankLimit: rankLimitRule !== null,
        hireDate: view.profile.hireDate,
        fallback: view.lifeEnd.date !== null,
      })}
    </p>
  {/if}
{/snippet}

<Win
  title={LIFETIME_TITLE}
  icon="icon-coin"
  id="lifetime"
  area="lifetime"
  describedby={summaryOn ? 'lifetime-summary' : undefined}
>
  {#snippet aside()}{asideText}{/snippet}
  <!--
    정하거나 되돌린 결과를 알린다. 갈래가 바뀌어도 남도록 본문 밖에 둔다. 비어 있을 때 접근성 트리에 빈 문단이
    잡히지 않게 역할 없는 div 로 둔다
  -->
  <div class="sr-only" id="lifetime-live" aria-live="polite">{liveText}</div>
  {#if view.lifeMasked}
    <!--
      금액 가리기 + 저장된 퇴직 예정 달: 달·횟수·막대·한마디·자세한 가정·경고문의 달을 모두 그리지 않는다.
      쓸 수 없게 된 달이어도 무엇이 문제인지(지났는지·뒤인지) 말하지 않고 확인만 부탁한다.
    -->
    <div class="stack wide">
      <p class="note" id="lifetime-masked">
        {view.lifeEnd.planIssue ? `${LIFETIME_MASKED} ${LIFETIME_MASKED_ISSUE}` : LIFETIME_MASKED}
        <!-- '오늘' 창의 금액 가리기 단추는 봉급을 계산하는 직종에만 있다 -->
        {maskedUnhideNote(view.salary !== null)}
      </p>
      {@render planControls()}
    </div>
  {:else if view.lifeEnd.date === null}
    <!-- 끝나는 날을 모른다(정년 '준비 중'·'입력 필요'이고 쓸 수 있는 정한 달도 없다): 숫자를 하나도 만들지 않는다 -->
    <div class="stack wide" id="lifetime-off">
      <div class="stack">
        {#each offs as item (item.label)}
          <OffNote label={item.label} off={item.off} />
        {:else}
          <p class="cap muted">정년 계산은 준비 중이에요.</p>
        {/each}
        {#if !view.lifeEnd.planIssue}
          <p class="cap muted" id="lifetime-offer">{PLAN_OFFER}</p>
        {/if}
      </div>
      {@render planIssue()}
      {@render planControls()}
    </div>
  {:else}
    {@const end = view.lifeEnd}
    {@const endDate = view.lifeEnd.date}
    {@const life = view.lifetime}
    {@const paydays = view.lifePaydays}
    {@const retired = view.retired}
    {@const plan = end.basis === 'plan'}
    {@const head = headline({
      basis: plan ? 'plan' : 'retirement',
      date: endDate,
      cause: view.retire?.cause ?? null,
      retired,
    })}
    {@const percent = life ? shownPercent(life) : null}
    {@const timePercent = Math.floor((plan ? (view.lifeTimeRatio ?? 0) : view.careerRatio) * 100)}
    {@const line = hobongLine({
      retired,
      basis: plan ? 'plan' : 'retirement',
      paydays,
      timePercent: plan || view.retire ? timePercent : null,
      moneyPercent: percent,
      raisesLeft: life ? life.raisesLeft : null,
    })}
    {@const diligence = retired ? null : view.lifeDiligenceLeft}
    {@const diligenceRule = view.careerRules.allowances.diligence}
    {@const how = assumptions({
      lifetime: life,
      noun,
      periodMonths: raisePeriodOf(view.careerRules),
      basis: plan ? 'plan' : 'retirement',
      retired,
      newYears: view.lifeNewYears,
      payday: view.data.settings.payday,
      diligence: diligence !== null && isAvailable(diligenceRule) ? diligenceRule : null,
      holidayBonus: isAvailable(view.careerRules.allowances.holidayBonus),
      longServiceAddOn: isAvailable(view.careerRules.pay)
        ? (view.careerRules.pay.longServiceAddOn?.source ?? null)
        : null,
      retireBasis,
      sources: lifeSources,
    })}
    <div class="stack wide">
      {#if life && percent}
        <!--
          낭독 요약: 창(영역)의 설명(aria-describedby)으로만 읽는다. 숨겨 두어 본문을 읽을 때 첫 줄·금액을 두 번 듣지 않게
        -->
        <p hidden id="lifetime-summary">
          {hidden
            ? spokenSummaryMasked(head, percent)
            : spokenSummary(head, life.total, life.earned, percent)}
        </p>
      {/if}
      <div class="stack">
        <p id="lifetime-head">
          {plan && !retired
            ? `${head} · ${spanYearsMonths(spanBetween(view.today, endDate))} 남음`
            : head}
          {#if plan}<span class="tag" id="lifetime-plan-tag">{PLAN_TAG}</span>{/if}
        </p>
        {#if !plan && !retired && view.retire?.cause === 'rankLimit'}
          <p class="cap muted" id="lifetime-rank-limit">
            {rankLimitNote(view.retire.ageRetireDate)}
            {PLAN_RANK_LIMIT_OFFER}
          </p>
        {/if}
        {#if !plan && end.planHeld && !end.planIssue && view.retirePlanMonth}
          <!-- 정한 달이 정년퇴직일과 같은 달: 정년 기준 그대로 셈하고, 저장된 값은 지우지 않는다 -->
          <p class="cap muted" id="lifetime-same-month">
            {sameMonthNote(view.retirePlanMonth, view.retire?.cause ?? null)}
          </p>
        {/if}
        {#if plan && view.retirementOff}
          <!-- 정년을 계산하지 못한 채 정한 달로 셈했다(계급을 안 골랐으면 계급정년 뒤인지 알 수 없다) -->
          <OffNote
            label={offsMerged ? '정년·봉급' : '정년'}
            off={view.retirementOff}
            id="lifetime-retire-off"
          />
        {/if}
      </div>

      {#if end.beyondRankLimit && view.retireDate && rankLimitRule}
        <!--
          정한 달이 계급정년 퇴직일보다 뒤(연령정년 이내). 근무 조건을 단정하지 않고, 반영하지 않은 예외는
          규정 데이터의 설명을 그대로 보인다(직종마다 조항이 다르다).
        -->
        <div class="stack" id="lifetime-beyond">
          <p class="note warn">{beyondRankLimitNote(view.retireDate, noun, life !== null)}</p>
          {#if rankLimitRule.source.note}
            <p class="cap muted" id="lifetime-beyond-note">
              {rankLimitRule.source.note}
              ({view.rules.laws[rankLimitRule.source.law]?.name ?? rankLimitRule.source.law}
              {rankLimitRule.source.article})
            </p>
          {/if}
        </div>
      {/if}
      {@render planIssue()}

      {#if life && percent}
        <div class="stack" id="lifetime-money">
          <div class="kv">
            <span>{LIFETIME_TOTAL_LABEL}</span>
            <strong id="lifetime-total"><Money value={life.total} short approx /></strong>
          </div>
          <div class="meter">
            <Progress
              value={percent.bar}
              label={LIFETIME_BAR_LABEL}
              valueText={percent.text}
              tone="accent"
            />
            <span class="num" aria-hidden="true" id="lifetime-percent">{percent.text}</span>
          </div>
          <dl class="stack">
            <div class="kv">
              <dt>{LIFETIME_EARNED_LABEL}</dt>
              <dd id="lifetime-earned"><Money value={life.earned} short approx /></dd>
            </div>
            {#if !retired}
              <div class="kv">
                <dt>{LIFETIME_REMAINING_LABEL}</dt>
                <dd id="lifetime-remaining">
                  {#if life.remaining === 0}없음{:else}
                    <!-- 보이는 총액 − 보이는 '지금까지'(만 원 단위): 화면의 세 금액이 늘 더해서 맞는다 -->
                    <Money value={shownRemaining(life.total, life.earned)} short approx />
                  {/if}
                </dd>
              </div>
            {/if}
          </dl>
          {#if plan && view.retire && view.lifeRetirementTotal !== null}
            <!-- 정한 달 기준일 때 정년 기준 합계를 사실만 견줘 보인다(가린 갈래에서는 여기에 오지 않는다) -->
            <p class="cap muted" id="lifetime-compare">
              {headline({
                basis: 'retirement',
                date: view.retire.retireDate,
                cause: view.retire.cause,
                retired: false,
              })}
              <Money value={view.lifeRetirementTotal} short approx />이에요.
            </p>
          {/if}
        </div>
      {:else if view.payOff}
        <!-- 정년과 같은 사유로 꺼져 있으면 첫 줄 아래의 '정년·봉급' 한 줄이 이미 말했다 -->
        {#if !(plan && offsMerged)}
          <OffNote label="봉급" off={view.payOff} id="lifetime-pay-off" />
        {/if}
      {:else if raiseOff}
        <OffNote label="정기승급" off={raiseOff} id="lifetime-pay-off" />
      {/if}

      {#if paydays}
        {@const firstPayday =
          paydays.received === 0 &&
          !retired &&
          view.payday >= view.profile.hireDate &&
          view.payday <= endDate
            ? { date: view.payday, today: view.today }
            : null}
        {@const pay = paydayLine(paydays, retired, firstPayday)}
        {@const raise = life && !retired ? raiseLine(life) : null}
        <dl class="stack" id="lifetime-counts">
          <div class="kv">
            <dt>{pay.label}</dt>
            <dd id="lifetime-paydays">
              <span class="num">{pay.value}</span>
              {#if pay.aside}<span class="cap muted">({pay.aside})</span>{/if}
            </dd>
          </div>
          {#if raise}
            <div class="kv">
              <dt>{raise.label}</dt>
              <dd id="lifetime-raises">
                <span class="num">{raise.value}</span>
                {#if raise.aside}<span class="cap muted">({raise.aside})</span>{/if}
              </dd>
            </div>
          {/if}
          {#if diligence !== null}
            <div class="kv">
              <dt>남은 정근수당</dt>
              <dd id="lifetime-diligence" class="num">
                {diligence === 0 ? '없음' : `${formatNumber(diligence)}번`}
              </dd>
            </div>
          {/if}
        </dl>
        {#if !retired && !view.lifePaydayHolidaysKnown}
          <p class="cap muted" id="lifetime-holiday-gap">{PAYDAY_HOLIDAY_GAP}</p>
        {/if}
      {/if}

      {#if line}
        <!-- 말하는 이 이름표는 쌍점으로 문장과 나눈다('호봉이 정한 달…'처럼 이어 읽히지 않게) -->
        <p class="well cap" id="lifetime-line"><strong>{LIFETIME_SPEAKER}</strong> {line}</p>
      {/if}

      {#if life}
        <p class="note" id="lifetime-notice">{notice(noun, life.tableYear)}</p>
        {#if view.salaryPending}
          <p class="note warn" id="lifetime-pending">
            {pendingTableNote(view.rules.year, life.tableYear)}
          </p>
        {/if}
      {/if}

      <details class="cap" id="lifetime-how">
        <summary>{LIFETIME_DETAILS_SUMMARY}</summary>
        <dl class="how">
          {#each how as item (item.title)}
            <div>
              <dt>{item.title}</dt>
              <dd class="muted">{item.text}</dd>
            </div>
          {/each}
        </dl>
      </details>

      {#if !retired}
        {@render planControls()}
      {:else if view.retirePlanMonth}
        <!--
          정년퇴직일이 지난 뒤 저장본에 남은 정한 달: 셈에는 쓰지 않지만 임용정보 패키지에는 실리므로 지울 길을 둔다.
          달은 말하지 않는다(금액 가리기 중일 수 있다)
        -->
        <div class="stack" id="lifetime-plan-leftover">
          <p class="cap muted">{PLAN_RETIRED_LEFTOVER}</p>
          <div class="btn-row">
            <button type="button" class="btn" id="lifetime-plan-discard" onclick={() => save(null)}>
              {PLAN_DISCARD}
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Win>

<style>
  dl,
  dt,
  dd,
  p {
    margin: 0;
  }
  .meter {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
  }
  /* 괄호 덧말이 길면 값 아래 줄로 떨어진다 */
  .kv > dd {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: baseline;
    gap: 0 6px;
  }
  #lifetime-how summary,
  .fold summary {
    cursor: pointer;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
  }
  #lifetime-how summary::-webkit-details-marker,
  .fold summary::-webkit-details-marker {
    display: none;
  }
  /* 펼침 표시(임용정보 패키지 안내의 [자세히]와 같은 모양). 장식이라 낭독하지 않는다 */
  #lifetime-how summary::before,
  .fold summary::before {
    content: '▶';
    content: '▶' / '';
  }
  #lifetime-how[open] summary::before,
  .fold[open] summary::before {
    content: '▼';
    content: '▼' / '';
  }
  .fold > p {
    padding-bottom: 3px;
  }
  /* 기준 날 한 줄과 [그 달로 채우기]: 좁으면 버튼이 아래 줄로 */
  .reference {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 9px;
  }
  .reference > p {
    flex: 1 1 180px;
    min-width: 0;
  }
  .how {
    display: grid;
    gap: 9px;
    padding-bottom: 3px;
  }
  .how dt {
    color: var(--ink);
  }
  .how dd {
    overflow-wrap: anywhere;
  }
  #lifetime-head .tag {
    vertical-align: middle;
  }
  /* 창 안에서 펼쳐지는 폼: 본문과 구별되게 안쪽 칸으로 */
  .plan {
    padding: 9px;
    background: var(--panel-2);
    gap: 9px;
  }
</style>
