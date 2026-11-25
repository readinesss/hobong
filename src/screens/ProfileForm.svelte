<script lang="ts">
  import { untrack } from 'svelte';
  import {
    addMonthsClamped,
    onOrNextDayOfMonth,
    periodCompleteDate,
    yearOf,
    type Ymd,
  } from '../lib/calc/date.ts';
  import { maxStepOf } from '../lib/calc/salary.ts';
  import { stepOn, nextRaiseDate } from '../lib/calc/step.ts';
  import { clock } from '../lib/app/clock.svelte.ts';
  import { rulesFor } from '../lib/rules/index.ts';
  import { GRADES, LIMITS, type Grade, type Profile } from '../lib/store/schema.ts';
  import { checkProfile, toProfile, type ProfileErrors } from '../lib/store/validate.ts';
  import DateInput from '../lib/ui/DateInput.svelte';
  import Stepper from '../lib/ui/Stepper.svelte';

  interface Props {
    /** 고칠 때의 기존 값. 없으면 새로 만든다 */
    initial?: Profile;
    /** 처음 만들 때만 월급날을 함께 묻는다 */
    initialPayday?: number;
    askPayday?: boolean;
    submitLabel: string;
    onsubmit: (profile: Profile, payday: number) => void;
    oncancel?: () => void;
  }

  let {
    initial,
    initialPayday,
    askPayday = false,
    submitLabel,
    onsubmit,
    oncancel,
  }: Props = $props();

  const today = $derived(clock.today);
  const rules = $derived(rulesFor(yearOf(today)));

  // 고칠 때는 "오늘 기준" 호봉과 다음 승급일을 보여준다(저장된 기준점은 과거일 수 있다).
  const start = untrack(() => {
    if (!initial) return null;
    const r = rulesFor(yearOf(clock.today));
    const max = maxStepOf(r.salary, initial.grade);
    const stepNow = stepOn(initial, clock.today, max, r.stepRaise.periodMonths);
    const next = nextRaiseDate(initial, clock.today, max, r.stepRaise.periodMonths);
    return { stepNow, next: next ?? initial.nextStepDate };
  });

  let nickname = $state(untrack(() => initial?.nickname ?? ''));
  let birthDate = $state<Ymd | ''>(untrack(() => initial?.birthDate ?? ''));
  let hireDate = $state<Ymd | ''>(untrack(() => initial?.hireDate ?? ''));
  let grade = $state<Grade>(untrack(() => initial?.grade ?? 9));
  let promoted = $state(untrack(() => (initial ? initial.gradeDate !== initial.hireDate : false)));
  let gradeDate = $state<Ymd | ''>(untrack(() => initial?.gradeDate ?? ''));
  let step = $state(untrack(() => start?.stepNow ?? 1));
  let nextStepDate = $state<Ymd | ''>(untrack(() => start?.next ?? ''));
  let longServiceDate = $state<Ymd | ''>(untrack(() => initial?.overrides.longServiceDate ?? ''));
  let seniorDate = $state<Ymd | ''>(untrack(() => initial?.overrides.seniorDate ?? ''));
  let payday = $state(
    untrack(() => initialPayday ?? rulesFor(yearOf(clock.today)).payday.defaultDay),
  );
  let showAdvanced = $state(
    untrack(() => !!(initial?.overrides.longServiceDate || initial?.overrides.seniorDate)),
  );
  let tried = $state(false);
  let formEl = $state<HTMLFormElement>();

  const maxStep = $derived(maxStepOf(rules.salary, grade));
  $effect(() => {
    if (step > maxStep) step = maxStep;
  });

  const draft = $derived({
    nickname,
    birthDate,
    hireDate,
    grade,
    gradeDate: promoted ? gradeDate : hireDate,
    step,
    nextStepDate,
    overrides: { longServiceDate: longServiceDate || null, seniorDate: seniorDate || null },
  });
  const errors = $derived<ProfileErrors>(
    checkProfile(draft, { today, maxStep: (g) => maxStepOf(rules.salary, g) }),
  );
  const shown = $derived<ProfileErrors>(tried ? errors : {});

  /** 승급기간(1년)을 채운 뒤 처음 오는 1일 중 오늘 다음 날 이후인 날 */
  const guessedNext = $derived.by(() => {
    if (!hireDate) return null;
    const base = promoted && gradeDate ? gradeDate : hireDate;
    let candidate = onOrNextDayOfMonth(
      periodCompleteDate(base, rules.stepRaise.periodMonths),
      rules.stepRaise.dayOfMonth,
    );
    for (let i = 0; i < 60 && candidate <= today; i += 1) {
      candidate = addMonthsClamped(candidate, rules.stepRaise.periodMonths);
    }
    return candidate;
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (Object.keys(errors).length > 0) {
      // 첫 오류로 이동
      requestAnimationFrame(() => {
        const first = formEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    onsubmit(toProfile(draft as unknown as Record<string, unknown>), payday);
  }
</script>

<form bind:this={formEl} class="form stack wide" onsubmit={submit} novalidate>
  <div class="field">
    <label for="pf-nick">닉네임 <span class="cap muted">필수</span></label>
    <input
      id="pf-nick"
      class="input"
      type="text"
      maxlength={LIMITS.nicknameMax}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      placeholder="예: 김주무관"
      bind:value={nickname}
      aria-invalid={shown.nickname ? 'true' : undefined}
      aria-describedby="pf-nick-hint"
    />
    <span class="hint cap" id="pf-nick-hint">
      실명·소속은 받지 않아요. {LIMITS.nicknameMax}자까지.
    </span>
    {#if shown.nickname}<span class="error cap" role="alert">{shown.nickname}</span>{/if}
  </div>

  <DateInput
    id="pf-birth"
    label="생년월일"
    bind:value={birthDate}
    max={today}
    required
    hint="정년퇴직일 계산에 써요."
    error={shown.birthDate}
  />

  <DateInput
    id="pf-hire"
    label="임용일"
    bind:value={hireDate}
    max={today}
    required
    hint="공무원으로 처음 임용된 날. 재직기간·연가·정근수당의 기준이에요."
    error={shown.hireDate}
  />

  <div class="grid2">
    <div class="field">
      <label for="pf-grade">현재 직급</label>
      <select
        id="pf-grade"
        class="input"
        bind:value={grade}
        aria-invalid={shown.grade ? 'true' : undefined}
      >
        {#each GRADES as g (g)}
          <option value={g}>{g}급</option>
        {/each}
      </select>
      {#if shown.grade}<span class="error cap" role="alert">{shown.grade}</span>{/if}
    </div>
    <Stepper
      id="pf-step"
      label="현재 호봉"
      bind:value={step}
      min={1}
      max={maxStep}
      unit="호봉"
      error={shown.step}
    />
  </div>

  <div class="stack">
    <label class="switch">
      <input type="checkbox" bind:checked={promoted} />
      <span class="box" aria-hidden="true"></span>
      <span>임용 후 승진한 적이 있어요</span>
    </label>
    {#if promoted}
      <DateInput
        id="pf-grade-date"
        label="현 직급 임용일(승진일)"
        bind:value={gradeDate}
        min={hireDate || undefined}
        max={today}
        hint="근속승진·대우공무원 기간의 기준이에요."
        error={shown.gradeDate}
      />
    {/if}
  </div>

  <div class="stack">
    <DateInput
      id="pf-next"
      label="다음 승급일"
      bind:value={nextStepDate}
      required
      hint="다음에 호봉이 오르는 날(보통 어느 달의 1일). 인사기록의 차기 승급일을 넣어 주세요."
      error={shown.nextStepDate}
    />
    {#if guessedNext && nextStepDate !== guessedNext}
      <div class="btn-row">
        <button type="button" class="btn small" onclick={() => (nextStepDate = guessedNext)}>
          모르겠어요: {guessedNext.replaceAll('-', '. ')}. 로 넣기
        </button>
      </div>
      <p class="cap muted">
        임용일(승진했다면 승진일)에서 1년 단위로 어림한 날이에요. 경력 인정·휴직이 있었다면 실제와
        다르니 나중에 고쳐 주세요.
      </p>
    {/if}
  </div>

  {#if askPayday}
    <fieldset class="field">
      <legend>월급날</legend>
      <div class="chips" role="radiogroup" aria-label="월급날">
        {#each rules.payday.options as option (option.day)}
          <button
            type="button"
            class="chip"
            role="radio"
            aria-checked={payday === option.day}
            onclick={() => (payday = option.day)}
          >
            {option.day}일
          </button>
        {/each}
      </div>
      <span class="hint cap">
        {rules.payday.options.find((o) => o.day === payday)?.orgs ?? ''} · 나중에 설정에서 바꿀 수 있어요.
      </span>
    </fieldset>
  {/if}

  <div class="stack">
    <button
      type="button"
      class="btn small toggle"
      aria-expanded={showAdvanced}
      aria-controls="pf-advanced"
      onclick={() => (showAdvanced = !showAdvanced)}
    >
      {showAdvanced ? '▼' : '▶'} 휴직·경력 인정 등 예외가 있어요
    </button>
    {#if showAdvanced}
      <div id="pf-advanced" class="well stack wide">
        <p class="cap muted">
          휴직·징계·경력 합산처럼 계산으로 알 수 없는 사정이 있으면 날짜를 직접 넣어 주세요. 비워
          두면 규정대로 계산해요.
        </p>
        <DateInput
          id="pf-long"
          label="근속승진 요건 충족일"
          bind:value={longServiceDate}
          hint="9·8·7급만 해당해요."
          error={shown.longServiceDate}
        />
        <DateInput
          id="pf-senior"
          label="대우공무원 선발 예정일"
          bind:value={seniorDate}
          error={shown.seniorDate}
        />
      </div>
    {/if}
  </div>

  {#if tried && Object.keys(errors).length > 0}
    <p class="note warn" role="alert">
      고칠 곳이 {Object.keys(errors).length}군데 있어요. 빨간 글씨를 확인해 주세요.
    </p>
  {/if}

  <div class="btn-row end">
    {#if oncancel}
      <button type="button" class="btn" onclick={oncancel}>취소</button>
    {/if}
    <button type="submit" class="btn primary">{submitLabel}</button>
  </div>
</form>

<style>
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    align-items: start;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 3px;
  }
  .toggle {
    justify-content: flex-start;
    width: fit-content;
  }
</style>
