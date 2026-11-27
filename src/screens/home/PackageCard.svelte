<script lang="ts">
  /**
   * 임용정보 패키지 안내 창(홈 맨 위). 첫 입력을 마치고 깨어난 사람에게 한 번 권한다.
   * - 받으면(lastBackupAt 기록) 다시 나오지 않는다. '나중에'를 눌러도 다시 묻지 않는다(이 기기에 기억: prefs).
   * - 대화상자가 아니라 홈의 창이다(연출이 끝난 화면을 막지 않는다).
   * - 암호 걸기는 1차의 암호 대화상자를 그대로 쓴다. 여기서 고른 값은 저장하지 않는다.
   */
  import { tick } from 'svelte';
  import { nav } from '../../lib/app/nav.svelte.ts';
  import { downloadPackage } from '../../lib/app/package.ts';
  import { prefs } from '../../lib/app/prefs.svelte.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { canEncrypt } from '../../lib/store/crypto.ts';
  import { fillLine, TALK } from '../../lib/talk.ts';
  import Icon from '../../lib/ui/Icon.svelte';
  import Win from '../../lib/ui/Win.svelte';
  import LockDialog from '../settings/LockDialog.svelte';
  import ShareNote from '../share/ShareNote.svelte';

  const P = TALK.package;
  const canLock = canEncrypt();
  let lock = $state(false);
  let asking = $state(false);
  /** 막 받았다: '챙겼어요'를 잠깐 보이고 접는다 */
  let saved = $state(false);

  const show = $derived(
    saved || (prefs.packageGuide === 'pending' && view.data.meta.lastBackupAt === null),
  );

  /** 닫힌 뒤 포커스가 허공에 뜨지 않게 본문으로 */
  async function focusMain() {
    await tick();
    document.getElementById('main')?.focus({ preventScroll: true });
  }

  async function finish(fileName: string, locked: boolean) {
    saved = true;
    prefs.set({ packageGuide: 'done' });
    app.toast(
      `${fillLine(P.saved, { file: fileName })}${locked ? ` ${P.savedLocked}` : ''}`,
      'good',
      'icon-package',
      8000,
    );
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
  }

  async function getLocked(password: string) {
    const outcome = await downloadPackage(view.today, password);
    if (outcome.status === 'lock-failed') return outcome.code;
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
    return 'done' as const;
  }

  function later() {
    prefs.set({ packageGuide: 'later' });
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
  <div class="guide pop-in">
    <Win title={P.title} icon="icon-package" id="package-guide">
      {#if saved}
        <div class="stack wide" role="status">
          <p>{P.done}</p>
          <ShareNote variant={1} />
          <div class="btn-row end">
            <button type="button" class="btn" onclick={close}>닫기</button>
          </div>
        </div>
      {:else}
        <div class="stack wide">
          <p>{P.body.join(' ')}</p>
          {#if canLock}
            <div class="stack">
              <label class="switch">
                <input type="checkbox" bind:checked={lock} aria-describedby="package-lock-hint" />
                <span class="box" aria-hidden="true"></span>
                <span>{P.lock}</span>
              </label>
              <span class="cap muted" id="package-lock-hint">{P.lockHint}</span>
            </div>
          {/if}
          <div class="btn-row">
            <button type="button" class="btn primary" onclick={get}>
              <Icon name="icon-download" />
              {P.get}
            </button>
            <button type="button" class="btn" onclick={later}>{P.later}</button>
          </div>
          <p class="cap muted">{P.fine}</p>
          <hr class="rule" />
          <ShareNote variant={0} />
          <div class="btn-row">
            <button type="button" class="btn small" onclick={customize} title={P.customizeHint}>
              <Icon name="icon-palette" />
              {P.customize}
            </button>
          </div>
        </div>
      {/if}
    </Win>
  </div>
{/if}

{#if asking}
  <LockDialog mode="file" onconfirm={getLocked} onclose={() => (asking = false)} />
{/if}

<style>
  .guide {
    min-width: 0;
  }
</style>
