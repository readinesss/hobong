<script lang="ts">
  /**
   * 암호 걸어 내려받기(또는 글자로 보기) 대화상자.
   * 암호는 onconfirm 인자로만 넘기고 어디에도 담지 않는다. 시도하면 맞든 틀리든 입력란을 비운다.
   */
  import { tick } from 'svelte';
  import { MIN_PASSWORD_LENGTH, passwordLength } from '../../lib/store/crypto.ts';
  import Modal from '../../lib/ui/Modal.svelte';

  type LockOutcome = 'done' | 'too-short' | 'unsupported' | 'format';

  interface Props {
    mode: 'file' | 'text';
    /** 암호를 걸어 내보낸다. 끝나면 'done' */
    onconfirm: (password: string) => Promise<LockOutcome>;
    onclose: () => void;
  }

  let { mode, onconfirm, onclose }: Props = $props();

  let pw1 = $state('');
  let pw2 = $state('');
  let busy = $state(false);
  let error = $state<'mismatch' | 'too-short' | 'unsupported' | 'format' | null>(null);
  let pw1El = $state<HTMLInputElement>();

  const MESSAGES = {
    mismatch: '두 암호가 서로 달라요.',
    'too-short': `암호를 ${MIN_PASSWORD_LENGTH}자 이상 넣어 주세요.`,
    unsupported: '이 브라우저에서는 암호를 걸 수 없어요.',
    format: '백업 내용이 너무 커서 암호를 걸지 못했어요.',
  } as const;

  function clear() {
    pw1 = '';
    pw2 = '';
  }

  function close() {
    clear();
    onclose();
  }

  async function confirm() {
    if (busy) return;
    const first = pw1;
    const second = pw2;
    // 화면에 보이지 않는 글자라 틀리면 둘 다 비우고 처음부터 다시 넣게 한다
    clear();
    if (passwordLength(first) < MIN_PASSWORD_LENGTH) error = 'too-short';
    else if (first !== second) error = 'mismatch';
    else error = null;
    if (error) {
      await tick();
      pw1El?.focus();
      return;
    }
    busy = true;
    const outcome = await onconfirm(first);
    busy = false;
    if (outcome !== 'done') {
      error = outcome;
      await tick();
      pw1El?.focus();
    }
  }

  function onEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      void confirm();
    }
  }
</script>

<Modal
  title={mode === 'file' ? '암호 걸어 내려받기' : '암호 걸어 글자로 보기'}
  icon="icon-lock"
  dismissible={!busy}
  onclose={close}
>
  <div class="stack wide" id="lock-dialog">
    <div class="field">
      <label for="lock-pw">암호</label>
      <input
        bind:this={pw1El}
        bind:value={pw1}
        id="lock-pw"
        class="input"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        readonly={busy}
        aria-describedby="lock-hint"
        aria-invalid={error === 'too-short' || error === 'mismatch' ? 'true' : undefined}
        data-autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            document.getElementById('lock-pw2')?.focus();
          }
        }}
      />
    </div>
    <div class="field">
      <label for="lock-pw2">암호 확인</label>
      <input
        bind:value={pw2}
        id="lock-pw2"
        class="input"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        readonly={busy}
        aria-invalid={error === 'mismatch' ? 'true' : undefined}
        onkeydown={onEnter}
      />
    </div>
    <!-- 오류는 입력란 바로 아래에 둔다(안내와 섞여 보이지 않게) -->
    {#if busy}<p class="cap muted" role="status">암호를 거는 중이에요…</p>{/if}
    {#if error}<p class="note warn" role="alert">{MESSAGES[error]}</p>{/if}
    <p class="note warn" id="lock-hint">
      암호는 어디에도 저장하지 않아요. 잊으면 아무도(호봉도) 이 파일을 되살릴 수 없어요. 따로 적어
      두세요. {MIN_PASSWORD_LENGTH}자 이상이어야 해요.
    </p>
  </div>
  {#snippet actions()}
    <button type="button" class="btn" onclick={close} disabled={busy}>취소</button>
    <button type="button" class="btn primary" onclick={() => void confirm()} disabled={busy}>
      {mode === 'file' ? '암호 걸고 내려받기' : '암호 걸고 글자로 보기'}
    </button>
  {/snippet}
</Modal>
