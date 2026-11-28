<script lang="ts">
  /**
   * 임용정보 패키지 안내(홈 상태창 안, 호봉이 무대 바로 아래). 첫 입력을 마치고 깨어난 사람에게 한 번 권한다.
   * - 창들의 차례 등장이 끝난 뒤 호봉이의 한마디처럼 나온다: 보따리 그림 + 한 문장 + [패키지 받기]·[나중에].
   *   암호 걸기와 주의할 점은 [자세히]에 접어 둔다. 휴대폰 첫 화면에서도 스크롤 없이 보인다.
   * - 받으면 보따리가 통 튀고 반짝이가 터진다(진동은 'package-saved' 신호가 맡는다). 그 자리에서 '챙겼어요'로 바뀌고,
   *   '로그인은 준비 중' 한마디와 호봉 알리기는 받은 뒤에만 보인다.
   * - 받으면(lastBackupAt 기록) 다시 나오지 않는다. '나중에'를 눌러도 다시 묻지 않는다(이 기기에 기억: prefs).
   * - 낭독: 받은 뒤 포커스는 제목('챙겼어요!')으로 가고, 파일 이름 안내 한 줄만 알림 영역(role=status)이다.
   *   알림(토스트)은 따로 띄우지 않는다(같은 말을 두 번 읽지 않게).
   * - 암호 걸기는 1차의 암호 대화상자를 그대로 쓴다. 여기서 고른 값은 저장하지 않는다.
   * - 이 안내가 답을 기다리는 동안 '패키지를 받아 두세요' 띠(Notices)는 미룬다. [나중에]를 고르면 이 탭에서는 띠도 미룬다.
   */
  import { tick } from 'svelte';
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { downloadPackage } from '../../lib/app/package.ts';
  import { prefs } from '../../lib/app/prefs.svelte.ts';
  import { BACKUP_NUDGE_KEY, session } from '../../lib/app/session.svelte.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { sparkle } from '../../lib/fx/sparkle.ts';
  import { canEncrypt } from '../../lib/store/crypto.ts';
  import { fillLine, TALK } from '../../lib/talk.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import LockDialog from '../settings/LockDialog.svelte';
  import ShareNote from '../share/ShareNote.svelte';

  const P = TALK.package;
  const canLock = canEncrypt();
  let lock = $state(false);
  let asking = $state(false);
  let more = $state(false);
  /** 막 받았다: '챙겼어요'를 보이고, 닫기를 누르면 접는다 */
  let saved = $state(false);
  /** 받은 파일 안내 한 줄(알림 영역) */
  let savedLine = $state('');
  /** 보따리가 통 튀는 중 */
  let bounce = $state(false);
  let title = $state<HTMLElement>();
  let bundle = $state<HTMLElement>();

  /**
   * 받는 중: 내려받기가 '받음'을 기록하는 순간과 '챙겼어요'로 바뀌는 순간 사이에 안내가 사라졌다 다시 생기지 않게
   * (다시 생기면 펼쳐지는 움직임이 한 번 더 돌고 포커스 자리도 새로 만들어진다)
   */
  let getting = $state(false);

  const show = $derived(
    saved || getting || (prefs.packageGuide === 'pending' && view.data.meta.lastBackupAt === null),
  );

  /** 닫힌 뒤 포커스가 허공에 뜨지 않게 본문으로 */
  async function focusMain() {
    await tick();
    document.getElementById('main')?.focus({ preventScroll: true });
  }

  /** 받았다: 그 자리에서 '챙겼어요'로 바꾸고 제목으로 포커스를 옮긴다. 보따리가 통 튀고 반짝이가 터진다 */
  async function finish(fileName: string, locked: boolean) {
    saved = true;
    more = false;
    prefs.set({ packageGuide: 'done' });
    await tick();
    title?.focus({ preventScroll: true });
    savedLine = `${fillLine(P.saved, { file: fileName })} ${P.done}${locked ? ` ${P.savedLocked}` : ''}`;
    bounce = true;
    const box = bundle?.getBoundingClientRect();
    if (box) sparkle(box.left + box.width / 2, box.top + box.height / 2, { count: 12 });
  }

  function toSettings() {
    app.toast(
      "이 브라우저에서는 파일로 받을 수 없어요. 설정의 '임용정보 패키지'에서 글자로 보고 복사해 주세요.",
      'warn',
      'icon-warn',
      7000,
    );
    nav.go('settings');
  }

  async function get() {
    if (lock && canLock) {
      asking = true;
      return;
    }
    getting = true;
    const outcome = await downloadPackage(view.today);
    if (outcome.status === 'saved') await finish(outcome.fileName, false);
    else if (outcome.status === 'stale')
      app.toast(
        `내려받기를 시작했어요. 다만 그 사이 다른 탭에서 바뀐 내용이 있어 ${outcome.fileName} 에는 들어 있지 않아요. 한 번 더 받아 주세요.`,
        'warn',
        'icon-warn',
        9000,
      );
    else toSettings();
    getting = false;
  }

  async function getLocked(password: string) {
    getting = true;
    const outcome = await downloadPackage(view.today, password);
    if (outcome.status === 'lock-failed') {
      getting = false;
      return outcome.code;
    }
    asking = false;
    await tick();
    if (outcome.status === 'saved') await finish(outcome.fileName, true);
    else if (outcome.status === 'stale')
      app.toast(
        `암호를 걸어 내려받기를 시작했어요. 다만 그 사이 다른 탭에서 바뀐 내용이 있어 ${outcome.fileName} 에는 들어 있지 않아요. 한 번 더 받아 주세요.`,
        'warn',
        'icon-warn',
        9000,
      );
    else toSettings();
    getting = false;
    return 'done' as const;
  }

  function later() {
    prefs.set({ packageGuide: 'later' });
    // 방금 '나중에'라고 답했으니 이 탭에서는 '패키지를 받아 두세요' 띠도 띄우지 않는다(부록 P2)
    session.dismiss(BACKUP_NUDGE_KEY);
    app.toast(P.laterToast, 'info', 'icon-package', 5000);
    void focusMain();
  }

  function close() {
    saved = false;
    void focusMain();
  }

  function customize() {
    nav.lookRequested = true;
    nav.go('settings');
  }
