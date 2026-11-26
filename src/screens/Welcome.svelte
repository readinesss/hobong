<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/app/state.svelte.ts';
  import { clock } from '../lib/app/clock.svelte.ts';
  import { downloadText } from '../lib/app/files.ts';
  import { formatInstant } from '../lib/app/format.ts';
  import { yearOf } from '../lib/calc/date.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { rulesFor } from '../lib/rules/index.ts';
  import type { Profile } from '../lib/store/schema.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Sprite from '../lib/ui/Sprite.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import ProfileForm from './ProfileForm.svelte';

  let step = $state<'intro' | 'form'>('intro');
  /** 폼을 한 번 열었으면 계속 그려 둔다('뒤로'를 눌러도 입력한 값이 남는다) */
  let formOpened = $state(false);
  let startBtn = $state<HTMLButtonElement>();
  let formHeading = $state<HTMLHeadingElement>();

  // 화면이 바뀐 것을 제목으로도 알린다
  $effect(() => {
    document.title = step === 'form' ? '내 정보 넣기 · 호봉' : '호봉 — 공무원 상태창';
  });

  /** 폼으로: 누른 버튼이 사라지므로 새 화면의 제목으로 포커스를 옮긴다 */
  async function goForm() {
    formOpened = true;
    step = 'form';
    await tick();
    window.scrollTo(0, 0);
    formHeading?.focus({ preventScroll: true });
  }

  /** 첫 화면으로: '새로 시작' 버튼으로 포커스를 되돌린다 */
  async function goIntro() {
    step = 'intro';
    await tick();
    startBtn?.focus();
  }
  let importing = $state(false);
  let dropped = $state<File | null>(null);
  let dragging = $state(false);

  const rules = $derived(rulesFor(yearOf(clock.today)));

  function create(profile: Profile, payday: number) {
    app.createProfile(profile, { payday });
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
    if (app.undoImport()) app.toast('불러오기 전 상태로 되돌렸어요.', 'good', 'icon-undo');
    else app.toast('되돌릴 수 있는 상태가 없어요.', 'warn', 'icon-warn');
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
  <div class="inner">
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
                  내려받아 둔 백업 파일이 있다면 "데이터 불러오기"로 이어서 쓸 수 있어요.
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
              <button
                type="button"
                class="btn primary choice"
                bind:this={startBtn}
                onclick={goForm}
              >
                <Icon name="icon-egg" scale={2} />
                <span>새로 시작</span>
              </button>
              <button type="button" class="btn choice" onclick={() => (importing = true)}>
                <Icon name="icon-upload" scale={2} />
                <span>데이터 불러오기</span>
              </button>
            </div>
            <p class="cap muted center fine-only">백업 파일을 이 화면에 끌어다 놓아도 돼요.</p>
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
              계산 규정을 고르는 데만 써요. 홈 화면에는 계급 이름이 보이니 화면을 공유할 때 참고해 주세요.
            </li>
            <li><Icon name="icon-book" /> 금액은 봉급표 기준 추정치이며 실수령액과 달라요.</li>
          </ul>
          {#if !app.persistent}
            <p class="note warn">
              이 브라우저는 저장소를 쓸 수 없는 상태예요(사생활 보호 창이거나 정책으로 막힘). 창을
              닫으면 내용이 사라지니 데이터 내려받기로 보관해 주세요.
            </p>
          {/if}
        </div>
      </section>
    {/if}
    {#if formOpened}
      <div hidden={step !== 'form'}>
        <section class="win" id="welcome-form" aria-labelledby="welcome-form-title">
          <header class="win-title">
            <button type="button" class="btn ghost small back" onclick={goIntro}>
              <Icon name="icon-chevron-left" /> 뒤로
            </button>
            <h1 id="welcome-form-title" tabindex="-1" bind:this={formHeading}>내 정보 넣기</h1>
          </header>
          <div class="win-body">
            <ProfileForm askPayday submitLabel="알 깨우기" onsubmit={create} />
          </div>
        </section>
        <p class="cap muted center foot">
          적용 대상: {rules.target.label} — 일반직(공안·우정 포함)·경찰·소방·국공립 교원. 해양경찰·외무는
          일부, 군무원과 그 밖의 특정직은 준비 중이에요. 입력한 값은 설정에서 언제든 고칠 수 있어요.
        </p>
      </div>
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
  .back {
    flex: none;
    color: var(--title-ink);
    margin: 0 0 0 -6px;
  }
</style>
