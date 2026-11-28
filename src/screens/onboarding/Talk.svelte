<script lang="ts">
  /**
   * 말을 거는 첫 입력: 알이 하나씩 묻고, 답할 때마다 맞장구를 치며 금이 간다.
   *
   * - 값과 검사는 초안(ProfileDraft)이 맡는다. '한 번에 쓰기'(ProfileForm)와 같은 초안이라 오가도 값이 남는다.
   * - 질문 차례·필수 여부·알 단계는 src/lib/onboarding/questions.ts, 대사는 data/talk.json.
   * - 낭독: 질문이 바뀌면 입력 칸으로 포커스를 옮기고, 질문 문장이 칸(묶음)의 이름, 맞장구·알 상태·남은 칸이 설명이다.
   *   날짜 질문은 포커스를 받는 연도 칸에 설명을 단다(묶음의 설명은 읽지 않는 낭독기가 있다).
   *   따로 알리는 영역(live)은 두지 않는다(포커스 낭독과 겹쳐 두 번 읽지 않게).
   *   예외는 알 장난(#39)의 한 줄뿐이다: 손길 한 묶음이 끝날 때 한 번(polite), 질문이 바뀌면 기다리던 줄을 버린다.
   * - 알 그림은 장식(aria-hidden)이고, 소리·진동은 신호(emitCue)만 낸다.
   * - 알은 '호봉이 알 콕 누르기' 단추(EggPoke)로 감싸 누르기·마우스 올리기에 반응한다. 알을 눌러도 입력 칸의 포커스·
   *   적던 글자·스크롤·질문·진행은 그대로다(알 손길은 showEgg·settleScroll·focus 를 부르지 않는다).
   * - 맞장구는 그림과 맞춘다: 금 단계가 실제로 오른 답에만 '금이 갔어요'를 말하고, 아니면 그 칸의 몸짓(톡·흔들·갸웃·콩콩·까딱)을 말한다.
   *   움직임 줄이기에서는 몸짓을 말하지 않는다(알이 멈춰 있다).
   * - 고르는 질문(칩)에서도 Enter 는 [다음]이다(Space 는 고르기). 도움말은 한 줄로 두고 나머지는 [자세히]에 접는다
   *   (규정 근거는 '한 번에 쓰기'와 설정에 있다).
   * - 답하면 맞장구와 알 반응을 먼저 잠깐(ACK_HOLD_MS) 보여 주고 나서 질문을 바꾼다(반응이 질문 바뀜에 묻히지 않게).
   *   스크롤은 그 전에 한 번만 한다(알이 화면 밖이면 창 맨 위로). 움직임 줄이기면 기다리지 않는다.
   * - 화면 키보드가 올라와 높이가 줄면 알은 말풍선 옆의 작은 무대로 옮겨 가 같은 반응을 보여 준다(사라지지 않는다).
   */
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { ProfileDraft } from '../../lib/app/draft.svelte.ts';
  import { formatLongDate, josa } from '../../lib/app/format.ts';
  import { setHapticsEnabled } from '../../lib/app/haptics.ts';
  import {
    GENERAL_PAY_TABLE_LABEL,
    paydayChipLabel,
    paydayChoiceText,
    paydayHasShortOrgs,
    trackChipLabel,
  } from '../../lib/app/track.ts';
  import { formatKorean, type Ymd } from '../../lib/calc/date.ts';
  import { EGG_STAGE_MAX, eggStageFor } from '../../lib/character/egg.ts';
  import {
    formIdFor,
    resolveCustom,
    resolveLook,
    trackPropOf,
    type PropRule,
  } from '../../lib/character/look.ts';
  import { characterRules } from '../../lib/character/rules.ts';
  import {
    isOwnSeriesName,
    propOwnerOf,
    seriesLabel,
    themeOfSeries,
  } from '../../lib/character/series.ts';
  import { env } from '../../lib/fx/core.ts';
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
  import {
    fillLine,
    newTalkSeed,
    nickStem,
    pickLine,
    pickLineAfter,
    TALK,
  } from '../../lib/talk.ts';
  import ChipRadio from '../../lib/ui/ChipRadio.svelte';
  import DateInput from '../../lib/ui/DateInput.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Modal from '../../lib/ui/Modal.svelte';
  import Progress from '../../lib/ui/Progress.svelte';
  import Sprite from '../../lib/ui/Sprite.svelte';
  import Stepper from '../../lib/ui/Stepper.svelte';
  import LookEditor from '../customize/LookEditor.svelte';
  import SeriesPicker from '../profile/SeriesPicker.svelte';
  import EggPoke from './EggPoke.svelte';
  import EggStage, { REACTION_MOVE, type EggReaction } from './EggStage.svelte';
  import HapticsToggle from './HapticsToggle.svelte';

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
    /** 알을 콕 누를 때마다 이번 첫 입력에서 누른 수(부화 인사가 기억한다. 저장하지 않는다) */
    onpoke?: (total: number) => void;
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
    onpoke,
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
  /** 지금 질문의 [자세히]를 펼쳤는지(질문이 바뀌면 접는다) */
  let moreOpen = $state(false);
  /** 월급날이 기관에 따라 갈리는 직종인지(선택지에 짧은 기관 이름이 있다 — 지방 일반직의 교육청·학교) */
  const byOrg = $derived(paydayHasShortOrgs(d.career.payday.defaultDay, d.paydayOptions));
  /** 직렬 찾는 글자: 직렬 질문에서 [직종 고르기로 가기]로 다녀와도 남게 여기서 쥔다 */
  let seriesQuery = $state('');
  const seed = newTalkSeed();
  let turn = 0;
  const say = (lines: readonly string[]) => pickLine(lines, seed + (turn += 1));
  /** say 와 같되, 바로 앞에 붙는 토막(before)과 같은 말로 시작하는 변형은 건너뛴다(부록 P5) */
  const sayAfter = (before: string, lines: readonly string[]) =>
    pickLineAfter(lines, seed + (turn += 1), before);

  let egg = $state<ReturnType<typeof EggStage>>();
  let poker = $state<ReturnType<typeof EggPoke>>();
  let section = $state<HTMLElement>();
  let panel = $state<HTMLElement>();
  let heading = $state<HTMLElement>();
  let eggBox = $state<HTMLElement>();
  let bubbleEl = $state<HTMLElement>();
  /** 맞장구를 보여 주는 동안(질문이 바뀌기 전). 그동안은 [다음]을 다시 받지 않는다 */
  let holding = $state(false);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** 답한 뒤 맞장구와 알 반응을 먼저 보여 주는 시간(ms) */
  const ACK_HOLD_MS = 380;

  // ── 질문 차례 ─────────────────────────────────────────────────────────
  /** 지금 권할 소품: 특정직은 직종 소품, 직렬을 고르는 직종(직종 데이터의 seriesScope)은 고른 직렬의 소품 */
  const suggested = $derived.by((): PropRule | null => {
    if (!d.seriesScope) return trackPropOf(characterRules, d.track);
    const theme = themeOfSeries(d.series, d.seriesScope);
    return theme ? (characterRules.custom.props.find((p) => p.id === theme) ?? null) : null;
  });
  const list = $derived(
    questionsFor({
      askPayTable: d.askPayTable,
      askSeries: d.seriesScope !== null,
      askRank: d.askRank,
      series: d.series,
      hasProp: suggested !== null,
    }),
  );
  const progress = $derived(progressOf(list, answered));
  const ready = $derived(progress.left === 0);
  const stage = $derived(Math.max(topStage, eggStageFor(progress.done, progress.total)));

  const owner = $derived(propOwnerOf({ track: d.track, series: d.series }, d.seriesScope));
  const formId = $derived(
    formIdFor(characterRules, {
      ladderId: d.career.ladderId,
      rank: d.draftRank,
      hireDate: d.hireDate || d.today,
      today: d.today,
    }),
  );
  const paint = $derived(resolveCustom(characterRules, look, owner).paint);

  // ── 화면 키보드: 보이는 높이에 맞춰 알을 줄이거나 말풍선 옆으로 옮긴다 ──────────
  let viewHeight = $state(800);
  /** 지금 눈에 보이는 세로 범위(배치 뷰포트 좌표). 화면 키보드가 가린 곳은 뺀다 */
  function visibleRange(): { top: number; bottom: number } {
    const vv = window.visualViewport;
    const top = vv?.offsetTop ?? 0;
    return { top, bottom: top + (vv?.height ?? window.innerHeight) };
  }
  /** 화면 키보드가 올라와 있다고 볼 만큼 보이는 높이가 줄었는지 */
  function keyboardUp(): boolean {
    const vv = window.visualViewport;
    return compact || (vv !== null && vv !== undefined && vv.height < window.innerHeight - 120);
  }
  /**
   * 알(창 맨 위)이 보이게 한다. 반응을 보여 주기 직전에 한 번만 부른다
   * (긴 질문에서 아래로 내려 [다음]을 눌렀을 때 반응이 화면 밖에서 지나가지 않게).
   */
  function showEgg() {
    const box = eggBox?.getBoundingClientRect();
    if (!box) return;
    const view = visibleRange();
    if (box.top < view.top || box.bottom > view.bottom) section?.scrollIntoView({ block: 'start' });
  }
  /**
   * 질문이 바뀐 뒤(또는 화면 키보드가 올라온 뒤) 보여야 할 것이 가려졌으면 맞춘다.
   * - 창이 통째로 들어오면 그대로 둔다(이미 보이면 아무 일도 없다).
   * - 화면 키보드가 올라와 있으면 말풍선부터 [다음]까지를 우선한다.
   * - 그 밖에는 말풍선이 화면 밖일 때만 창 맨 위로 간다(반응 도중에 화면이 밀리지 않게 [다음]을 쫓아가지 않는다).
   */
  function settleScroll() {
    const whole = section?.getBoundingClientRect();
    const from = bubbleEl?.getBoundingClientRect();
    const to = panel?.getBoundingClientRect();
    if (!whole || !from || !to) return;
    const view = visibleRange();
    const height = view.bottom - view.top;
    if (whole.height <= height) {
      if (whole.top < view.top) window.scrollBy(0, whole.top - view.top);
      else if (whole.bottom > view.bottom) window.scrollBy(0, whole.bottom - view.bottom);
      return;
    }
    if (keyboardUp()) {
      const top = (compact ? (eggBox?.getBoundingClientRect().top ?? from.top) : from.top) - 6;
      if (to.bottom - top <= height) {
        if (top < view.top) window.scrollBy(0, top - view.top);
        else if (to.bottom > view.bottom) window.scrollBy(0, to.bottom - view.bottom);
      } else window.scrollBy(0, top - view.top);
      return;
    }
    if (from.top < view.top || from.bottom > view.bottom)
      section?.scrollIntoView({ block: 'start' });
  }
  onMount(() => {
    const vv = window.visualViewport;
    const update = () => {
      const before = viewHeight;
      viewHeight = vv?.height ?? window.innerHeight;
      // 화면 키보드가 올라오거나 내려가면(높이가 바뀌면) 말풍선과 [다음]이 보이게 맞춘다
      if (active && Math.abs(viewHeight - before) > 40) void tick().then(settleScroll);
    };
    viewHeight = vv?.height ?? window.innerHeight;
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      if (holdTimer) clearTimeout(holdTimer);
    };
  });
  /** 보이는 높이가 430px 아래면(화면 키보드) 알은 말풍선 옆의 작은 무대로 간다 */
  const compact = $derived(viewHeight < 430);
  const eggScale = $derived(viewHeight >= 600 ? 4 : 2);
  const eggRows = $derived(compact ? 34 : eggScale < 4 ? 30 : 44);

  // 진동 단추는 HapticsToggle(한 번에 쓰기와 함께 쓴다). 이 화면에 들어올 때의 값으로 맞춘다(한 번에 쓰기에서 돌아왔을 때 등)
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
  /** 확인 인사: 위에 남아 있는 맞장구(금 대사 '이제 다 됐어요!' 등)와 같은 말로 시작하지 않게 고른다(부록 P5) */
  const summaryLine = $derived(pickLineAfter(TALK.summary.lines, seed, ack));
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
    moreOpen = false;
    // 알 장난의 낭독 줄이 새 질문의 포커스 낭독과 겹치지 않게
    poker?.quiet();
    if (place !== 'greeting' && place !== 'summary') egg?.glance();
    await tick();
    if (options.focus === false) return;
    const target =
      place === 'greeting' || place === 'summary' ? heading : (focusTarget(place) ?? heading);
    target?.focus({ preventScroll: true });
    settleScroll();
  }

  /** 맞장구를 보여 주던 것을 그만둔다(뒤로 가기·화면을 떠날 때) */
  function dropHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    holding = false;
  }

  /** 칸마다 다른 몸짓과 조각(EggStage): 하트·이름표 / 반짝이 / 달력 장 / 휘장 / 봉급표 종이 / 깃 / 동전·봉투 */
  const REACTIONS: Record<QuestionId, EggReaction> = {
    nickname: 'heart',
    birthDate: 'star',
    hireDate: 'calendar',
    track: 'badge',
    payTable: 'sheet',
    series: 'tag',
    prop: 'star',
    rank: 'badge',
    step: 'feather',
    nextStepDate: 'calendar',
    payday: 'coin',
  };

  /** 받았다는 말(질문마다). 알의 금·몸짓은 말하지 않는다 */
  function wordOf(id: QuestionId): string {
    const q = TALK.questions[id];
    if (id === 'nickname') return fillLine(say(q.ack), { nick: nickStem(d.nickname) });
    if (id === 'track' && d.trackRules.status !== 'ready')
      return say(TALK.questions.track.ackPending);
    if (id === 'nextStepDate' && d.atMax) return say(TALK.questions.nextStepDate.ackMax);
    // 직렬을 '고르지 않음'으로 둔 채 [다음]을 누른 것은 건너뛴 것과 같다
    if (id === 'series' && d.series === null) return say(TALK.questions.series.skip);
    return say(q.ack);
  }

  /**
   * 맞장구 = 받았다는 말 + 알 토막. 알 토막은 그림과 맞춘다:
   * 금 단계가 방금 올랐으면(risen = 오른 단계) 금 대사, 아니면 그 칸의 몸짓 대사.
   * 움직임 줄이기에서는 몸짓을 말하지 않는다. 직종의 맞장구는 계산만 말한다(부록 H4).
   */
  function ackOf(id: QuestionId, risen: number | null): string {
    const word = wordOf(id);
    if (risen !== null) {
      const lines: readonly string[] = TALK.egg.crack[risen] ?? [];
      return `${word} ${sayAfter(word, lines)}`.trim();
    }
    if (env.reduced || id === 'track') return word;
    const moves: Partial<Record<string, readonly string[]>> = TALK.egg.move;
    const lines = moves[REACTION_MOVE[REACTIONS[id]]];
    return lines ? `${word} ${sayAfter(word, lines)}` : word;
  }

  /** 답을 받아들이고 다음으로 간다. skipped 면 선택 칸을 건너뛴 것 */
  function accept(id: QuestionId, skipped = false) {
    const wasReady = ready;
    const before = stage;
    answered.add(id);
    const now = progressOf(list, answered);
    const after = eggStageFor(now.done, now.total);
    topStage = Math.max(topStage, after);
    /** 이 답으로 금 단계가 올랐는지(그림이 실제로 바뀐 때에만 '금' 대사와 흔들림을 쓴다) */
    const rose = after > before;
    ack = skipped
      ? say(id === 'prop' ? TALK.questions.prop.skip : TALK.questions.series.skip)
      : ackOf(id, rose ? after : null);
    const nowReady = now.left === 0;
    // 알이 화면 밖이면 반응을 보여 주기 전에 한 번만 맞춘다
    showEgg();
    if (skipped) {
      egg?.react('nudge');
    } else {
      egg?.react(REACTIONS[id], rose ? (after >= EGG_STAGE_MAX ? 'ready' : 'crack') : undefined);
      if (nowReady && !wasReady) emitCue('egg-ready');
      else if (rose) emitCue('egg-crack');
      else emitCue('egg-react');
    }
    const index = list.indexOf(id);
    const nextId = list[index + 1];
    const target: Place = returning || nextId === undefined ? 'summary' : nextId;
    returning = false;
    if (env.reduced) {
      void go(target);
      return;
    }
    // 맞장구와 알 반응을 먼저 보여 주고, 그다음 질문을 바꾼다
    holding = true;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      holding = false;
      void go(target);
    }, ACK_HOLD_MS);
  }

  function next(event?: Event) {
    event?.preventDefault();
    if (at === 'greeting' || at === 'summary' || holding) return;
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

  /** 고르는 칸(칩)에서 Enter 는 [다음]과 같다(Space 는 고르기). 글자 칸의 Enter 는 폼이 맡는다 */
  function onAskKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'radio') return;
    event.preventDefault();
    next();
  }

  /** '잘 모르겠어요 → 채우기': 날짜를 채우고, 사라지는 버튼 대신 [다음]으로 포커스를 옮긴다 */
  async function fillGuess() {
    d.nextStepDate = d.guessedNext ?? '';
    await tick();
    panel?.querySelector<HTMLElement>('.ask button[type="submit"]')?.focus();
  }

  /** 이전 질문으로(인사에서는 첫 화면으로). 브라우저의 뒤로 가기도 이 길로 온다(Welcome 의 popstate) */
  export function back() {
    dropHold();
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
    if (at === 'greeting' || at === 'summary' || holding || !isOptional(at)) return;
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
  function setSeries(next: string | null, jikryu: string | null = null) {
    if (next === d.series && jikryu === d.seriesJikryu) return;
    // 직류만 바꾸면 소품(직렬 테마)은 그대로다
    const sameSeries = next === d.series;
    d.setSeries(next, jikryu);
    if (!sameSeries) resetProp();
  }
  /** 직렬 고르기의 [직종 고르기로 가기]: 직종 질문으로 돌아간다(직종을 저절로 바꾸지 않는다) */
  function goTrack() {
    dropHold();
    ack = '';
    returning = false;
    void go('track');
  }
  function takeProp() {
    if (!suggested || holding) return;
    look = { ...look, prop: suggested.id };
    accept('prop');
  }
  /** 나중에: 특정직은 호봉 소품('auto'), 직렬을 고르는 직종은 직렬 소품을 들지 않는다('none' — 'auto' 는 직렬 소품을 든다) */
  function declineProp() {
    look = { ...look, prop: d.seriesScope ? 'none' : 'auto' };
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
      else if (id === 'series') {
        const label = seriesLabel(
          { series: d.series, seriesJikryu: d.seriesJikryu },
          d.seriesScope,
        );
        // 직접 적은 이름(#38)은 설정·목록처럼 표의 직렬과 구별해 보인다
        value = label
          ? `${label}${isOwnSeriesName(d.series) ? ' (직접 적은 이름)' : ''}`
          : (d.series ?? '고르지 않음');
      } else if (id === 'prop')
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

<section
  class="win talk"
  id="welcome-talk"
  aria-labelledby="talk-title"
  data-own-scroll
  bind:this={section}
>
  <header class="win-title">
    <button type="button" class="btn ghost small back" onclick={back}>
      <Icon name="icon-chevron-left" />
      {at === 'greeting' ? '뒤로' : TALK.nav.back}
    </button>
    <h1 id="talk-title" tabindex="-1" bind:this={heading}>
      {at === 'summary' ? TALK.summary.title : '호봉이와 첫 만남'}
    </h1>
    <HapticsToggle bind:haptics />
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

    <div class="scene" class:compact>
      <EggPoke
        bind:this={poker}
        {egg}
        {stage}
        {compact}
        {eggScale}
        wordy={!compact && eggScale >= 4}
        {onpoke}
      >
        <!-- 단추 안이라 구문 내용(span)으로 둔다(보이는 모양은 CSS 의 display 가 정한다) -->
        <span
          class={compact ? 'egg-mini' : 'stage'}
          class:small={!compact && eggScale < 4}
          aria-hidden="true"
          bind:this={eggBox}
        >
          <EggStage
            bind:this={egg}
            pokeable
            {stage}
            {ready}
            {paint}
            scale={eggScale}
            rows={eggRows}
          />
        </span>
      </EggPoke>

      <div class="bubble" class:side={compact} bind:this={bubbleEl}>
        <div class="stack says">
          {#if ack && at !== 'greeting'}
            <p class="cap ack" class:now={holding} id="talk-ack">{ack}</p>
          {/if}
          <!-- 맞장구를 보여 주는 동안 질문은 잠깐 가린다(칸의 이름으로는 그대로 읽힌다) -->
          {#if at === 'greeting'}
            <p class="q" id="talk-q">{greeting}</p>
          {:else if at === 'summary'}
            <p class="q" id="talk-q">{summaryLine}</p>
          {:else}
            <p class="q" id="talk-q" hidden={holding}>{question}</p>
          {/if}
          {#if oops}<p class="cap oops" id="talk-oops">{oops}</p>{/if}
        </div>
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

        <div class="stack opts">
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
          <div class="look-row">
            <button type="button" class="btn small" onclick={openLook}>
              <Icon name="icon-palette" />
              {TALK.summary.look}
            </button>
            <p class="cap muted" role="status">
              {lookChanged ? TALK.summary.lookDone : TALK.summary.lookHint}
            </p>
          </div>
        </div>

        <!-- [알 깨우기]는 화면 아래에 붙어 있다(답 목록이 길어도 늘 보인다) -->
        <div class="wake">
          {#if hatchProblem}<p class="note warn" role="alert">{hatchProblem}</p>{/if}
          <p class="cap muted later" id="tk-later">{TALK.summary.later}</p>
          <button
            type="button"
            class="btn primary hatch"
            aria-describedby="tk-later"
            onclick={hatch}
          >
            <Icon name="icon-egg" />
            {TALK.summary.hatch}
          </button>
        </div>
      </div>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <form class="ask stack wide" onsubmit={next} onkeydown={onAskKey} novalidate>
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
            jikryu={d.seriesJikryu}
            scope={d.seriesScope ?? 'national'}
            rules={d.rules}
            career={d.career}
            onchange={setSeries}
            ongotrack={goTrack}
            describedby={described}
            brief={TALK.questions.series.hint}
            bind:query={seriesQuery}
          />
        {:else if at === 'prop' && suggested && propPreview}
          <div class="prop">
            <span class="pic" aria-hidden="true">
              <Sprite look={propPreview} scale={2} animate={false} />
            </span>
            <div class="stack">
              <p><strong id="tk-prop-name">{suggested.name}</strong></p>
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
              <!-- 까닭(봉급표 근거)은 '한 번에 쓰기'와 설정에 있다. 대화에서는 한 줄만 -->
              <span class="hint cap" id="tk-unselectable">
                {#each d.unselectable as r (r.key)}
                  {josa(r.label, '은', '는')} {TALK.questions.rank.unselectable}
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
              <button type="button" class="btn small" id="tk-guess" onclick={fillGuess}>
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
              options={d.paydayOptions.map((o) => ({
                value: o.day,
                label: paydayChipLabel(o, d.career.payday.defaultDay),
              }))}
              value={d.payday}
              onchange={(next) => d.setPayday(next)}
            />
            <!--
              도움말은 한 줄. 날짜마다의 기관은 [자세히]에(기본값의 근거는 '한 번에 쓰기'와 설정에 있다).
              기관에 따라 답이 갈리는 직종(지방 일반직: 20일 / 교육청·학교 17일)은 '그대로 두세요'라고 하지 않고 두 날을 같이 알린다
            -->
            <span class="hint cap" id="tk-hint">
              {byOrg
                ? fillLine(TALK.questions.payday.hintByOrg, {
                    choice: paydayChoiceText(d.career.payday.defaultDay, d.paydayOptions),
                  })
                : TALK.questions.payday.hint}
            </span>
            {#if byOrg}
              <button
                type="button"
                class="btn ghost small toggle"
                aria-expanded={moreOpen}
                aria-controls="tk-more"
                onclick={() => (moreOpen = !moreOpen)}
              >
                <span aria-hidden="true">{moreOpen ? '▼' : '▶'}</span>
                <span>{TALK.nav.more}</span>
              </button>
              {#if moreOpen}
                <span class="hint cap stack" id="tk-more">
                  {#each d.paydayOptions as o (o.day)}<span>{o.day}일: {o.orgs}</span>{/each}
                  {#if d.career.payday.note}<span>{d.career.payday.note}</span>{/if}
                </span>
              {/if}
            {:else if d.paydayOrgs}
              <button
                type="button"
                class="btn ghost small toggle"
                aria-expanded={moreOpen}
                aria-controls="tk-more"
                onclick={() => (moreOpen = !moreOpen)}
              >
                <span aria-hidden="true">{moreOpen ? '▼' : '▶'}</span>
                <span>{TALK.nav.more}</span>
              </button>
              {#if moreOpen}
                <span class="hint cap" id="tk-more">{d.payday}일: {d.paydayOrgs}</span>
              {/if}
            {/if}
          </div>
        {/if}

        {#if problems.length > 1}
          <p class="cap muted">고칠 곳이 {problems.length}군데 있어요.</p>
        {/if}

        {#if at !== 'nickname'}
          <div class="btn-row end nav">
            {#if optional}
              <button
                type="button"
                class="btn"
                aria-describedby={at === 'prop' ? 'tk-prop-name tk-hint' : undefined}
                onclick={skip}
              >
                {at === 'prop' ? TALK.questions.prop.no : TALK.nav.skip}
              </button>
            {/if}
            {#if at === 'prop'}
              <!-- 포커스가 오는 버튼: 질문·소품 이름·'카드 그림에도 보여요'·맞장구·알 상태를 설명으로 읽는다 -->
              <button
                type="button"
                class="btn primary go"
                data-talk-focus
                aria-describedby="talk-q tk-prop-name tk-hint {described}"
                onclick={takeProp}
              >
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
  .back {
    flex: none;
    color: var(--title-ink);
    margin: 0 0 0 -6px;
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
  /* 화면 키보드가 올라왔을 때: 알은 말풍선 왼쪽의 작은 무대로(같은 몸짓·조각·금 단계를 2배로) */
  .scene.compact {
    display: flex;
    align-items: stretch;
    gap: 9px;
  }
  .egg-mini {
    flex: none;
    width: 96px;
    display: flex;
    align-items: flex-end;
    background: linear-gradient(
      var(--stage) 0 calc(100% - 12px),
      var(--stage-ground) calc(100% - 12px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
    overflow: hidden;
  }
  .bubble.side {
    flex: 1 1 auto;
    min-width: 0;
    margin: var(--u) var(--u) var(--u) 3px;
    align-items: center;
  }
  /* 꼬리는 왼쪽(알)을 가리킨다 */
  .bubble.side::before {
    left: -6px;
    top: calc(50% - 3px);
    box-shadow:
      0 -3px 0 0 #1a1c2c,
      0 3px 0 0 #1a1c2c,
      -3px 0 0 0 #1a1c2c;
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
  /* 방금 답에 대한 맞장구: 질문이 바뀌기 전 잠깐 크게 */
  .ack.now {
    font-family: inherit;
    font-size: 15px;
    color: #1a1c2c;
  }
  .oops {
    color: #333c57;
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
  .opts {
    gap: 6px;
  }
  .look-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 9px;
  }
  .look-row p {
    flex: 1 1 180px;
    min-width: 0;
  }
  /* [알 깨우기]: 화면 아래에 붙여 둔다. 창 본문의 안쪽 여백(12px)만큼 넓혀 끝에서 끝까지 덮는다 */
  .wake {
    position: sticky;
    bottom: 0;
    z-index: 4;
    display: grid;
    gap: 6px;
    margin: 0 -12px -12px;
    padding: 9px 12px calc(9px + var(--safe-b));
    background: var(--panel);
    box-shadow: 0 calc(var(--u) * -1) 0 0 var(--line);
  }
  .later {
    margin: 0;
    text-align: center;
  }
  .hatch {
    width: 100%;
    min-height: 45px;
  }
  /* 붙어 있는 버튼 줄이 포커스 받은 [고치기]를 가리지 않게 */
  #talk-summary :is(button, input) {
    scroll-margin-bottom: 96px;
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
