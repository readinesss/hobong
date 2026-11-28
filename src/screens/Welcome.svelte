<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ProfileDraft } from '../lib/app/draft.svelte.ts';
  import { prefs, type OnboardMode } from '../lib/app/prefs.svelte.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { clock } from '../lib/app/clock.svelte.ts';
  import { downloadText } from '../lib/app/files.ts';
  import { formatInstant } from '../lib/app/format.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { yearOf } from '../lib/calc/date.ts';
  import { eggStageFor } from '../lib/character/egg.ts';
  import { resolveLook } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { emitCue } from '../lib/fx/cues.ts';
  import { POKE } from '../lib/fx/poke.ts';
  import { rulesFor } from '../lib/rules/index.ts';
  import { defaultLook } from '../lib/store/defaults.ts';
  import type { CharacterLook, Profile } from '../lib/store/schema.ts';
  import { newTalkSeed, TALK } from '../lib/talk.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import ProfileForm from './ProfileForm.svelte';
  import EggPoke from './onboarding/EggPoke.svelte';
  import EggStage from './onboarding/EggStage.svelte';
  import Hatch from './onboarding/Hatch.svelte';
  import Talk from './onboarding/Talk.svelte';

  /**
   * intro 첫 화면 / talk 말을 거는 첫 입력 / form 한 번에 쓰기 / hatch 알이 깨어나는 중(데이터는 이미 저장됨).
   * 새로 고친 뒤처럼 깨어나는 중에 이 화면이 새로 뜨는 일은 없다(저장돼 있으면 홈이 뜬다).
   */
  let step = $state<'intro' | 'talk' | 'form' | 'hatch'>('intro');
  /** 폼·대화를 한 번 열었으면 계속 그려 둔다('뒤로'를 눌러도 입력한 값·덜 채운 날짜가 남는다) */
  let formOpened = $state(false);
  let talkOpened = $state(false);
  let startBtn = $state<HTMLButtonElement>();
  let formHeading = $state<HTMLHeadingElement>();
  let talk = $state<ReturnType<typeof Talk>>();

  /** 두 입력 방식이 함께 쓰는 초안과 첫 입력에서 고르는 것들 */
  const draft = new ProfileDraft();
  let look = $state<CharacterLook>(defaultLook());
  let showIdentity = $state(true);
  let haptics = $state(true);
  const seed = newTalkSeed();

  // 화면이 바뀐 것을 제목으로도 알린다(대화·부화 화면은 스스로 정한다)
  $effect(() => {
    if (step === 'form') document.title = '내 정보 넣기 · 호봉';
    else if (step === 'intro') document.title = '호봉 — 공무원 상태창';
    else if (step === 'hatch') document.title = `${TALK.hatch.title} · 호봉`;
  });

  /** 고른 입력 방식을 이 기기에 기억한다(다음에 같은 방식으로 연다) */
  function remember(mode: OnboardMode) {
    prefs.set({ onboardMode: mode });
  }

  // ── 브라우저의 뒤로 가기와 새로 고침 ─────────────────────────────────────
  /**
   * 첫 입력(대화·폼) 중에는 기록(history)에 자리 하나를 끼워 둔다. 뒤로 가기(안드로이드의 버튼·제스처 포함)를 누르면
   * 사이트를 떠나는 대신 '이전 질문'(폼이면 첫 화면)으로 가고, 아직 첫 입력 중이면 자리를 다시 끼운다.
   * 첫 화면으로 돌아오거나 저장을 마치면 끼워 둔 자리를 거둔다(뒤로 가기가 한 번 헛돌지 않게).
   * 주소는 바꾸지 않는다(file:// 에서도 되게 상태만 얹는다). 입력값은 어디에도 저장하지 않는다.
   */
  let guarded = false;
  let ignorePop = false;
  function guard() {
    if (guarded) return;
    try {
      history.pushState({ hobongOnboarding: true }, '');
      guarded = true;
    } catch {
      // 기록을 쓸 수 없는 환경에서는 예전처럼 둔다
    }
  }
  function unguard() {
    if (!guarded) return;
    guarded = false;
    ignorePop = true;
    try {
      history.back();
    } catch {
      ignorePop = false;
    }
  }
  function onPopState() {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (!guarded) return;
    guarded = false;
    // 대화상자가 열려 있으면 그것부터 닫는다(Esc 와 같은 길)
    if (document.documentElement.hasAttribute('data-modal')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (step === 'talk') talk?.back();
    else if (step === 'form') void goIntro({ viaHistory: true });
    if (step !== 'intro') guard();
  }
  /** 첫 입력 칸에 넣은 것이 있는지 */
  function entered(): boolean {
    return (
      draft.nickname.trim() !== '' ||
      draft.birthDate !== '' ||
      draft.hireDate !== '' ||
      draft.nextStepDate !== '' ||
      Object.values(draft.dateProblems).some(Boolean)
    );
  }
  /** 넣은 값이 있는데 아직 저장하지 않았으면, 새로 고침·창 닫기 전에 브라우저가 한 번 묻게 한다 */
  const dirty = $derived((step === 'talk' || step === 'form') && entered());

  /** 이 화면이 스스로 홈으로 넘겼다(알을 깨웠다) */
  let handedOff = false;
  /** 알 깨우기가 다른 탭 때문에 막혀 app 이 이미 알렸다 */
  let refused = false;
  /**
   * 이 화면이 사라질 때. 스스로 넘긴 것(알 깨우기·패키지로 이어하기)이 아니면 다른 탭(또는 다른 hobong.html)이
   * 먼저 내 정보를 넣어 이 탭이 그 데이터를 따라간 것이다(알 깨우기가 막혔을 때와 storage 이벤트·포커스로 끌려
   * 나왔을 때 모두). 첫 입력 중이었으면 알리고, 누른 단추·칸이 사라졌으니 홈의 본문으로 포커스를 옮긴다.
   * 끼워 둔 기록 자리도 거둔다(홈에서 첫 [뒤로]가 헛돌지 않게. docs/PLAN.md 부록 J13).
   * 정리 함수 안에서 읽는 상태는 이 화면을 치운 변경 전의 값이라(Svelte 5) app.data 는 한 박자 뒤에 본다.
   */
  function onLeave() {
    const inInput = step === 'talk' || step === 'form';
    const hadInput = inInput && entered();
    unguard();
    if (handedOff || importing || !inInput) return;
    const announce = !refused;
    queueMicrotask(() => {
      if (!app.data) return;
      if (announce) app.announceCreatedElsewhere(hadInput);
      setTimeout(() => {
        const active = document.activeElement;
        if (active === null || active === document.body)
          document.getElementById('main')?.focus({ preventScroll: true });
      });
    });
  }
  onMount(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      // 일부 브라우저는 returnValue 를 채워야 묻는다(문구는 브라우저가 정한다)
      event.returnValue = '';
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
      onLeave();
    };
  });

  /** 폼으로: 누른 버튼이 사라지므로 새 화면의 제목으로 포커스를 옮긴다 */
  async function goForm() {
    formOpened = true;
    step = 'form';
    guard();
    remember('form');
    await tick();
    window.scrollTo(0, 0);
    formHeading?.focus({ preventScroll: true });
  }

  /** 말을 거는 첫 입력으로 */
  async function goTalk() {
    talkOpened = true;
    step = 'talk';
    guard();
    remember('talk');
    await tick();
    window.scrollTo(0, 0);
    document.getElementById('talk-title')?.focus({ preventScroll: true });
  }

  /** 새로 시작: 지난번에 고른 방식으로(처음이면 말을 거는 방식) */
  function start() {
    if (prefs.onboardMode === 'form') void goForm();
    else void goTalk();
  }

  /** 첫 화면으로: '새로 시작' 버튼으로 포커스를 되돌린다 */
  async function goIntro(options: { viaHistory?: boolean } = {}) {
    step = 'intro';
    // 화면의 [뒤로]로 왔으면 끼워 둔 기록 자리를 거둔다(뒤로 가기로 왔으면 이미 빠졌다)
    if (!options.viaHistory) unguard();
    await tick();
    startBtn?.focus();
  }
  let importing = $state(false);
  let dropped = $state<File | null>(null);
  let dragging = $state(false);

  const rules = $derived(rulesFor(yearOf(clock.today)));

  /**
   * 알을 깨운다: 저장을 먼저 끝내고(연출 중에 새로 고쳐도 남는다) 이 화면 안에서 부화 연출을 한다.
   * 연출이 끝나면 홈으로 넘어가 창들이 차례로 나타난다(app.finishHatch).
   */
  async function create(profile: Profile, payday: number) {
    const base = app.context().defaultSettings;
    const ok = app.createProfile(
      profile,
      {
        payday,
        haptics,
        identity: { ...base.identity, showSeriesHome: showIdentity },
      },
      look,
      { hatch: true },
    );
    // 저장하지 못했으면(이 탭은 더 쓰지 않음·다른 탭이 먼저 내 정보를 넣음) app 이 까닭을 알린다.
    // 다른 탭의 데이터를 따라갔으면 이 화면은 곧 사라진다(onLeave 가 기록 자리·포커스를 맡는다)
    if (!ok) {
      refused = app.data !== null;
      return;
    }
    handedOff = true;
    // 저장을 마쳤다: 끼워 둔 기록 자리를 거둔다(홈에서 뒤로 가기가 헛돌지 않게)
    unguard();
    // 임용정보 패키지 안내를 홈에서 한 번 보일 차례다
    prefs.set({ packageGuide: 'pending' });
    emitCue('hatch-start');
    step = 'hatch';
    await tick();
    window.scrollTo(0, 0);
  }

  /** 깨어난 모습(근무 중). 저장된 뒤에만 읽는다 */
  const hatchedLook = $derived(
    step === 'hatch' && app.data
      ? resolveLook(
          characterRules,
          view.formId,
          view.step,
          'work',
          view.characterLook,
          view.propOwner,
        )
      : null,
  );

  // ── 한 번에 쓰기의 작은 알: 칸에서 포커스가 나갈 때, 채운 칸이 늘었으면 한 번 반응한다 ──
  const FORM_KEYS = ['nickname', 'birthDate', 'hireDate', 'nextStepDate'] as const;
  const formFilled = $derived(FORM_KEYS.filter((key) => !draft.errors[key]).length);
  const formStage = $derived(eggStageFor(formFilled, FORM_KEYS.length));
  let formEgg = $state<ReturnType<typeof EggStage>>();
  let seenFilled = 0;
  /** 알을 콕 누른 수(대화·폼). 많이 눌렀으면 깨어난 호봉이의 인사가 기억한다. 메모리에만 둔다(#39) */
  let talkPokes = 0;
  let formPokes = 0;
  let poked = $state(false);
  const countPokes = () => (poked = talkPokes + formPokes >= POKE.greetPokedAt);
  function onFormFocusOut() {
    const filled = formFilled;
    if (filled > seenFilled) {
      formEgg?.react(filled === FORM_KEYS.length ? 'hop' : 'tap');
      emitCue(filled === FORM_KEYS.length ? 'egg-ready' : 'egg-crack');
    }
    seenFilled = filled;
  }

  // 읽지 못해 따로 옮겨 둔 데이터: 내려받거나 글자로 볼 수 있게 한다.
  let corruptDownloaded = $state(false);
  let showCorruptText = $state(false);
  const corruptCopies = $derived(app.corruptKept ? app.corruptCopies() : []);
  function downloadCorrupt() {
    const day = clock.today.replace(/-/g, '');
    corruptCopies.forEach((raw, i) => {
      const suffix = corruptCopies.length > 1 ? `-${i + 1}` : '';
      downloadText(raw, `hobong-unreadable-${day}${suffix}.json`);
    });
    corruptDownloaded = true;
  }

  function undoImport() {
    const result = app.undoImport();
    // 'discarded': 다른 탭이 바꾼 데이터를 따라갔다 / 'blocked': 지금은 저장할 수 없다(app 이 알린다)
    if (result === 'undone') app.toast('불러오기 전 상태로 되돌렸어요.', 'good', 'icon-undo');
    else if (result === false) app.toast('되돌릴 수 있는 상태가 없어요.', 'warn', 'icon-warn');
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (app.newerNotice) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      dropped = file;
      importing = true;
    }
  }
