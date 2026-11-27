<script lang="ts">
  /**
   * 말을 거는 첫 입력: 알이 하나씩 묻고, 답할 때마다 맞장구를 치며 금이 간다.
   *
   * - 값과 검사는 초안(ProfileDraft)이 맡는다. '한 번에 쓰기'(ProfileForm)와 같은 초안이라 오가도 값이 남는다.
   * - 질문 차례·필수 여부·알 단계는 src/lib/onboarding/questions.ts, 대사는 data/talk.json.
   * - 낭독: 질문이 바뀌면 입력 칸으로 포커스를 옮기고, 질문 문장이 칸(묶음)의 이름, 맞장구·알 상태·남은 칸이 설명이다.
   *   따로 알리는 영역(live)은 두지 않는다(포커스 낭독과 겹쳐 두 번 읽지 않게).
   * - 알 그림은 장식(aria-hidden)이고, 소리·진동은 신호(emitCue)만 낸다.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { ProfileDraft } from '../../lib/app/draft.svelte.ts';
  import { formatLongDate, josa } from '../../lib/app/format.ts';
  import { hapticsSupported, setHapticsEnabled } from '../../lib/app/haptics.ts';
  import { GENERAL_PAY_TABLE_LABEL, trackChipLabel } from '../../lib/app/track.ts';
  import { formatKorean, type Ymd } from '../../lib/calc/date.ts';
  import { eggStageFor } from '../../lib/character/egg.ts';
  import {
    formIdFor,
    resolveCustom,
    resolveLook,
    trackPropOf,
    type PropRule,
  } from '../../lib/character/look.ts';
  import { characterRules } from '../../lib/character/rules.ts';
  import { propOwnerOf, themeOfSeries } from '../../lib/character/series.ts';
  import { emitCue } from '../../lib/fx/cues.ts';
  import {
    firstProblem,
    isOptional,
    problemsOf,
    progressOf,
    questionsFor,
    uncoveredKeys,
    type QuestionId,
  } from '../../lib/onboarding/questions.ts';
  import { TRACK_IDS, type RankKey } from '../../lib/rules/index.ts';
  import { GENERAL_PAY_TABLES, LIMITS, type CharacterLook } from '../../lib/store/schema.ts';
  import { fillLine, newTalkSeed, pickLine, TALK } from '../../lib/talk.ts';
  import ChipRadio from '../../lib/ui/ChipRadio.svelte';
  import DateInput from '../../lib/ui/DateInput.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Modal from '../../lib/ui/Modal.svelte';
  import Progress from '../../lib/ui/Progress.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';
  import Stepper from '../../lib/ui/Stepper.svelte';
  import LookEditor from '../customize/LookEditor.svelte';
  import SeriesPicker from '../profile/SeriesPicker.svelte';
  import EggStage, { type EggReaction } from './EggStage.svelte';

  interface Props {
    draft: ProfileDraft;
    /** 고른 꾸미기(소품 질문과 '호봉이 꾸미기'가 바꾼다) */
    look: CharacterLook;
    /** 홈에 직렬·계급 이름 보이기(확인 단계의 스위치) */
    showIdentity: boolean;
    /** 진동(이 화면의 토글. 저장할 때 설정으로 들어간다) */
    haptics: boolean;
    /** '한 번에 쓰기'로 바꾼다 */
    onform: () => void;
    /** 확인을 마치고 '알 깨우기'를 눌렀다(초안은 검사를 통과했다) */
    onhatch: () => void;
    /** 첫 화면으로 */
    onexit: () => void;
    /** 지금 이 화면이 보이는지(가려져 있는 동안에는 탭 제목을 건드리지 않는다) */
    active?: boolean;
  }

  let {
    draft: d,
    look = $bindable(),
    showIdentity = $bindable(),
    haptics = $bindable(),
    onform,
    onhatch,
    onexit,
    active = true,
  }: Props = $props();

  $effect(() => d.clampStep());

  type Place = 'greeting' | QuestionId | 'summary';
  let at = $state<Place>('greeting');
  /** 답한 질문(다음을 눌러 지나간 것). 진행 막대와 알의 금은 이 가운데 필수 칸만 센다 */
  const answered = new SvelteSet<QuestionId>();
  /** 알의 금 단계는 줄지 않는다(뒤로 가거나 직종을 바꿔도) */
  let topStage = $state(0);
  /** 방금 답에 대한 맞장구(다음 질문 위에 작게) */
  let ack = $state('');
  /** 고쳐야 할 때의 다정한 한마디 */
  let oops = $state('');
  let tried = $state(false);
  /** 확인 단계에서 '고치기'로 온 질문이면 답한 뒤 확인으로 돌아간다 */
  let returning = $state(false);
  let showAdvanced = $state(false);
  const seed = newTalkSeed();
  let turn = 0;
  const say = (lines: readonly string[]) => pickLine(lines, seed + (turn += 1));

  let egg = $state<ReturnType<typeof EggStage>>();
  let panel = $state<HTMLElement>();
  let heading = $state<HTMLElement>();

  // ── 질문 차례 ─────────────────────────────────────────────────────────
  /** 지금 권할 소품: 특정직은 직종 소품, 일반직은 고른 직렬의 소품 */
  const suggested = $derived.by((): PropRule | null => {
    if (d.track !== 'general') return trackPropOf(characterRules, d.track);
    const theme = themeOfSeries(d.series);
    return theme ? (characterRules.custom.props.find((p) => p.id === theme) ?? null) : null;
  });
  const list = $derived(
    questionsFor({
      track: d.track,
      askRank: d.askRank,
      series: d.series,
      hasProp: suggested !== null,
    }),
  );
  const progress = $derived(progressOf(list, answered));
  const ready = $derived(progress.left === 0);
  const stage = $derived(Math.max(topStage, eggStageFor(progress.done, progress.total)));

  const owner = $derived(propOwnerOf({ track: d.track, series: d.series }));
  const formId = $derived(
    formIdFor(characterRules, {
      ladderId: d.career.ladderId,
      rank: d.draftRank,
      hireDate: d.hireDate || d.today,
      today: d.today,
    }),
  );
  const paint = $derived(resolveCustom(characterRules, look, owner).paint);

  // ── 화면 키보드: 보이는 높이에 맞춰 알을 줄이거나 숨긴다 ─────────────────
  let viewHeight = $state(800);
  onMount(() => {
    const vv = window.visualViewport;
    const update = () => {
      viewHeight = vv?.height ?? window.innerHeight;
    };
    update();
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  });
  const eggScale = $derived(viewHeight >= 600 ? 4 : viewHeight >= 430 ? 2 : 0);

  const canVibrate = hapticsSupported();
  function toggleHaptics() {
    haptics = !haptics;
    setHapticsEnabled(haptics);
  }
  // 이 화면에 들어올 때의 값으로 맞춘다(한 번에 쓰기에서 돌아왔을 때 등)
  setHapticsEnabled(untrack(() => haptics));

  // ── 문장 ──────────────────────────────────────────────────────────────
  const question = $derived.by(() => {
    if (at === 'greeting' || at === 'summary') return '';
    const q = TALK.questions[at];
    if (at === 'rank') return fillLine(q.ask, { nounEul: josa(d.noun, '을', '를') });
    if (at === 'nextStepDate' && d.atMax) return TALK.questions.nextStepDate.askMax;
    return q.ask;
  });
  const greeting = pickLine(TALK.greeting.lines, seed);
  const summaryLine = pickLine(TALK.summary.lines, seed);
  /** 알 상태 + 남은 칸(입력 칸의 설명으로만 읽힌다) */
  const stateText = $derived(
    `${TALK.egg.stage[stage] ?? ''} ${
      ready ? TALK.egg.done : fillLine(TALK.egg.left, { n: progress.left })
    }`,
  );
  const progressText = $derived(
    fillLine(TALK.nav.progressText, { total: progress.total, done: progress.done }),
  );
  /** 질문·맞장구·알 상태·도움말을 잇는 설명 id */
  const described = $derived(
    [ack ? 'talk-ack' : '', oops ? 'talk-oops' : '', 'talk-state'].filter(Boolean).join(' '),
  );

  const problems = $derived(
    tried && at !== 'greeting' && at !== 'summary' ? problemsOf(at, d.visibleErrors) : [],
  );
  const shown = $derived(tried ? d.visibleErrors : {});

  // ── 이동 ──────────────────────────────────────────────────────────────
  $effect(() => {
    if (!active) return;
    document.title = at === 'summary' ? `${TALK.summary.title} · 호봉` : '호봉이와 첫 만남 · 호봉';
  });

  /**
   * 질문이 바뀌었을 때 포커스를 줄 칸. 글자·숫자 칸은 그 칸으로(호봉은 줄이기 버튼이 아니라 숫자 칸),
   * 고르는 칸은 고른 칩(묶음의 Tab 자리)으로, 날짜는 첫 칸(연도)으로, 소품은 [들기](data-talk-focus)로 간다.
   * 누를 수 없는 버튼·묶음 안의 다른 칩은 건너뛴다(포커스가 허공에 뜨지 않게).
   */
  const FOCUS_ID: Partial<Record<QuestionId, string>> = { nickname: 'tk-nick', step: 'tk-step' };
  const FOCUSABLE = [
    '.ask input:not([type="hidden"]):not(.native):not(:disabled)',
    '.ask select:not(:disabled)',
    '.ask [role="radio"][tabindex="0"]',
    '.ask button:not(:disabled):not([role="radio"])',
  ].join(', ');
  function focusTarget(place: QuestionId): HTMLElement | null {
    const id = FOCUS_ID[place];
    const marked = id
      ? panel?.querySelector<HTMLElement>(`#${id}`)
      : panel?.querySelector<HTMLElement>('[data-talk-focus]');
    return marked ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
  }

  async function go(place: Place, options: { focus?: boolean } = {}) {
    at = place;
    tried = false;
    oops = '';
    if (place !== 'greeting' && place !== 'summary') egg?.glance();
    await tick();
    if (options.focus === false) return;
    const target =
      place === 'greeting' || place === 'summary' ? heading : (focusTarget(place) ?? heading);
    target?.focus({ preventScroll: true });
    // 화면 키보드가 올라온 뒤에도 말풍선과 [다음]이 보이게
    setTimeout(() => panel?.scrollIntoView({ block: 'nearest' }), 320);
  }

  const REACTIONS: Record<QuestionId, EggReaction> = {
    nickname: 'heart',
    birthDate: 'star',
    hireDate: 'shake',
    track: 'tilt',
    payTable: 'tap',
    series: 'nudge',
    prop: 'star',
    rank: 'tilt',
    step: 'hop',
    nextStepDate: 'hop',
    payday: 'coin',
  };

  function ackOf(id: QuestionId): string {
    const q = TALK.questions[id];
    if (id === 'nickname') return fillLine(say(q.ack), { nick: d.nickname.trim() });
    if (id === 'track' && d.trackRules.status !== 'ready')
      return say(TALK.questions.track.ackPending);
    if (id === 'nextStepDate' && d.atMax) return say(TALK.questions.nextStepDate.ackMax);
    return say(q.ack);
  }

  /** 답을 받아들이고 다음으로 간다. skipped 면 선택 칸을 건너뛴 것 */
  function accept(id: QuestionId, skipped = false) {
    const wasReady = ready;
    const before = stage;
    answered.add(id);
    const now = progressOf(list, answered);
    const after = eggStageFor(now.done, now.total);
    topStage = Math.max(topStage, after);
    ack = skipped
      ? say(id === 'prop' ? TALK.questions.prop.skip : TALK.questions.series.skip)
      : ackOf(id);
    const nowReady = now.left === 0;
    if (skipped) {
      egg?.react('nudge');
    } else {
      egg?.react(REACTIONS[id]);
      if (nowReady && !wasReady) emitCue('egg-ready');
      else if (Math.max(topStage, after) > before) emitCue('egg-crack');
      else emitCue('egg-react');
    }
    const index = list.indexOf(id);
    const nextId = list[index + 1];
    if (returning || nextId === undefined) {
      returning = false;
      void go('summary');
    } else void go(nextId);
  }

  function next(event?: Event) {
    event?.preventDefault();
    if (at === 'greeting' || at === 'summary') return;
    const id = at;
    tried = true;
    if (problemsOf(id, d.visibleErrors).length > 0) {
      oops = say(TALK.oops);
      // 값을 고쳐야 할 때는 움찔만(진동 없음: 경고처럼 느껴진다)
      egg?.react('flinch');
      emitCue('egg-flinch');
      if (
        d.visibleErrors.longServiceDate ||
        d.visibleErrors.seniorDate ||
        d.visibleErrors.rankLimitDate
      )
        showAdvanced = true;
      requestAnimationFrame(() => {
        panel?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    accept(id);
  }

  function back() {
    if (at === 'greeting') {
      onexit();
      return;
    }
    ack = '';
    returning = false;
    if (at === 'summary') {
      const last = list[list.length - 1];
      if (last) void go(last);
      return;
    }
    const index = list.indexOf(at);
    const prev = list[index - 1];
    void go(prev ?? 'greeting');
  }

  function skip() {
    if (at === 'greeting' || at === 'summary' || !isOptional(at)) return;
    if (at === 'series') setSeries(null);
    if (at === 'prop') declineProp();
    accept(at, true);
  }

  function edit(id: QuestionId) {
    ack = '';
    returning = true;
    void go(id);
  }

  // ── 직종·직렬·소품 ────────────────────────────────────────────────────
  /** 직종·직렬이 바뀌면 그에 맞춰 골랐던 소품은 기본('auto')으로 돌리고 다시 묻는다 */
  function resetProp() {
    if (look.prop !== 'auto') look = { ...look, prop: 'auto' };
    answered.delete('prop');
  }
  function setTrack(next: (typeof TRACK_IDS)[number]) {
    if (next === d.track) return;
    d.setTrack(next);
    resetProp();
  }
  function setSeries(next: string | null) {
    if (next === d.series) return;
    d.series = next;
    resetProp();
  }
  function takeProp() {
    if (!suggested) return;
    look = { ...look, prop: suggested.id };
    accept('prop');
  }
  /** 나중에: 특정직은 호봉 소품('auto'), 일반직은 직렬 소품을 들지 않는다('none' — 'auto' 는 직렬 소품을 든다) */
  function declineProp() {
    look = { ...look, prop: d.track === 'general' ? 'none' : 'auto' };
  }
  const propPreview = $derived(
    suggested
      ? resolveLook(characterRules, formId, d.step, 'work', { ...look, prop: suggested.id }, owner)
      : null,
  );

  const trackOptions = $derived(
    TRACK_IDS.map((id) => ({ value: id, label: trackChipLabel(d.rules.tracks.items[id]) })),
  );
  const payTableOptions = GENERAL_PAY_TABLES.map((id) => ({
    value: id,
    label: GENERAL_PAY_TABLE_LABEL[id] ?? id,
  }));
  const rankOptions = $derived(d.ranks.map((r) => ({ value: r.key, label: r.label })));

  // ── 확인 ──────────────────────────────────────────────────────────────
  interface Row {
    id: QuestionId;
    label: string;
    value: string;
  }
  const day = (value: Ymd | '') => (value ? formatKorean(value, false) : '');
  const rows = $derived.by((): Row[] =>
    list.map((id) => {
      const label = id === 'rank' ? d.noun : TALK.questions[id].field;
      let value = '';
      if (id === 'nickname') value = d.nickname.trim();
      else if (id === 'birthDate') value = day(d.birthDate);
      else if (id === 'hireDate') value = day(d.hireDate);
      else if (id === 'track') value = trackChipLabel(d.trackRules);
      else if (id === 'payTable')
        value = GENERAL_PAY_TABLE_LABEL[d.payTable ?? 'table3'] ?? String(d.payTable);
      else if (id === 'series') value = d.series ?? '고르지 않음';
      else if (id === 'prop')
        value =
          suggested && look.prop === suggested.id
            ? suggested.name
            : look.prop === 'none'
              ? '들지 않기'
              : '나중에';
      else if (id === 'rank') {
        const name = d.ranks.find((r) => r.key === d.rank)?.label ?? '';
        value = d.promoted && d.rankDate ? `${name} · 승진일 ${day(d.rankDate)}` : name;
      } else if (id === 'step') value = `${d.step}호봉`;
      else if (id === 'nextStepDate')
        value = d.nextStepDate ? `${d.atMax ? '최고호봉이 된 날 ' : ''}${day(d.nextStepDate)}` : '';
      else if (id === 'payday') value = `${d.payday}일`;
      return {
        id,
        label: id === 'nextStepDate' ? d.nextLabel : label,
        value,
      };
    }),
  );

  let hatchProblem = $state('');
  function hatch() {
    hatchProblem = '';
    if (!d.valid) {
      const bad = firstProblem(list, d.visibleErrors);
      const hidden = [...uncoveredKeys(d.visibleErrors), ...d.hiddenErrors];
      if (bad) {
        hatchProblem = fillLine(TALK.summary.problem, { n: d.errorCount });
        returning = true;
        void go(bad).then(() => {
          tried = true;
          oops = say(TALK.oops);
        });
      } else {
        hatchProblem =
          hidden.length > 0
            ? `저장할 수 없는 값이 있어요: ${d.hiddenErrors.join(', ') || hidden.join(', ')}`
            : fillLine(TALK.summary.problem, { n: d.errorCount });
      }
      return;
    }
    onhatch();
  }

  // ── 꾸미기(선택) ──────────────────────────────────────────────────────
  let editingLook = $state(false);
  let lookDraft = $state<CharacterLook>(untrack(() => ({ ...look, deco: { ...look.deco } })));
  let lookChanged = $state(false);
  function openLook() {
    lookDraft = { ...look, deco: { ...look.deco } };
    editingLook = true;
  }
  function saveLook() {
    look = { ...lookDraft, deco: { ...lookDraft.deco } };
    lookChanged = true;
    editingLook = false;
    egg?.react('nudge');
  }

  /** 지금 질문이 건너뛸 수 있는 칸인지 */
  const optional = $derived(at !== 'greeting' && at !== 'summary' && isOptional(at));
  /** 계급 고르기: 초안의 계급 키(없으면 '') */
  function setRank(key: RankKey) {
    d.rank = key;
    d.rankNotice = '';
  }
</script>

<section class="win talk" id="welcome-talk" aria-labelledby="talk-title">
  <header class="win-title">
    <button type="button" class="btn ghost small back" onclick={back}>
      <Icon name="icon-chevron-left" />
      {at === 'greeting' ? '뒤로' : TALK.nav.back}
    </button>
    <h1 id="talk-title" tabindex="-1" bind:this={heading}>
      {at === 'summary' ? TALK.summary.title : '호봉이와 첫 만남'}
    </h1>
    {#if canVibrate}
      <button
        type="button"
        class="btn ghost small tool"
        aria-pressed={haptics}
        aria-label="진동"
        title={haptics ? TALK.egg.hapticsOn : TALK.egg.hapticsOff}
        onclick={toggleHaptics}
      >
        <Icon name={haptics ? 'icon-vibrate' : 'icon-vibrate-off'} />
      </button>
    {/if}
  </header>

  <div class="win-body stack wide" bind:this={panel}>
    <div class="top">
      <div class="meter">
        <Progress
          value={progress.total > 0 ? progress.done / progress.total : 0}
          label={TALK.nav.progress}
          valueText={progressText}
          cells={progress.total}
          tone="gold"
          thin
        />
        <span class="cap muted count" aria-hidden="true">{progress.done} / {progress.total}</span>
      </div>
      {#if at !== 'greeting'}
        <!-- 인사 화면에는 아래에 같은 버튼이 크게 있다(이름이 같은 버튼을 둘 두지 않는다) -->
        <button type="button" class="btn small mode" onclick={onform} title={TALK.modes.formHint}>
          <Icon name="icon-list" />
          {TALK.modes.form}
        </button>
      {/if}
    </div>

    {#if eggScale > 0}
      <div class="stage" class:small={eggScale < 4} aria-hidden="true">
        <EggStage
          bind:this={egg}
          {stage}
          {ready}
          {paint}
          scale={eggScale}
          rows={eggScale < 4 ? 30 : 44}
        />
      </div>
    {/if}

    <div class="bubble" class:flat={eggScale === 0}>
      {#if eggScale === 0}<span class="mini" aria-hidden="true"><Icon name="icon-egg" /></span>{/if}
      <div class="stack says">
        {#if ack && at !== 'greeting'}<p class="cap ack" id="talk-ack">{ack}</p>{/if}
        {#if at === 'greeting'}
          <p class="q" id="talk-q">{greeting}</p>
        {:else if at === 'summary'}
          <p class="q" id="talk-q">{summaryLine}</p>
        {:else}
          <p class="q" id="talk-q">{question}</p>
        {/if}
        {#if oops}<p class="cap oops" id="talk-oops">{oops}</p>{/if}
      </div>
    </div>
    <p class="sr-only" id="talk-state">{stateText}</p>

    {#if at === 'greeting'}
      <div class="stack wide">
        <div class="btn-row stretch">
          <button
            type="button"
            class="btn primary"
            data-talk-focus
            onclick={() => {
              const first = list[0];
              if (first) void go(first);
            }}
          >
            <Icon name="icon-chat" />
            {TALK.greeting.start}
          </button>
          <button type="button" class="btn" onclick={onform}>
            <Icon name="icon-list" />
            {TALK.modes.form}
          </button>
        </div>
        <p class="cap muted">{TALK.greeting.note}</p>
      </div>
    {:else if at === 'summary'}
      <div class="stack wide" id="talk-summary">
        <ul class="sum">
          {#each rows as row (row.id)}
            <li class="sum-row">
              <span class="cap muted">{row.label}</span>
              <span class="val" class:empty={!row.value}>{row.value || TALK.summary.empty}</span>
              <button
                type="button"
                class="btn small"
                aria-label="{row.label} {TALK.summary.edit}"
                onclick={() => edit(row.id)}
              >
                {TALK.summary.edit}
              </button>
            </li>
          {/each}
        </ul>

        <div class="stack">
          <label class="switch">
            <input
              type="checkbox"
              bind:checked={showIdentity}
              aria-describedby="talk-identity-hint"
            />
            <span class="box" aria-hidden="true"></span>
            <span>{TALK.summary.showIdentity}</span>
          </label>
          <span class="cap muted" id="talk-identity-hint">{TALK.summary.showIdentityHint}</span>
        </div>

        <div class="stack well">
          <div class="btn-row">
            <button type="button" class="btn small" onclick={openLook}>
              <Icon name="icon-palette" />
              {TALK.summary.look}
            </button>
          </div>
          <p class="cap muted" role="status">
            {lookChanged ? TALK.summary.lookDone : TALK.summary.lookHint}
          </p>
        </div>

        {#if hatchProblem}<p class="note warn" role="alert">{hatchProblem}</p>{/if}
        <div class="btn-row end">
          <button type="button" class="btn primary hatch" onclick={hatch}>
            <Icon name="icon-egg" />
            {TALK.summary.hatch}
          </button>
        </div>
      </div>
    {:else}
      <form class="ask stack wide" onsubmit={next} novalidate>
        {#if at === 'nickname'}
          <div class="field">
            <div class="line">
              <input
                id="tk-nick"
                class="input"
                type="text"
                maxlength={LIMITS.nicknameMax}
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                enterkeyhint="next"
                placeholder="예: 호봉이집사"
                bind:value={d.nickname}
                aria-labelledby="talk-q"
                aria-invalid={shown.nickname ? 'true' : undefined}
                aria-describedby="{described} tk-hint{shown.nickname ? ' tk-error' : ''}"
              />
              <button type="submit" class="btn primary go">{TALK.nav.next}</button>
            </div>
            <span class="hint cap" id="tk-hint">
              {fillLine(TALK.questions.nickname.hint, { max: LIMITS.nicknameMax })}
            </span>
            {#if shown.nickname}<span class="error cap" id="tk-error">{shown.nickname}</span>{/if}
          </div>
        {:else if at === 'birthDate'}
          <DateInput
            id="tk-birth"
            bind:problem={d.dateProblems.birthDate}
            label={TALK.questions.birthDate.field}
            labelledby="talk-q"
            describedby={described}
            bind:value={d.birthDate}
            max={d.today}
            required
            hint={TALK.questions.birthDate.hint}
            error={shown.birthDate}
          />
        {:else if at === 'hireDate'}
          <DateInput
            id="tk-hire"
            bind:problem={d.dateProblems.hireDate}
            label={TALK.questions.hireDate.field}
            labelledby="talk-q"
            describedby={described}
            bind:value={d.hireDate}
            max={d.today}
            required
            hint={TALK.questions.hireDate.hint}
            error={shown.hireDate}
          />
        {:else if at === 'track'}
          <div class="field">
            <ChipRadio
              labelledby="talk-q"
              describedby="{described} tk-hint"
              options={trackOptions}
              value={d.track}
              onchange={setTrack}
            />
            <span class="hint cap stack" id="tk-hint">
              <span>{d.trackRules.scope}</span>
              {#if d.trackStatus === '준비 중'}
                <span>
                  봉급·정년 등은 원문을 확인한 뒤 넣을게요. 그동안 재직기간·연가 장부·근무시간은 쓸
                  수 있어요.
                </span>
              {:else if d.trackStatus}
                <span>확인한 규정만 계산하고, 나머지는 숫자 없이 '준비 중'으로 보여 드려요.</span>
              {/if}
              <span>{TALK.questions.track.hint}</span>
            </span>
            {#if shown.track}<span class="error cap">{shown.track}</span>{/if}
          </div>
        {:else if at === 'payTable'}
          <div class="field">
            <ChipRadio
              labelledby="talk-q"
              describedby="{described} tk-hint"
              options={payTableOptions}
              value={d.payTable ?? 'table3'}
              onchange={(next) => d.setPayTable(next)}
            />
            <span class="hint cap" id="tk-hint">{TALK.questions.payTable.hint}</span>
            {#if d.payTable === 'table4'}
              <span class="hint cap">
                교정·보호·검찰·마약수사·출입국관리·철도경찰 등 공안업무 직렬과 감사·경호 업무 등이
                해당해요. 국가정보원 직원·경호공무원 같은 특정직은 직종에서 '그 밖의 특정직'을 골라
                주세요.
              </span>
            {/if}
            {#if shown.payTable}<span class="error cap">{shown.payTable}</span>{/if}
          </div>
        {:else if at === 'series'}
          <SeriesPicker
            idPrefix="tk"
            value={d.series}
            onchange={setSeries}
            describedby={described}
          />
        {:else if at === 'prop' && suggested && propPreview}
          <div class="prop">
            <span class="pic" aria-hidden="true">
              <Sprite look={propPreview} scale={2} animate={false} />
            </span>
            <div class="stack">
              <p><strong>{suggested.name}</strong></p>
              <p class="cap muted" id="tk-hint">{TALK.questions.prop.hint}</p>
            </div>
          </div>
        {:else if at === 'rank'}
          <div class="field">
            <ChipRadio
              labelledby="talk-q"
              describedby={described}
              options={rankOptions}
              value={d.rank}
              onchange={setRank}
            />
            {#if d.unselectable.length > 0}
              <span class="hint cap">
                {#each d.unselectable as r (r.key)}
                  {josa(r.label, '은', '는')} 고를 수 없어요. {r.note ?? ''}
                {/each}
              </span>
            {/if}
            {#if d.table4High}
              <span class="note warn cap">
                4급 이상은 해당 업무에 직접 종사할 때만 별표 4예요. 아니면 별표 3을 골라 주세요.
              </span>
            {/if}
            {#if shown.rank}<span class="error cap">{shown.rank}</span>{/if}
          </div>
          <div class="field">
            <span class="label" id="tk-promoted">{TALK.questions.rank.promotedAsk}</span>
            <ChipRadio
              labelledby="tk-promoted"
              options={[
                { value: 'no', label: TALK.questions.rank.promotedNo },
                { value: 'yes', label: TALK.questions.rank.promotedYes },
              ]}
              value={d.promoted ? 'yes' : 'no'}
              onchange={(v) => (d.promoted = v === 'yes')}
            />
          </div>
          {#if d.promoted}
            <DateInput
              id="tk-rank-date"
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
        {:else if at === 'step'}
          <Stepper
            id="tk-step"
            label="현재 호봉"
            bind:value={d.step}
            min={1}
            max={d.maxStep}
            unit="호봉"
            describedby={described}
            hint={d.raises
              ? TALK.questions.step.hint
              : '인사기록의 호봉을 넣어 주세요. 승급은 자동으로 계산하지 않아요.'}
            error={shown.step}
          />
        {:else if at === 'nextStepDate'}
          <DateInput
            id="tk-next"
            bind:problem={d.dateProblems.nextStepDate}
            label={d.nextLabel}
            labelledby="talk-q"
            describedby={described}
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
                {fillLine(TALK.questions.nextStepDate.guess, {
                  date: formatLongDate(d.guessedNext),
                })}
              </button>
            </div>
            <p class="cap muted">{TALK.questions.nextStepDate.guessNote}</p>
          {/if}
          {#if d.showLongService || d.showSenior || d.showRankLimit}
            <div class="stack">
              <button
                type="button"
                class="btn small toggle"
                aria-expanded={showAdvanced}
                aria-controls="tk-advanced"
                onclick={() => (showAdvanced = !showAdvanced)}
              >
                <span aria-hidden="true">{showAdvanced ? '▼' : '▶'}</span>
                <span>휴직·경력 인정 등 예외가 있어요</span>
              </button>
              {#if showAdvanced}
                <div id="tk-advanced" class="well stack wide">
                  <p class="cap muted">
                    휴직·징계·경력 합산처럼 계산으로 알 수 없는 사정이 있으면 날짜를 직접 넣어
                    주세요. 비워 두면 규정대로 계산해요. 건너뛰어도 돼요.
                  </p>
                  {#if d.showLongService}
                    <DateInput
                      id="tk-long"
                      bind:problem={d.dateProblems.longServiceDate}
                      label="근속승진 요건 충족일"
                      bind:value={d.longServiceDate}
                      hint={d.longServiceHint}
                      error={shown.longServiceDate}
                    />
                  {/if}
                  {#if d.showSenior}
                    <DateInput
                      id="tk-senior"
                      bind:problem={d.dateProblems.seniorDate}
                      label="대우공무원 선발 예정일"
                      bind:value={d.seniorDate}
                      error={shown.seniorDate}
                    />
                  {/if}
                  {#if d.showRankLimit}
                    <DateInput
                      id="tk-rank-limit"
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
          {/if}
        {:else if at === 'payday'}
          <div class="field">
            <ChipRadio
              labelledby="talk-q"
              describedby="{described} tk-hint"
              options={d.rules.payday.options.map((o) => ({ value: o.day, label: `${o.day}일` }))}
              value={d.payday}
              onchange={(next) => d.setPayday(next)}
            />
            <span class="hint cap stack" id="tk-hint">
              <span>
                {d.payday}일{d.paydayOrgs ? `: ${d.paydayOrgs}` : ''} · 나중에 설정에서 바꿀 수 있어요.
              </span>
              {#if d.trackRules.payday.note}<span>{d.trackRules.payday.note}</span>{/if}
            </span>
          </div>
        {/if}

        {#if problems.length > 1}
          <p class="cap muted">고칠 곳이 {problems.length}군데 있어요.</p>
        {/if}

        {#if at !== 'nickname'}
          <div class="btn-row end nav">
            {#if optional}
              <button type="button" class="btn" onclick={skip}>
                {at === 'prop' ? TALK.questions.prop.no : TALK.nav.skip}
              </button>
            {/if}
            {#if at === 'prop'}
              <button type="button" class="btn primary go" data-talk-focus onclick={takeProp}>
                {TALK.questions.prop.yes}
              </button>
            {:else}
              <button type="submit" class="btn primary go">
                {returning ? TALK.nav.toSummary : TALK.nav.next}
              </button>
            {/if}
          </div>
        {/if}
      </form>
    {/if}
  </div>
</section>

{#if editingLook}
  <Modal
    title={TALK.summary.look}
    icon="icon-palette"
    wide
    xwide
    onclose={() => (editingLook = false)}
  >
    <LookEditor bind:look={lookDraft} {formId} step={d.step} {owner} idPrefix="tklook" />
    {#snippet actions()}
      <button type="button" class="btn" onclick={() => (editingLook = false)}>취소</button>
      <button type="button" class="btn primary" onclick={saveLook}>
        <Icon name="icon-check" /> 이 모습으로
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .back,
  .tool {
    flex: none;
    color: var(--title-ink);
  }
  .back {
    margin: 0 0 0 -6px;
  }
  .tool {
    margin: 0 -6px 0 auto;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .meter {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .meter :global(.bar) {
    flex: 1 1 auto;
  }
  .count {
    flex: none;
    white-space: nowrap;
  }
  .mode {
    flex: none;
  }
  .stage {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    background: linear-gradient(
      var(--stage) 0 calc(100% - 24px),
      var(--stage-ground) calc(100% - 24px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
    overflow: hidden;
  }
  .stage.small {
    background: linear-gradient(
      var(--stage) 0 calc(100% - 12px),
      var(--stage-ground) calc(100% - 12px) 100%
    );
  }
  /* 말풍선: 알(위)을 가리키는 꼬리. 홈 상태창의 말풍선과 같은 테두리 */
  .bubble {
    position: relative;
    display: flex;
    gap: 9px;
    align-items: flex-start;
    padding: 9px 12px;
    margin: 6px var(--u) var(--u);
    background: var(--bubble);
    color: #1a1c2c;
    box-shadow:
      0 calc(var(--u) * -1) 0 0 #1a1c2c,
      0 var(--u) 0 0 #1a1c2c,
      calc(var(--u) * -1) 0 0 0 #1a1c2c,
      var(--u) 0 0 0 #1a1c2c;
  }
  .bubble::before {
    content: '';
    position: absolute;
    left: calc(50% - 3px);
    top: -6px;
    width: 6px;
    height: 6px;
    background: var(--bubble);
    box-shadow:
      -3px 0 0 0 #1a1c2c,
      3px 0 0 0 #1a1c2c,
      0 -3px 0 0 #1a1c2c;
  }
  .bubble.flat::before {
    display: none;
  }
  .says {
    flex: 1 1 auto;
    min-width: 0;
  }
  .q {
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .ack {
    color: #333c57;
  }
  .oops {
    color: #333c57;
  }
  .mini {
    flex: none;
    line-height: 0;
    padding-top: 3px;
  }
  .line {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .line .input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .go {
    flex: none;
    min-width: 72px;
  }
  .prop {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .pic {
    flex: none;
    display: block;
    line-height: 0;
    background: var(--stage);
    box-shadow: var(--frame);
    margin: var(--u);
  }
  .sum {
    display: grid;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sum-row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    box-shadow: 0 var(--u) 0 0 var(--panel-2);
  }
  .sum-row .val {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sum-row .val.empty {
    color: var(--warn);
  }
  .toggle {
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    width: fit-content;
  }
  .hatch {
    min-width: 144px;
  }
  @media (forced-colors: active) {
    .bubble {
      border: var(--u) solid CanvasText;
    }
    .bubble::before {
      display: none;
    }
  }
</style>
