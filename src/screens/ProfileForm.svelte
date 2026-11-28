<script lang="ts">
  import { untrack } from 'svelte';
  import { ProfileDraft } from '../lib/app/draft.svelte.ts';
  import { formatLongDate, josa } from '../lib/app/format.ts';
  import { GENERAL_PAY_TABLE_LABEL, paydayChipLabel, trackChipLabel } from '../lib/app/track.ts';
  import { TRACK_IDS } from '../lib/rules/index.ts';
  import { GENERAL_PAY_TABLES, LIMITS, type Profile } from '../lib/store/schema.ts';
  import { TALK } from '../lib/talk.ts';
  import type { ProfileErrors } from '../lib/store/validate.ts';
  import ChipRadio from '../lib/ui/ChipRadio.svelte';
  import DateInput from '../lib/ui/DateInput.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Stepper from '../lib/ui/Stepper.svelte';
  import SeriesPicker from './profile/SeriesPicker.svelte';

  interface Props {
    /** 고칠 때의 기존 값. 없으면 새로 만든다 */
    initial?: Profile;
    /** 처음 만들 때만 월급날을 함께 묻는다 */
    initialPayday?: number;
    askPayday?: boolean;
    /**
     * 바깥이 가진 초안(첫 입력: 말을 거는 방식과 값을 함께 쓴다). 주지 않으면 initial 로 새로 만든다
     */
    draft?: ProfileDraft;
    submitLabel: string;
    /**
     * 다 채운 순간 [제출] 단추가 살아나는 변화(첫 입력의 [알 깨우기]: 부록 P3). 주지 않으면 단추가 늘 그대로다.
     * 단추는 처음부터 눌린다(비활성 단추는 쓰지 않는다: 누르면 빠진 칸으로 데려간다). 다 채우면 아이콘이 붙고
     * 귀퉁이에 금빛 반짝이가 붙으며, 단추 위의 한 줄이 pending → line 으로 바뀐다(바뀐 한 줄만 알림 영역이 한 번 읽는다).
     */
    ready?: { icon: string; line: string; pending: string };
    /** celebrate: 고칠 때 계급이 올랐고 사용자가 '승진했어요'를 켜 두었는지 */
    onsubmit: (profile: Profile, payday: number, options: { celebrate: boolean }) => void;
    oncancel?: () => void;
  }

  let {
    initial,
    initialPayday,
    askPayday = false,
    draft,
    submitLabel,
    ready,
    onsubmit,
    oncancel,
  }: Props = $props();

  /** 값·검사·직종 맞추기는 초안이 맡는다(src/lib/app/draft.svelte.ts) */
  const d = untrack(() => draft ?? new ProfileDraft(initial, initialPayday));
  $effect(() => d.clampStep());

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

  const trackOptions = $derived(
    TRACK_IDS.map((id) => ({ value: id, label: trackChipLabel(d.rules.tracks.items[id]) })),
  );
  const payTableOptions = GENERAL_PAY_TABLES.map((id) => ({
    value: id,
    label: GENERAL_PAY_TABLE_LABEL[id] ?? id,
  }));
  const shown = $derived<ProfileErrors>(tried ? d.visibleErrors : {});
  /** 직렬을 고르는 직종의 이름('일반직·지방 일반직') — 직종 데이터의 seriesScope 로 고른다 */
  const seriesTrackNames = $derived(
    TRACK_IDS.filter((id) => d.rules.tracks.items[id].seriesScope)
      .map((id) => d.rules.tracks.items[id].label)
      .join('·'),
  );
  /** 직렬 고르기의 [직종 고르기로 가기]: 직종 칸의 고른 칩으로 옮긴다(직종은 사용자가 고른다) */
  function focusTrack() {
    formEl?.querySelector<HTMLElement>('#pf-track [role="radio"][tabindex="0"]')?.focus();
  }

  /**
   * 고치는 중에 승진으로 볼 만한지: 같은 직종·봉급표(같은 사다리)에서 계급 순서가 오르고 승진일이 뒤로 바뀌었다.
   * 그때만 '승진했어요' 스위치를 보인다(틀린 값을 바로잡는 사람에게 축하 연출이 뜨지 않게 끌 수 있다).
   */
  const promotes = $derived.by(() => {
    if (!initial || initial.rank === null || !d.askRank || d.rank === '') return false;
    if (d.track !== initial.track || d.payTable !== initial.payTable) return false;
    const from = d.ranks.findIndex((r) => r.key === initial.rank);
    const to = d.ranks.findIndex((r) => r.key === d.rank);
    return (
      from >= 0 && to > from && d.promoted && d.rankDate !== '' && d.rankDate > initial.rankDate
    );
  });
  let celebrate = $state(true);

  function submit(event: SubmitEvent) {
    event.preventDefault();
    tried = true;
    if (!d.valid) {
      // 접힌 예외 칸에 오류가 있으면 펼쳐서 보이게 한다
      if (
        d.visibleErrors.longServiceDate ||
        d.visibleErrors.seniorDate ||
        d.visibleErrors.rankLimitDate
      )
        showAdvanced = true;
      // 첫 오류로 이동
      requestAnimationFrame(() => {
        const first = formEl?.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.focus();
        first?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    onsubmit(d.toProfile(), d.payday, { celebrate: promotes && celebrate });
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
      bind:value={d.nickname}
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
    bind:problem={d.dateProblems.birthDate}
    label="생년월일"
    bind:value={d.birthDate}
    max={d.today}
    required
    hint={d.birthHint}
    error={shown.birthDate}
  />

  <DateInput
    id="pf-hire"
    bind:problem={d.dateProblems.hireDate}
    label="임용일"
    bind:value={d.hireDate}
    max={d.today}
    required
    hint="공무원으로 처음 임용된 날. 재직기간·연가·정근수당의 기준이에요."
    error={shown.hireDate}
  />

  <fieldset class="field" id="pf-track" aria-describedby="pf-track-hint">
    <legend id="pf-track-legend">직종</legend>
    <ChipRadio
      labelledby="pf-track-legend"
      options={trackOptions}
      value={d.track}
      onchange={(next) => d.setTrack(next)}
    />
    <span class="hint cap stack" id="pf-track-hint">
      <span>{d.trackRules.scope}</span>
      {#if d.trackStatus === '준비 중'}
        <span>
          봉급·정년 등은 원문을 확인한 뒤 넣을게요. 그동안 재직기간·연가 장부·근무시간은 쓸 수
          있어요.
        </span>
      {:else if d.trackStatus}
        <span>확인한 규정만 계산하고, 나머지는 숫자 없이 '준비 중'으로 보여 드려요.</span>
      {/if}
      <span>계산 규정을 고르는 데만 써요. 실명·소속은 받지 않아요.</span>
    </span>
  </fieldset>

  {#if d.askPayTable}
    <fieldset class="field" id="pf-pay-table" aria-describedby="pf-pay-table-hint">
      <legend id="pf-pay-table-legend">봉급표</legend>
      <ChipRadio
        labelledby="pf-pay-table-legend"
        options={payTableOptions}
        value={d.payTable ?? 'table3'}
        onchange={(next) => d.setPayTable(next)}
      />
      <!-- 직종을 바꿔 돌아왔는데 전에 고른 봉급표를 모를 때 첫 표로 맞춘 사실(낭독 한 번, 보이는 글은 고를 때까지) -->
      <p class="sr-only" role="status" aria-live="polite">{d.payTableNotice}</p>
      {#if d.payTableNotice}
        <span class="hint cap" id="pf-pay-table-notice" aria-hidden="true">{d.payTableNotice}</span>
      {/if}
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

  {#if d.seriesScope}
    <SeriesPicker
      value={d.series}
      jikryu={d.seriesJikryu}
      scope={d.seriesScope}
      rules={d.rules}
      career={d.career}
      onchange={(series, jikryu) => d.setSeries(series, jikryu)}
      ongotrack={focusTrack}
    />
  {:else if d.series !== null}
    <div class="note stack" id="pf-series-kept">
      <p>
        고른 직렬({d.series})은 직렬을 고르는 직종({seriesTrackNames})일 때만 써요. 남겨 두면 그
        직종으로 되돌아올 때 다시 써요.
      </p>
      <div class="btn-row">
        <button type="button" class="btn small" onclick={() => d.setSeries(null)}>
          직렬 지우기
        </button>
      </div>
    </div>
  {/if}

  <div class="grid2">
    {#if d.askRank}
      <div class="field">
        <label for="pf-rank">현재 {d.noun}</label>
        <select
          id="pf-rank"
          class="input"
          bind:value={d.rank}
          onchange={() => (d.rankNotice = '')}
          aria-invalid={shown.rank ? 'true' : undefined}
          aria-describedby={[
            d.unselectable.length > 0 ? 'pf-rank-hint' : '',
            d.table4High ? 'pf-rank-warn' : '',
            shown.rank ? 'pf-rank-error' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined}
        >
          {#if !d.ranks.some((r) => r.key === d.rank)}
            <option value="" disabled>골라 주세요</option>
          {/if}
          {#each d.ranks as r (r.key)}
            <option value={r.key}>{r.label}</option>
          {/each}
        </select>
        <p class="sr-only" role="status" aria-live="polite">{d.rankNotice}</p>
        {#if d.rankNotice}<span class="hint cap" aria-hidden="true">{d.rankNotice}</span>{/if}
        {#if d.unselectable.length > 0}
          <span class="hint cap" id="pf-rank-hint">
            {#each d.unselectable as r (r.key)}
              {josa(r.label, '은', '는')} 고를 수 없어요. {r.note ?? ''}
            {/each}
          </span>
        {/if}
        {#if d.table4High}
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
      bind:value={d.step}
      min={1}
      max={d.maxStep}
      unit="호봉"
      hint={d.raises
        ? initial
          ? undefined
          : TALK.questions.step.later
        : '인사기록의 호봉을 넣어 주세요. 승급은 자동으로 계산하지 않아요.'}
      error={shown.step}
    />
  </div>

  {#if d.askRank}
    <div class="stack">
      <label class="switch">
        <input type="checkbox" bind:checked={d.promoted} />
        <span class="box" aria-hidden="true"></span>
        <span>임용 후 승진한 적이 있어요</span>
      </label>
      {#if d.promoted}
        <DateInput
          id="pf-rank-date"
          bind:problem={d.dateProblems.rankDate}
          label="현 {d.noun} 임용일(승진일)"
          bind:value={d.rankDate}
          min={d.hireDate || undefined}
          max={d.today}
          required
          hint={d.rankDateHint}
          error={shown.rankDate}
        />
      {/if}
    </div>
  {/if}

  <div class="stack">
    <DateInput
      id="pf-next"
      bind:problem={d.dateProblems.nextStepDate}
      label={d.nextLabel}
      bind:value={d.nextStepDate}
      required
      hint={d.nextHint}
      error={shown.nextStepDate}
    />
    {#if !d.atMax && d.guessedNext && d.nextStepDate !== d.guessedNext}
      <div class="btn-row">
        <button
          type="button"
          class="btn small"
          onclick={() => (d.nextStepDate = d.guessedNext ?? '')}
        >
          잘 모르겠어요 → {formatLongDate(d.guessedNext)}로 채우기
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
        options={d.paydayOptions.map((o) => ({
          value: o.day,
          label: paydayChipLabel(o, d.career.payday.defaultDay),
        }))}
        value={d.payday}
        onchange={(day) => d.setPayday(day)}
      />
      <span class="hint cap stack" id="pf-payday-hint">
        <span>
          {d.payday}일{d.paydayOrgs ? `: ${d.paydayOrgs}` : ''} · 나중에 설정에서 바꿀 수 있어요.
        </span>
        {#if d.trackRules.payday.note}<span>{d.trackRules.payday.note}</span>{/if}
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
        {#if d.showLongService || d.showSenior || d.showRankLimit}
          <p class="cap muted">
            휴직·징계·경력 합산처럼 계산으로 알 수 없는 사정이 있으면 날짜를 직접 넣어 주세요. 비워
            두면 규정대로 계산해요.
          </p>
        {/if}
        {#if d.showLongService}
          <DateInput
            id="pf-long"
            bind:problem={d.dateProblems.longServiceDate}
            label="근속승진 요건 충족일"
            bind:value={d.longServiceDate}
            hint={d.longServiceHint}
            error={shown.longServiceDate}
          />
        {/if}
        {#if d.showSenior}
          <DateInput
            id="pf-senior"
            bind:problem={d.dateProblems.seniorDate}
            label="대우공무원 선발 예정일"
            bind:value={d.seniorDate}
            error={shown.seniorDate}
          />
        {/if}
        {#if d.showRankLimit}
          <DateInput
            id="pf-rank-limit"
            bind:problem={d.dateProblems.rankLimitDate}
            label="계급정년에 이르는 날"
            bind:value={d.rankLimitDate}
            hint="강등·재임용·자치경찰 경력·정년 연장 등으로 다르면 넣어 주세요."
            error={shown.rankLimitDate}
          />
        {/if}
      </div>
    {/if}
  </div>

  {#if tried && d.errorCount > d.hiddenErrors.length}
    <p class="note warn" role="alert">
      고칠 곳이 {d.errorCount - d.hiddenErrors.length}군데 있어요. 각 칸 아래의 안내를 확인해
      주세요.
    </p>
  {/if}
  {#if tried && d.hiddenErrors.length > 0}
    <div class="note warn stack" role="alert" id="pf-hidden-errors">
      <p>
        저장된 값 중 이 화면에서 고칠 수 없는 칸이 있어 저장하지 못했어요. 설정에서 데이터를
        내려받아 보관해 두세요.
      </p>
      <ul class="cap">
        {#each d.hiddenErrors as text (text)}<li>{text}</li>{/each}
      </ul>
    </div>
  {/if}

  {#if promotes}
    <div class="stack" id="pf-promote">
      <label class="switch">
        <input type="checkbox" bind:checked={celebrate} />
        <span class="box" aria-hidden="true"></span>
        <span>승진했어요 (축하 연출 보기)</span>
      </label>
      <span class="hint cap">
        {josa(d.noun, '이', '가')} 오르고 승진일이 바뀌어 여쭤봐요. 틀린 값을 바로잡는 것이라면 꺼 주세요.
      </span>
    </div>
  {/if}

  {#if ready}
    <!-- 다 채웠을 때의 한 줄만 알림 영역에 넣는다(채우는 동안의 안내는 읽어 주지 않는다) -->
    <p class="cap ready-line" class:muted={!d.valid} id="pf-ready">
      <span role="status">{d.valid ? ready.line : ''}</span>
      {#if !d.valid}{ready.pending}{/if}
    </p>
  {/if}
  <div class="btn-row end">
    {#if oncancel}
      <button type="button" class="btn" onclick={oncancel}>취소</button>
    {/if}
    <button type="submit" class="btn primary" class:ready={ready && d.valid}>
      {#if ready && d.valid}<span class="pop-in ready-icon"><Icon name={ready.icon} /></span>{/if}
      {submitLabel}
    </button>
  </div>
</form>

<style>
  .ready-line {
    text-align: right;
  }
  /*
    다 채운 [알 깨우기]: 단추 오른쪽 위 귀퉁이에 금빛 반짝이 한 점(먹색 테두리)이 붙는다. 깜빡이지 않고 그대로 있다.
    둘레 테(outline·box-shadow 링)는 쓰지 않는다: 야근 모드의 포커스 링(금색)과 헷갈린다.
  */
  .btn.ready::before {
    --p: var(--u);
    --ink: #1a1c2c;
    content: '';
    position: absolute;
    top: calc(var(--p) * -1);
    right: calc(var(--p) * -1);
    width: var(--p);
    height: var(--p);
    background: var(--gold);
    pointer-events: none;
    box-shadow:
      0 calc(var(--p) * -1) var(--gold),
      0 var(--p) var(--gold),
      calc(var(--p) * -1) 0 var(--gold),
      var(--p) 0 var(--gold),
      0 calc(var(--p) * -2) var(--ink),
      0 calc(var(--p) * 2) var(--ink),
      calc(var(--p) * -2) 0 var(--ink),
      calc(var(--p) * 2) 0 var(--ink),
      calc(var(--p) * -1) calc(var(--p) * -1) var(--ink),
      var(--p) calc(var(--p) * -1) var(--ink),
      calc(var(--p) * -1) var(--p) var(--ink),
      var(--p) var(--p) var(--ink);
  }
  .ready-icon {
    display: inline-flex;
  }
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