</script>

{#if show}
  <!-- 펼쳐지며 나온다(아래 내용을 뚝 밀어내지 않게). 움직임 줄이기면 바로 보인다 -->
  <div class="unfold">
    <div class="clip">
      <section class="pkg" class:saved id="package-guide" aria-labelledby="package-guide-title">
        <div class="head">
          <span
            class="bundle"
            class:bounce
            aria-hidden="true"
            bind:this={bundle}
            onanimationend={() => (bounce = false)}
          >
            <Icon name="icon-package" scale={2} />
          </span>
          <div class="stack says">
            <h3 id="package-guide-title" tabindex="-1" bind:this={title}>
              {saved ? P.doneTitle : P.title}
            </h3>
            {#if !saved}<p class="cap">{P.lead}</p>{/if}
            <!-- 받은 뒤의 안내 한 줄만 알린다(위트·공유·버튼은 알림 영역 밖) -->
            <p class="cap" role="status" id="package-saved">{saved ? savedLine : ''}</p>
          </div>
        </div>

        {#if saved}
          <ShareNote variant={0} />
          <div class="btn-row end">
            <button type="button" class="btn small" onclick={customize} title={P.customizeHint}>
              <Icon name="icon-palette" />
              {P.customize}
            </button>
            <button type="button" class="btn small" onclick={close}>{P.close}</button>
          </div>
        {:else}
          <div class="btn-row acts">
            <button type="button" class="btn primary" onclick={get}>
              <Icon name="icon-download" />
              {P.get}
            </button>
            <button type="button" class="btn" onclick={later}>{P.later}</button>
            <button
              type="button"
              class="btn ghost small more"
              aria-expanded={more}
              aria-controls="package-more"
              onclick={() => (more = !more)}
            >
              <span aria-hidden="true">{more ? '▼' : '▶'}</span>
              {P.more}
            </button>
          </div>
          {#if more}
            <div class="stack wide well" id="package-more">
              <p class="cap">{P.body.join(' ')}</p>
              {#if canLock}
                <div class="stack">
                  <label class="switch">
                    <input
                      type="checkbox"
                      bind:checked={lock}
                      aria-describedby="package-lock-hint"
                    />
                    <span class="box" aria-hidden="true"></span>
                    <span>{P.lock}</span>
                  </label>
                  <span class="cap muted" id="package-lock-hint">{P.lockHint}</span>
                </div>
              {/if}
              <p class="cap muted">{P.fine}</p>
              <div class="btn-row">
                <button type="button" class="btn small" onclick={customize} title={P.customizeHint}>
                  <Icon name="icon-palette" />
                  {P.customize}
                </button>
              </div>
            </div>
          {/if}
        {/if}
      </section>
    </div>
  </div>
{/if}

{#if asking}
  <LockDialog mode="file" onconfirm={getLocked} onclose={() => (asking = false)} />
{/if}

<style>
  @keyframes unfold {
    from {
      grid-template-rows: 0fr;
      opacity: 0;
    }
    to {
      grid-template-rows: 1fr;
      opacity: 1;
    }
  }
  .unfold {
    display: grid;
    grid-template-rows: 1fr;
    min-width: 0;
    animation: unfold 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  /* 테두리(바깥 3px)와 꼬리(위 6px)가 잘리지 않을 만큼 안쪽 여백을 둔다 */
  .clip {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: 6px 0 0;
  }
  /* 호봉이의 한마디처럼: 말풍선 색 바탕에 먹색 테두리, 꼬리는 위(무대의 호봉이)를 가리킨다 */
  .pkg {
    position: relative;
    display: grid;
    gap: 9px;
    min-width: 0;
    padding: 9px 12px;
    margin: var(--u);
    background: var(--bubble);
    color: #1a1c2c;
    box-shadow:
      0 calc(var(--u) * -1) 0 0 #1a1c2c,
      0 var(--u) 0 0 #1a1c2c,
      calc(var(--u) * -1) 0 0 0 #1a1c2c,
      var(--u) 0 0 0 #1a1c2c;
  }
  .pkg::before {
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
  .head {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .says {
    flex: 1 1 auto;
    min-width: 0;
    gap: 3px;
  }
  h3 {
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  h3:focus-visible {
    outline-offset: 3px;
  }
  .says p:empty {
    display: none;
  }
  .bundle {
    flex: none;
    line-height: 0;
  }
  /* 받으면 보따리가 통 튄다(정수 픽셀 계단) */
  @keyframes bundle-bounce {
    0% {
      transform: none;
    }
    25% {
      transform: translateY(-9px);
    }
    50% {
      transform: none;
    }
    70% {
      transform: translateY(-3px);
    }
    100% {
      transform: none;
    }
  }
  .bundle.bounce {
    animation: bundle-bounce 0.48s steps(8, end) both;
  }
  .acts {
    align-items: center;
  }
  .more {
    margin-left: auto;
    color: inherit;
  }
  .pkg :global(.muted) {
    color: #333c57;
  }
  .pkg :global(.well) {
    background: rgba(26, 28, 44, 0.08);
  }
  @media (forced-colors: active) {
    .pkg {
      border: var(--u) solid CanvasText;
    }
    .pkg::before {
      display: none;
    }
  }
</style>
