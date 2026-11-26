<script lang="ts">
  import { untrack } from 'svelte';
  import {
    addMonthsClamped,
    onOrNextDayOfMonth,
    periodCompleteDate,
    yearOf,
    type Ymd,
  } from '../lib/calc/date.ts';
  import {
    careerMaxStep,
    careerOf,
    careerStepOn,
    raisePeriodOf,
    stepCeiling,
  } from '../lib/calc/career-profile.ts';
  import { dateReachedStep, nextRaiseDate } from '../lib/calc/step.ts';
  import { clock } from '../lib/app/clock.svelte.ts';
  import { formatLongDate, josa, withRo } from '../lib/app/format.ts';
  import { GENERAL_PAY_TABLE_LABEL, trackChipLabel, trackStatusText } from '../lib/app/track.ts';
  import {
    careerLookup,
    isAvailable,
    resolveCareer,
    rulesFor,
    selectableRanks,
    TRACK_IDS,
    type RankKey,
    type TrackId,
  } from '../lib/rules/index.ts';
  import {
    GENERAL_PAY_TABLES,
    LIMITS,
    type GeneralPayTableId,
    type Profile,
  } from '../lib/store/schema.ts';
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
    const c = careerOf(rulesFor, initial, yearOf(clock.today));
    const max = stepCeiling(c);
    const period = raisePeriodOf(c);
    const stepNow = careerStepOn(c, initial, clock.today);
    // 정기승급을 계산하지 않는 직종은 입력한 다음 승급일을 그대로 보여 준다
    if (period === null) return { stepNow, date: initial.nextStepDate };
    const next = nextRaiseDate(initial, clock.today, max, period);
    return { stepNow, date: next ?? dateReachedStep(initial, max, period) };
  });

  let nickname = $state(untrack(() => initial?.nickname ?? ''));
  let birthDate = $state<Ymd | ''>(untrack(() => initial?.birthDate ?? ''));
  let hireDate = $state<Ymd | ''>(untrack(() => initial?.hireDate ?? ''));
  // ── 직종 → (일반직이면) 봉급표 → 계급 ─────────────────────────────────
  let track = $state<TrackId>(untrack(() => initial?.track ?? 'general'));
  /** 일반직이 고른 봉급표. 다른 직종을 고르면 null(직종이 봉급표를 정한다) */
  let payTable = $state<GeneralPayTableId | null>(
    untrack(() => (initial ? initial.payTable : 'table3')),
  );
  /** 고른 계급 키. 저장된 계급이 사다리에 없으면 ''(다시 골라 달라고 한다) */
  let rank = $state<RankKey | ''>(
    untrack(() => {
      const r = initial ? initial.rank : '9';
      if (r === null) return '';
      const choices = selectableRanks(
        rulesFor(yearOf(clock.today)),
        initial?.track ?? 'general',
        initial ? initial.payTable : 'table3',
      );
      return choices.some((c) => c.key === r) ? r : '';
    }),
  );
  /** 직종·봉급표를 바꿔 계급을 맞춘 사실(낭독 한 번) */
  let rankNotice = $state('');
  let promoted = $state(untrack(() => (initial ? initial.rankDate !== initial.hireDate : false)));
  let rankDate = $state<Ymd | ''>(untrack(() => initial?.rankDate ?? ''));
  let step = $state(untrack(() => start?.stepNow ?? 1));
  let nextStepDate = $state<Ymd | ''>(untrack(() => start?.date ?? ''));
  let longServiceDate = $state<Ymd | ''>(untrack(() => initial?.overrides.longServiceDate ?? ''));
  let seniorDate = $state<Ymd | ''>(untrack(() => initial?.overrides.seniorDate ?? ''));
  let rankLimitDate = $state<Ymd | ''>(untrack(() => initial?.overrides.rankLimitDate ?? ''));
  let payday = $state(
    untrack(
      () =>
        initialPayday ??
        rulesFor(yearOf(clock.today)).tracks.items[initial?.track ?? 'general'].payday.defaultDay,
    ),
  );
  /** 월급날을 직접 골랐으면 직종을 바꿔도 그대로 둔다 */
  let paydayTouched = $state(false);
  let showAdvanced = $state(
    untrack(
      () =>
        !!(
          initial?.overrides.longServiceDate ||
          initial?.overrides.seniorDate ||
          initial?.overrides.rankLimitDate
        ),
    ),
  );
  let tried = $state(false);
  let formEl = $state<HTMLFormElement>();

  const trackRules = $derived(rules.tracks.items[track]);
  const trackOptions = $derived(
    TRACK_IDS.map((id) => ({ value: id, label: trackChipLabel(rules.tracks.items[id]) })),
  );
  const payTableOptions = GENERAL_PAY_TABLES.map((id) => ({
    value: id,
    label: GENERAL_PAY_TABLE_LABEL[id] ?? id,
  }));
  /** 이 직종·봉급표에서 고를 수 있는 계급(낮은 계급부터) */
  const ranks = $derived(selectableRanks(rules, track, payTable));
  /** 계급 이름을 묻지 않는 직종(교원은 계급이 하나뿐이고 이름을 쓰지 않는다) */
  const hiddenRank = $derived(ranks.length === 1 && ranks[0]?.hideLabel === true);
  const askRank = $derived(ranks.length > 0 && !hiddenRank);
  /** 저장할 계급: 칸이 있으면 고른 값, 교원은 그 하나, 사다리가 없으면 null */
  const draftRank = $derived<RankKey | null>(
    ranks.length === 0 ? null : hiddenRank ? (ranks[0]?.key ?? null) : rank || null,
  );
  const career = $derived(resolveCareer(rules, { track, payTable, rank: draftRank }));
  /** '직급'·'계급'·'직무등급' */
  const noun = $derived(career.ladder?.noun ?? '직급');
  /** 사다리에는 있지만 고를 수 없는 계급(치안총감·소방총감) */
  const unselectable = $derived((career.ladder?.ranks ?? []).filter((r) => r.selectable === false));

  function adjustRank() {
    rankNotice = '';
    const choices = selectableRanks(rules, track, payTable);
    if (choices.length === 0 || (choices.length === 1 && choices[0]?.hideLabel)) {
      // 승진할 계급이 없는 직종: 현 계급 임용일은 임용일과 같다(값은 숨겨 두고 저장할 때만 맞춘다)
      promoted = false;
      return;
    }
    if (rank !== '' && choices.some((c) => c.key === rank)) return;
    const first = choices[0];
    if (!first) return;
    const had = rank !== '';
    rank = first.key;
    const ladderNoun =
      resolveCareer(rules, { track, payTable, rank: first.key }).ladder?.noun ?? '계급';
    if (had || initial)
      rankNotice = `${josa(ladderNoun, '을', '를')} ${withRo(first.label)} 맞췄어요. 확인해 주세요.`;
  }

  function setTrack(next: TrackId) {
    if (next === track) return;
    track = next;
    payTable = next === 'general' ? (payTable ?? 'table3') : null;
    adjustRank();
    if (!paydayTouched && !initial) payday = rules.tracks.items[next].payday.defaultDay;
  }

  function setPayTable(next: GeneralPayTableId) {
    if (next === payTable) return;
    payTable = next;
    adjustRank();
  }

  /** 봉급표의 최고호봉. 봉급표가 없는 직종(준비 중)은 저장본 상한(99)까지 받는다 */
  const payMax = $derived(careerMaxStep(career));
  const maxStep = $derived(payMax ?? LIMITS.maxStepAny);
  $effect(() => {
    if (step > maxStep) step = maxStep;
  });
  /** 정기승급을 계산하는 직종인지(아니면 입력한 호봉·다음 승급일을 그대로 쓴다) */
  const raises = $derived(isAvailable(career.stepRaise));
  /** 더 오를 호봉이 없는 상태. 날짜 칸은 "최고호봉이 된 날"을 받는다 */
  const atMax = $derived(raises && payMax !== null && step >= payMax);

  // ── 예외 칸(직종·계급에 따라 보인다) ─────────────────────────────────
  const longServiceGrades = $derived(
    isAvailable(career.longService)
      ? (career.ladder?.ranks ?? []).filter(
          (r) => isAvailable(career.longService) && career.longService.monthsByGrade[r.key] != null,
        )
      : [],
  );
  const showLongService = $derived(
    draftRank !== null && longServiceGrades.some((r) => r.key === draftRank),
  );
  const showSenior = $derived(
    askRank &&
      isAvailable(career.seniorTreatment) &&
      draftRank !== null &&
      career.seniorTreatment.monthsByGrade[draftRank] != null,
  );
  /** 계급정년이 있는 직종(경찰·해양경찰·소방). 강등된 계급처럼 계급정년이 없는 계급도 날짜를 넣을 수 있다 */
  const showRankLimit = $derived(
    isAvailable(career.retirement) && career.retirement.rankLimit !== undefined,
  );

  const draft = $derived({
    nickname,
    birthDate,
    hireDate,
    track,
    payTable,
    rank: draftRank,
    rankDate: askRank && promoted ? rankDate : hireDate,
    step,
    nextStepDate,
    // 숨은 예외 칸의 값은 화면에서 지우지 않되(직종을 되돌리면 남아 있게) 저장하지 않는다
    overrides: {
      longServiceDate: (showLongService && longServiceDate) || null,
      seniorDate: (showSenior && seniorDate) || null,
      // 계급정년 날짜는 칸이 숨어도(계급정년이 없는 직종으로 잠깐 바꿔도) 지우지 않는다(설계 §6.3, 계산에 안 쓴다)
      rankLimitDate:
        (showRankLimit ? rankLimitDate : (initial?.overrides.rankLimitDate ?? '')) || null,
    },
  });
  const errors = $derived<ProfileErrors>(
    checkProfile(draft, {
      today,
      ...careerLookup(rules),
      raiseDateRule: atMax ? 'reached' : 'future',
    }),
  );
  /** 날짜 칸이 스스로 찾은 문제(세 칸이 다 찼는데 없는 날짜) */
  const dateProblems = $state<Record<string, string>>({
    birthDate: '',
    hireDate: '',
    rankDate: '',
    nextStepDate: '',
    longServiceDate: '',
    seniorDate: '',
    rankLimitDate: '',
  });

  /**
   * 화면에 보이는 칸 기준의 오류. 승진 체크를 끄면 현 직급 임용일 칸이 숨으므로(임용일과 같다고 본다)
   * 그 칸의 오류는 세지 않는다. 없는 날짜는 "넣어 주세요"보다 먼저 그 까닭을 센다.
   */
  const visibleErrors = $derived.by<ProfileErrors>(() => {
    const out: ProfileErrors = { ...errors };
    const rankDateShown = askRank && promoted;
    if (!rankDateShown) delete out.rankDate;
    const hidden: Record<string, boolean> = {
      rankDate: !rankDateShown,
      longServiceDate: !showLongService,
      seniorDate: !showSenior,
      rankLimitDate: !showRankLimit,
    };
    for (const [key, text] of Object.entries(dateProblems)) {
      if (!text || hidden[key]) continue;
      out[key as keyof ProfileErrors] = text;
    }
    return out;
  });
  const errorCount = $derived(Object.keys(visibleErrors).length);
  /**
   * 이 화면에 칸이 없는 값의 오류(교원의 계급처럼 폼이 맞춰 넣는 값). 칸 아래에 안내를 붙일 수 없으므로
   * 따로 모아 보인다(저장 버튼이 아무 말 없이 막히지 않게).
   */
  const hiddenErrors = $derived(
    Object.entries(visibleErrors).flatMap(([key, text]) => {
      if (!text) return [];
      if (key === 'rank' && !askRank) return [`${noun}: ${text}`];
      if (key === 'track') return [`직종: ${text}`];
      if (key === 'payTable') return [`봉급표: ${text}`];
      if (key === 'stepAsOf') return [`호봉 확인일: ${text}`];
      return [];
    }),
  );
  const shown = $derived<ProfileErrors>(tried ? visibleErrors : {});

  /**
   * 승급기간(1년)을 채운 뒤 처음 오는 1일 중 오늘 다음 날 이후인 날.
   * 승진해도 승급 주기는 새로 시작하지 않는다(승진 전의 잔여기간을 다음 승급기간에 넣는다,
   * 보수규정 제11조제7항). 그래서 승진 여부와 관계없이 최초 임용일에서 어림한다.
   * 정기승급을 계산하지 않는 직종에서는 어림하지 않는다.
   */
  const guessedNext = $derived.by(() => {
    const rule = career.stepRaise;
    if (!hireDate || !isAvailable(rule)) return null;
    let candidate = onOrNextDayOfMonth(
      periodCompleteDate(hireDate, rule.periodMonths),
      rule.dayOfMonth,
    );
    for (let i = 0; i < 60 && candidate <= today; i += 1) {
      candidate = addMonthsClamped(candidate, rule.periodMonths);
    }
    return candidate;
  });

  // ── 도움말(바뀌는 글자는 aria-describedby 로 이어진 요소 안에서만 바뀐다) ──
  const trackStatus = $derived(trackStatusText(trackRules));
  const birthHint = $derived(
    isAvailable(career.retirement) && career.retirement.age !== rules.retirement.age
      ? `정년(${career.retirement.age}세) 퇴직일 계산에 써요.`
      : '정년퇴직일 계산에 써요.',
  );
  const table4High = $derived(
    track === 'general' && payTable === 'table4' && draftRank !== null && Number(draftRank) <= 4,
  );
  const longServiceHint = $derived(
    longServiceGrades.length > 0
      ? `${longServiceGrades.map((r) => r.label).join('·')}만 해당해요.`
      : '',
  );
  const rankDateHint = $derived(
    showRankLimit
      ? '근속승진·대우공무원·계급정년 기간의 기준이에요.'
      : '근속승진·대우공무원 기간의 기준이에요.',
  );
  const paydayOrgs = $derived(rules.payday.options.find((o) => o.day === payday)?.orgs ?? '');

  function submit(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (errorCount > 0 || Object.keys(errors).length > 0) {
      // 접힌 예외 칸에 오류가 있으면 펼쳐서 보이게 한다
      if (visibleErrors.longServiceDate || visibleErrors.seniorDate || visibleErrors.rankLimitDate)
        showAdvanced = true;
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
    // 직종·봉급표·계급과 호봉·날짜를 건드리지 않았으면 저장돼 있던 기준점을 그대로 둔다.
    // (다시 저장하기만 해도 지나간 호봉 추정이 달라지는 일을 막는다)
    if (
      initial &&
      start &&
      track === initial.track &&
      payTable === initial.payTable &&
      draftRank === initial.rank &&
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
    hint={birthHint}
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

  <fieldset class="field" id="pf-track" aria-describedby="pf-track-hint">
    <legend id="pf-track-legend">직종</legend>
    <ChipRadio
      labelledby="pf-track-legend"
      options={trackOptions}
      value={track}
      onchange={setTrack}
    />
    <span class="hint cap stack" id="pf-track-hint">
      <span>{trackRules.scope}</span>
      {#if trackStatus === '준비 중'}
        <span>
          봉급·정년 등은 원문을 확인한 뒤 넣을게요. 그동안 재직기간·연가 장부·근무시간은 쓸 수
          있어요.
        </span>
      {:else if trackStatus}
        <span>확인한 규정만 계산하고, 나머지는 숫자 없이 '준비 중'으로 보여 드려요.</span>
      {/if}
      <span>계산 규정을 고르는 데만 써요. 실명·소속은 받지 않아요.</span>
    </span>
  </fieldset>

  {#if track === 'general'}
    <fieldset class="field" id="pf-pay-table" aria-describedby="pf-pay-table-hint">
      <legend id="pf-pay-table-legend">봉급표</legend>
      <ChipRadio
        labelledby="pf-pay-table-legend"
        options={payTableOptions}
        value={payTable ?? 'table3'}
        onchange={setPayTable}
      />
      <details class="cap" id="pf-pay-table-hint">
        <summary>별표 4는 누가 쓰나요?</summary>
        <div class="stack well">
          <p>공무원보수규정 별표 1의 별표 4 행(적용대상 공무원) 원문이에요.</p>
          <blockquote class="quote">
            교정ㆍ보호ㆍ형사법무ㆍ출입국관리ㆍ철도경찰직 공무원(4급 이상인 경우에는
            교정ㆍ보호ㆍ형사법무ㆍ출입국관리ㆍ철도경찰업무에 직접 종사하는 공무원), 감사원 소속
            공무원 중 감사 업무에 종사하는 공무원, 대통령경호처 소속 공무원 중 경호 업무에 직접
            종사하는 공무원, 중대범죄수사청수사관, 공소청ㆍ중대범죄수사청 소속 공무원 중
            과학기술직공무원(4급 이상인 경우에는 과학기술 업무에 직접 종사하는 공무원), 국가정보원
            직원 중 1급부터 9급까지의 특정직 직원, 법원 소속 공무원 중
            법원사무직ㆍ등기사무직ㆍ조사사무직ㆍ통역직 및 법원경위직 공무원, 헌법재판소 소속 공무원
            중 헌법재판 지원 업무에 종사하는 법원사무직ㆍ행정직ㆍ법정경위직 공무원, 국회 소속 공무원
            중 경위직공무원(경호 업무에 직접 종사하는 4급을 포함한다)
          </blockquote>
          <p id="pf-pay-table-special">
            국가정보원 직원·경호공무원·중대범죄수사청수사관(특정직)은 '그 밖의 특정직'을 골라
            주세요. 법원·헌법재판소·국회 소속은 승진 규정이 달라 승진·근속승진·대우공무원 날짜가
            다를 수 있어요.
          </p>
        </div>
      </details>
    </fieldset>
  {/if}

  <div class="grid2">
    {#if askRank}
      <div class="field">
        <label for="pf-rank">현재 {noun}</label>
        <select
          id="pf-rank"
          class="input"
          bind:value={rank}
          onchange={() => (rankNotice = '')}
          aria-invalid={shown.rank ? 'true' : undefined}
          aria-describedby={[
            unselectable.length > 0 ? 'pf-rank-hint' : '',
            table4High ? 'pf-rank-warn' : '',
            shown.rank ? 'pf-rank-error' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined}
        >
          {#if !ranks.some((r) => r.key === rank)}
            <option value="" disabled>골라 주세요</option>
          {/if}
          {#each ranks as r (r.key)}
            <option value={r.key}>{r.label}</option>
          {/each}
        </select>
        <p class="sr-only" role="status" aria-live="polite">{rankNotice}</p>
        {#if rankNotice}<span class="hint cap" aria-hidden="true">{rankNotice}</span>{/if}
        {#if unselectable.length > 0}
          <span class="hint cap" id="pf-rank-hint">
            {#each unselectable as r (r.key)}
              {josa(r.label, '은', '는')} 고를 수 없어요. {r.note ?? ''}
            {/each}
          </span>
        {/if}
        {#if table4High}
          <span class="note warn cap" id="pf-rank-warn">
            4급 이상은 해당 업무에 직접 종사할 때만 별표 4예요. 아니면 별표 3을 골라 주세요.
          </span>
        {/if}
        {#if shown.rank}<span class="error cap" id="pf-rank-error">{shown.rank}</span>{/if}
      </div>
    {/if}
    <Stepper
      id="pf-step"
      label="현재 호봉"
      bind:value={step}
      min={1}
      max={maxStep}
      unit="호봉"
      hint={raises ? undefined : '인사기록의 호봉을 넣어 주세요. 승급은 자동으로 계산하지 않아요.'}
      error={shown.step}
    />
  </div>

  {#if askRank}
    <div class="stack">
      <label class="switch">
        <input type="checkbox" bind:checked={promoted} />
        <span class="box" aria-hidden="true"></span>
        <span>임용 후 승진한 적이 있어요</span>
      </label>
      {#if promoted}
        <DateInput
          id="pf-rank-date"
          bind:problem={dateProblems.rankDate}
          label="현 {noun} 임용일(승진일)"
          bind:value={rankDate}
          min={hireDate || undefined}
          max={today}
          required
          hint={rankDateHint}
          error={shown.rankDate}
        />
      {/if}
    </div>
  {/if}

  <div class="stack">
    <DateInput
      id="pf-next"
      bind:problem={dateProblems.nextStepDate}
      label={atMax ? '최고호봉이 된 날' : '다음 승급일'}
      bind:value={nextStepDate}
      required
      hint={atMax
        ? '더 오를 호봉이 없어요. 최고호봉이 된 날을 넣어 주세요. 정확히 몰라도 괜찮아요(지금까지 번 봉급을 어림할 때만 써요).'
        : raises
          ? "인사기록의 차기 승급일을 넣어 주세요(보통 어느 달 1일). 미뤄졌다면 아래 '예외가 있어요'를 보세요."
          : '인사기록의 다음 승급일. 그날이 지나면 호봉을 고쳐 달라고 알려 드릴게요.'}
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
    <fieldset class="field" aria-describedby="pf-payday-hint">
      <legend>월급날</legend>
      <ChipRadio
        label="월급날"
        options={rules.payday.options.map((o) => ({ value: o.day, label: `${o.day}일` }))}
        value={payday}
        onchange={(day) => {
          payday = day;
          paydayTouched = true;
        }}
      />
      <span class="hint cap stack" id="pf-payday-hint">
        <span>
          {payday}일{paydayOrgs ? `: ${paydayOrgs}` : ''} · 나중에 설정에서 바꿀 수 있어요.
        </span>
        {#if trackRules.payday.note}<span>{trackRules.payday.note}</span>{/if}
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
        {#if showLongService || showSenior || showRankLimit}
          <p class="cap muted">
            휴직·징계·경력 합산처럼 계산으로 알 수 없는 사정이 있으면 날짜를 직접 넣어 주세요. 비워
            두면 규정대로 계산해요.
          </p>
        {/if}
        {#if showLongService}
          <DateInput
            id="pf-long"
            bind:problem={dateProblems.longServiceDate}
            label="근속승진 요건 충족일"
            bind:value={longServiceDate}
            hint={longServiceHint}
            error={shown.longServiceDate}
          />
        {/if}
        {#if showSenior}
          <DateInput
            id="pf-senior"
            bind:problem={dateProblems.seniorDate}
            label="대우공무원 선발 예정일"
            bind:value={seniorDate}
            error={shown.seniorDate}
          />
        {/if}
        {#if showRankLimit}
          <DateInput
            id="pf-rank-limit"
            bind:problem={dateProblems.rankLimitDate}
            label="계급정년에 이르는 날"
            bind:value={rankLimitDate}
            hint="강등·재임용·자치경찰 경력·정년 연장 등으로 다르면 넣어 주세요."
            error={shown.rankLimitDate}
          />
        {/if}
      </div>
    {/if}
  </div>

  {#if tried && errorCount > hiddenErrors.length}
    <p class="note warn" role="alert">
      고칠 곳이 {errorCount - hiddenErrors.length}군데 있어요. 각 칸 아래의 안내를 확인해 주세요.
    </p>
  {/if}
  {#if tried && hiddenErrors.length > 0}
    <div class="note warn stack" role="alert" id="pf-hidden-errors">
      <p>
        저장된 값 중 이 화면에서 고칠 수 없는 칸이 있어 저장하지 못했어요. 설정에서 데이터를
        내려받아 보관해 두세요.
      </p>
      <ul class="cap">
        {#each hiddenErrors as text (text)}<li>{text}</li>{/each}
      </ul>
    </div>
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
  details summary {
    cursor: pointer;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  /* 글자가 두 줄로 넘어가도 표시(▶/▼) 옆에 왼쪽 정렬로 붙는다 */
  .quote {
    margin: 0;
    padding-left: 9px;
    border-left: 3px solid var(--ink-2);
    overflow-wrap: anywhere;
  }
  .toggle {
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    width: fit-content;
  }
</style>