</script>

<main
  class="welcome"
  class:dragging
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (e.target === e.currentTarget) dragging = false;
  }}
  ondrop={onDrop}
>
  <div class="inner" class:top={step === 'talk' || step === 'hatch'}>
    {#if step === 'intro'}
      <section class="win hero" id="welcome-intro">
        <header class="win-title">
          <Icon name="icon-tiger" />
          <h1>호봉 — 공무원 상태창</h1>
          <span class="aside cap">{rules.meta.sectionYear.salary}년 기준</span>
        </header>
        <div class="win-body stack wide">
          <div class="stage">
            <Sprite
              sprite={characterRules.egg}
              frame={0}
              scale={4}
              label="아직 깨어나지 않은 호봉이의 알"
            />
          </div>
          <div class="stack">
            <p class="lead">호봉이 오르면 자라는 <span class="nowrap">아기 봉황 "호봉이"</span></p>
            <p class="muted">
              호봉·월급·승급일·연가·정년을 한 화면에서 볼 수 있어요. 임용일을 넣으면 알에서 호봉이가
              깨어나요.
            </p>
          </div>

          {#if app.newerNotice}
            <div class="note warn stack" role="alert" id="welcome-newer">
              <p>
                이 브라우저에는 더 새 버전의 호봉에서 저장한 데이터가 있어요. 지금 연 호봉(또는
                hobong.html 파일)은 예전 버전이라, 데이터를 건드리지 않도록 아무것도 하지 않아요.
              </p>
              <p>새 버전의 호봉으로 열어 주세요. 데이터는 그대로 남아 있어요.</p>
            </div>
          {:else}
            {#if app.corruptKept}
              <div class="note warn stack" role="alert" id="welcome-corrupt">
                <p>
                  이 브라우저에 저장돼 있던 데이터를 읽지 못해 따로 옮겨 두었어요. 지우지 않았으니
                  내려받아 보관해 두세요.
                </p>
                {#if app.corruptNotice}<p class="cap muted">
                    읽지 못한 까닭: {app.corruptNotice}
                  </p>{/if}
                <div class="btn-row">
                  <button type="button" class="btn small" onclick={downloadCorrupt}>
                    <Icon name="icon-download" /> 읽지 못한 데이터 내려받기
                  </button>
                  <button
                    type="button"
                    class="btn small ghost"
                    onclick={() => (showCorruptText = !showCorruptText)}
                    aria-expanded={showCorruptText}
                  >
                    글자로 보기
                  </button>
                  {#if corruptDownloaded}
                    <button
                      type="button"
                      class="btn small ghost"
                      onclick={() => app.discardCorruptCopies()}
                    >
                      따로 둔 데이터 지우기
                    </button>
                  {/if}
                </div>
                {#if showCorruptText}
                  {#each corruptCopies as raw, i (i)}
                    <textarea
                      class="input mono"
                      readonly
                      rows="6"
                      aria-label="읽지 못한 데이터 {i + 1}">{raw}</textarea
                    >
                  {/each}
                {/if}
                <p class="cap muted">
                  받아 둔 임용정보 패키지(백업 파일)가 있다면 "패키지로 이어하기"로 이어서 쓸 수
                  있어요.
                </p>
              </div>
            {/if}

            {#if app.undoSavedAt}
              <div class="note stack" id="welcome-undo">
                <p>
                  불러오기 직전 상태가 보관돼 있어요. <span class="cap muted nowrap">
                    ({formatInstant(app.undoSavedAt)})
                  </span>
                </p>
                <div class="btn-row">
                  <button type="button" class="btn small" onclick={undoImport}>
                    <Icon name="icon-undo" /> 불러오기 전으로 되돌리기
                  </button>
                </div>
              </div>
            {/if}

            <div class="choices">
              <button type="button" class="btn primary choice" bind:this={startBtn} onclick={start}>
                <Icon name="icon-egg" scale={2} />
                <span>새로 시작</span>
              </button>
              <button type="button" class="btn choice" onclick={() => (importing = true)}>
                <Icon name="icon-package" scale={2} />
                <span>패키지로 이어하기</span>
              </button>
            </div>
            <p class="cap muted center">{TALK.package.welcome}</p>
            <p class="cap muted center fine-only">
              임용정보 패키지 파일을 이 화면에 끌어다 놓아도 돼요.
            </p>
          {/if}

          <ul class="facts cap">
            <li>
              <Icon name="icon-shield" /> 서버가 없어요. 입력한 내용은 이 브라우저에만 저장돼요.
            </li>
            <li>
              <Icon name="icon-lock" /> 외부로 나가는 통신이 없어요. 인터넷이 막힌 업무망에서도 그대로
              동작해요.
            </li>
            <li>
              <Icon name="icon-user" /> 실명·소속은 묻지 않아요. 이름 대신 닉네임을 쓰고, 직종·계급은
              계산 규정을 고르는 데만 써요. 홈 화면의 계급 이름은 설정 '내 정보'에서 숨길 수 있어요.
            </li>
            <li><Icon name="icon-book" /> 금액은 봉급표 기준 추정치이며 실수령액과 달라요.</li>
          </ul>
          {#if !app.persistent}
            <p class="note warn">
              이 브라우저는 저장소를 쓸 수 없는 상태예요(사생활 보호 창이거나 정책으로 막힘). 창을
              닫으면 내용이 사라지니 임용정보 패키지를 내려받아 보관해 주세요.
            </p>
          {/if}
        </div>
      </section>
    {/if}
    {#if talkOpened}
      <div hidden={step !== 'talk'}>
        <Talk
          bind:this={talk}
          {draft}
          bind:look
          bind:showIdentity
          bind:haptics
          active={step === 'talk'}
          onform={goForm}
          onhatch={() => create(draft.toProfile(), draft.payday)}
          onexit={() => goIntro({ viaHistory: !guarded })}
          onpoke={(n) => {
            talkPokes = n;
            countPokes();
          }}
        />
      </div>
    {/if}
    {#if formOpened}
      <div hidden={step !== 'form'}>
        <section class="win" id="welcome-form" aria-labelledby="welcome-form-title">
          <header class="win-title">
            <button type="button" class="btn ghost small back" onclick={() => goIntro()}>
              <Icon name="icon-chevron-left" /> 뒤로
            </button>
            <h1 id="welcome-form-title" tabindex="-1" bind:this={formHeading}>내 정보 넣기</h1>
            <button
              type="button"
              class="btn ghost small mode"
              onclick={goTalk}
              title={TALK.modes.talkHint}
            >
              <Icon name="icon-chat" />
              {TALK.modes.talk}
            </button>
          </header>
          <!-- 폼을 내려도 위에 붙어 있는 알(누르면 반응한다. 붙어 있기는 단추가 맡는다) -->
          <EggPoke
            egg={formEgg}
            stage={formStage}
            sticky
            onpoke={(n) => {
              formPokes = n;
              countPokes();
            }}
          >
            <span class="mini-stage" aria-hidden="true">
              <EggStage
                bind:this={formEgg}
                pokeable
                stage={formStage}
                ready={formFilled === FORM_KEYS.length}
                scale={2}
                rows={30}
              />
            </span>
          </EggPoke>
          <div class="win-body" onfocusout={onFormFocusOut}>
            <ProfileForm
              {draft}
              askPayday
              submitLabel="알 깨우기"
              onsubmit={(profile, payday) => create(profile, payday)}
            />
          </div>
        </section>
        <p class="cap muted center foot">
          적용 대상: {rules.target.label} — 일반직(공안·우정 포함)·경찰·소방·국공립 교원. 지방공무원 일반직(시·도
          교육청·학교 포함)·해양경찰·외무는 일부, 군무원과 그 밖의 특정직은 준비 중이에요. 입력한 값은
          설정에서 언제든 고칠 수 있어요.
        </p>
      </div>
    {/if}
    {#if step === 'hatch' && hatchedLook}
      <Hatch
        look={hatchedLook}
        nickname={view.profile.nickname}
        {seed}
        {poked}
        onend={() => app.finishHatch()}
      />
    {/if}
  </div>
</main>

{#if importing}
  <ImportDialog
    file={dropped}
    onclose={() => {
      importing = false;
      dropped = null;
    }}
  />
{/if}

<style>
  .mono {
    font-family: monospace;
    font-size: 12px;
  }
  .welcome {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    justify-content: center;
    padding: calc(18px + var(--safe-t)) calc(12px + var(--safe-r)) calc(24px + var(--safe-b))
      calc(12px + var(--safe-l));
  }
  .welcome.dragging {
    outline: 6px dashed var(--accent);
    outline-offset: -12px;
  }
  .inner {
    width: min(480px, 100%);
    margin: auto 0;
  }
  /* 대화·부화 화면은 위에 붙인다(질문마다 창 높이가 달라 가운데에 두면 위아래로 튄다) */
  .inner.top {
    margin: 0;
  }
  .stage {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    padding: 12px 0 0;
    background: linear-gradient(
      var(--stage) 0 calc(100% - 24px),
      var(--stage-ground) calc(100% - 24px) 100%
    );
    box-shadow: var(--frame);
    margin: var(--u);
  }
  .lead {
    font-size: 15px;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 9px;
  }
  .choice {
    flex-direction: column;
    gap: 6px;
    min-height: 96px;
    padding-top: 12px;
    padding-bottom: 15px;
  }
  .choice:active {
    padding-top: 15px;
    padding-bottom: 12px;
  }
  .facts {
    display: grid;
    gap: 6px;
    color: var(--ink-2);
  }
  .facts li {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .center {
    text-align: center;
  }
  .foot {
    margin-top: 12px;
  }
  .back,
  .mode {
    flex: none;
    color: var(--title-ink);
  }
  .back {
    margin: 0 0 0 -6px;
  }
  .mode {
    margin: 0 -6px 0 auto;
  }
  /* 한 번에 쓰기의 작은 알: 폼을 내려도 위에 붙어 반응이 보인다(붙어 있기는 감싼 단추 EggPoke 가 맡는다) */
  .mini-stage {
    display: flex;
    justify-content: center;
    align-items: flex-end;
    background: linear-gradient(
      var(--stage) 0 calc(100% - 12px),
      var(--stage-ground) calc(100% - 12px) 100%
    );
    box-shadow: 0 var(--u) 0 0 var(--line);
    overflow: hidden;
  }
</style>
