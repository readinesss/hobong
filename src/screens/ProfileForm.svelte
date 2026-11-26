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
  import { dateReachedStep, nextRaiseDate, stepOn } from '../lib/calc/step.ts';
  import { clock } from '../lib/app/clock.svelte.ts';
  import { formatLongDate } from '../lib/app/format.ts';
  import { rulesFor } from '../lib/rules/index.ts';
  import { GRADES, LIMITS, type Grade, type Profile } from '../lib/store/schema.ts';
  import { checkProfile, toProfile, type ProfileErrors } from '../lib/store/validate.ts';
  import ChipRadio from '../lib/ui/ChipRadio.svelte';
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
  // 최고호봉이면 다음 승급일이 없으므로 그 자리에 "최고호봉이 된 날"을 보여준다.
  const start = untrack(() => {
    if (!initial) return null;
    const r = rulesFor(yearOf(clock.today));
    const max = maxStepOf(r.salary, initial.grade);
    const period = r.stepRaise.periodMonths;
    const stepNow = stepOn(initial, clock.today, max, period);
    const next = nextRaiseDate(initial, clock.today, max, period);
    return { stepNow, date: next ?? dateReachedStep(initial, max, period) };
  });

  let nickname = $state(untrack(() => initial?.nickname ?? ''));
  let birthDate = $state<Ymd | ''>(untrack(() => initial?.birthDate ?? ''));
  let hireDate = $state<Ymd | ''>(untrack(() => initial?.hireDate ?? ''));
  let grade = $state<Grade>(untrack(() => initial?.grade ?? 9));
  let promoted = $state(untrack(() => (initial ? initial.gradeDate !== initial.hireDate : false)));
  let gradeDate = $state<Ymd | ''>(untrack(() => initial?.gradeDate ?? ''));
  let step = $state(untrack(() => start?.stepNow ?? 1));
  let nextStepDate = $state<Ymd | ''>(untrack(() => start?.date ?? ''));
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
  /** 더 오를 호봉이 없는 상태. 날짜 칸은 "최고호봉이 된 날"을 받는다 */
  const atMax = $derived(step >= maxStep);

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
    checkProfile(draft, {
      today,
      maxStep: (g) => maxStepOf(rules.salary, g),
      raiseDateRule: atMax ? 'reached' : 'future',
    }),
  );
  /** 날짜 칸이 스스로 찾은 문제(세 칸이 다 찼는데 없는 날짜) */
  const dateProblems = $state<Record<string, string>>({
    birthDate: '',
    hireDate: '',
    gradeDate: '',
    nextStepDate: '',
    longServiceDate: '',
    seniorDate: '',
  });

  /**
   * 화면에 보이는 칸 기준의 오류. 승진 체크를 끄면 현 직급 임용일 칸이 숨으므로(임용일과 같다고 본다)
   * 그 칸의 오류는 세지 않는다. 없는 날짜는 "넣어 주세요"보다 먼저 그 까닭을 센다.
   */
  const visibleErrors = $derived.by<ProfileErrors>(() => {
    const out: ProfileErrors = { ...errors };
    if (!promoted) delete out.gradeDate;
    for (const [key, text] of Object.entries(dateProblems)) {
      if (!text) continue;
      if (key === 'gradeDate' && !promoted) continue;
      out[key as keyof ProfileErrors] = text;
    }
    return out;
  });
  const errorCount = $derived(Object.keys(visibleErrors).length);
  const shown = $derived<ProfileErrors>(tried ? visibleErrors : {});

  /**
   * 승급기간(1년)을 채운 뒤 처음 오는 1일 중 오늘 다음 날 이후인 날.
   * 승진해도 승급 주기는 새로 시작하지 않는다(승진 전의 잔여기간을 다음 승급기간에 넣는다,
   * 보수규정 제11조제7항). 그래서 승진 여부와 관계없이 최초 임용일에서 어림한다.
   */
  const guessedNext = $derived.by(() => {
    if (!hireDate) return null;
    let candidate = onOrNextDayOfMonth(
      periodCompleteDate(hireDate, rules.stepRaise.periodMonths),
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
    if (errorCount > 0 || Object.keys(errors).length > 0) {
      // 접힌 예외 칸에 오류가 있으면 펼쳐서 보이게 한다
      if (visibleErrors.longServiceDate || visibleErrors.seniorDate) showAdvanced = true;
      // 첫 오류로 이동
      requestAnimationFrame(() => {
        const first = formEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    onsubmit(toProfile({ ...draft, ...anchorFields() }), payday);
  }

  /** 저장할 호봉 기준점(호봉, 다음 승급일, 확인한 날) */
  function anchorFields(): { step: number; nextStepDate: Ymd; stepAsOf: Ymd } {
    // 호봉과 날짜를 건드리지 않았으면 저장돼 있던 기준점을 그대로 둔다.
    // (다시 저장하기만 해도 지나간 호봉 추정이 달라지는 일을 막는다)
    if (
      initial &&
      start &&
      grade === initial.grade &&
      step === start.stepNow &&
      nextStepDate === start.date
    ) {
      return {
        step: initial.step,
        nextStepDate: initial.nextStepDate,
        stepAsOf: initial.stepAsOf,
      };
    }
    // 최고호봉: "바로 아래 호봉이 그날 전날까지"라고 적어 두면 그날부터 최고호봉이 된다.
    if (atMax) return { step: maxStep - 1, nextStepDate: nextStepDate as Ymd, stepAsOf: today };
    return { step, nextStepDate: nextStepDate as Ymd, stepAsOf: today };
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
      placeholder="예: 호봉이집사"
      bind:value={nickname}
      aria-invalid={shown.nickname ? 'true' : undefined}
      aria-describedby={shown.nickname ? 'pf-nick-hint pf-nick-error' : 'pf-nick-hint'}
    />
    <span class="hint cap" id="pf-nick-hint">
      닉네임만 적어 주세요. 실명·소속은 적지 마세요. {LIMITS.nicknameMax}자까지.
    </span>
    {#if shown.nickname}<span class="error cap" id="pf-nick-error">{shown.nickname}</span>{/if}
  </div>

  <DateInput
    id="pf-birth"
    bind:problem={dateProblems.birthDate}
    label="생년월일"
    bind:value={birthDate}
    max={today}
    required
    hint="정년퇴직일 계산에 써요."
    error={shown.birthDate}
  />

  <DateInput
    id="pf-hire"
    bind:problem={dateProblems.hireDate}
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
        aria-describedby={shown.grade ? 'pf-grade-error' : undefined}
      >
        {#each GRADES as g (g)}
          <option value={g}>{g}급</option>
        {/each}
      </select>
      {#if shown.grade}<span class="error cap" id="pf-grade-error">{shown.grade}</span>{/if}
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
        bind:problem={dateProblems.gradeDate}
        label="현 직급 임용일(승진일)"
        bind:value={gradeDate}
        min={hireDate || undefined}
        max={today}
        required
        hint="근속승진·대우공무원 기간의 기준이에요."
        error={shown.gradeDate}
      />
    {/if}
  </div>

  <div class="stack">
    <DateInput
      id="pf-next"
      bind:problem={dateProblems.nextStepDate}
      label={atMax ? '최고호봉이 된 날' : '다음 승급일'}
      bind:value={nextStepDate}
      required
      hint={atMax
        ? '더 오를 호봉이 없어요. 최고호봉이 된 날을 넣어 주세요. 정확히 몰라도 괜찮아요(지금까지 번 봉급을 어림할 때만 써요).'
        : "인사기록의 차기 승급일을 넣어 주세요(보통 어느 달 1일). 미뤄졌다면 아래 '예외가 있어요'를 보세요."}
      error={shown.nextStepDate}
    />
    {#if !atMax && guessedNext && nextStepDate !== guessedNext}
      <div class="btn-row">
        <button type="button" class="btn small" onclick={() => (nextStepDate = guessedNext)}>
          잘 모르겠어요 → {formatLongDate(guessedNext)}로 채우기
        </button>
      </div>
      <p class="cap muted">
        최초 임용일에서 1년 단위로 어림한 날이에요. 경력 인정·휴직·승급 제한이 있었다면 실제와
        다르니 인사기록을 확인해 고쳐 주세요.
      </p>
    {/if}
  </div>

  {#if askPayday}
    <fieldset class="field">
      <legend>월급날</legend>
      <ChipRadio
        label="월급날"
        options={rules.payday.options.map((o) => ({ value: o.day, label: `${o.day}일` }))}
        value={payday}
        onchange={(day) => (payday = day)}
      />
      <span class="hint cap">
        {payday}일: {rules.payday.options.find((o) => o.day === payday)?.orgs ?? ''} · 나중에 설정에서
        바꿀 수 있어요.
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
      <span aria-hidden="true">{showAdvanced ? '▼' : '▶'}</span>
      <span>휴직·경력 인정 등 예외가 있어요</span>
    </button>
    {#if showAdvanced}
      <div id="pf-advanced" class="well stack wide">
        <p class="cap muted">
          휴직 등으로 승급이 미뤄졌다면 위 '다음 승급일'에 미뤄진 날짜를 그대로 넣어 주세요.
          그날까지 지금 호봉으로 계산해요.
        </p>
        <p class="cap muted">
          휴직·징계·경력 합산처럼 계산으로 알 수 없는 사정이 있으면 날짜를 직접 넣어 주세요. 비워
          두면 규정대로 계산해요.
        </p>
        <DateInput
          id="pf-long"
          bind:problem={dateProblems.longServiceDate}
          label="근속승진 요건 충족일"
          bind:value={longServiceDate}
          hint="9·8·7급만 해당해요."
          error={shown.longServiceDate}
        />
        <DateInput
          id="pf-senior"
          bind:problem={dateProblems.seniorDate}
          label="대우공무원 선발 예정일"
          bind:value={seniorDate}
          error={shown.seniorDate}
        />
      </div>
    {/if}
  </div>

  {#if tried && errorCount > 0}
    <p class="note warn" role="alert">
      고칠 곳이 {errorCount}군데 있어요. 각 칸 아래의 안내를 확인해 주세요.
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
  /* 호봉 스테퍼(−, 입력, '호봉', +)는 190px 쯤 필요하다. 좁으면 한 열로 떨어진다. */
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
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
  /* 글자가 두 줄로 넘어가도 표시(▶/▼) 옆에 왼쪽 정렬로 붙는다 */
  .toggle {
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    width: fit-content;
  }
</style>
