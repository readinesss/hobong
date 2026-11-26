<script lang="ts">
  import { tick } from 'svelte';
  import { nav } from '../lib/app/nav.svelte.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { readFileText } from '../lib/app/files.ts';
  import { formatInstant } from '../lib/app/format.ts';
  import { type ParseResult } from '../lib/store/backup.ts';
  import {
    canEncrypt,
    decryptBackup,
    looksEncrypted,
    MAX_ENCRYPTED_BYTES,
    readEncrypted,
    type LockError,
  } from '../lib/store/crypto.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';

  interface Props {
    onclose: () => void;
    /** 끌어다 놓은 파일로 바로 시작할 때 */
    file?: File | null;
  }

  let { onclose, file = null }: Props = $props();

  type Ok = Extract<ParseResult, { ok: true }>;
  let result = $state<ParseResult | null>(null);
  let fileName = $state('');
  let busy = $state(false);
  let readError = $state('');
  let showPaste = $state(false);
  let pasted = $state('');
  let dragging = $state(false);
  let inputEl = $state<HTMLInputElement>();
  /** 마지막으로 읽은 것이 파일인지 붙여넣은 글자인지(안내 문구를 알맞게 고른다) */
  let source = $state<'file' | 'paste'>('file');

  // ── 암호가 걸린 백업 ────────────────────────────────────────────────
  /** 암호를 묻는 중인 파일(암호문 그대로. 평문이 아니다) */
  let locked = $state<{ text: string; name: string; source: 'file' | 'paste' } | null>(null);
  /** 암호 입력값. 풀기를 시도하면 맞든 틀리든 바로 비운다(어디에도 남기지 않는다) */
  let password = $state('');
  let unlocking = $state(false);
  let lockError = $state<LockError | null>(null);
  let passwordEl = $state<HTMLInputElement>();

  const hasExisting = $derived(app.data !== null);
  const ok = $derived(result && result.ok ? (result as Ok) : null);

  function lockMessage(code: LockError, from: 'file' | 'paste'): string {
    switch (code) {
      case 'wrong-or-damaged':
        return '암호가 틀렸거나 파일이 손상됐어요. 암호를 건 파일은 이 둘을 구별할 수 없어요. 암호를 다시 넣어 주세요.';
      case 'iterations':
        return '암호 파일의 설정 값이 허용 범위를 벗어나 열지 않았어요.';
      case 'newer':
        return '더 새 버전의 호봉에서 만든 암호 파일이에요. 새 hobong.html로 열어 주세요.';
      case 'unsupported':
        return '이 브라우저에서는 암호가 걸린 파일을 열 수 없어요. 최신 Chrome·Edge·Safari·Firefox에서 열어 주세요.';
      default:
        return from === 'file'
          ? '암호 파일의 형식이 맞지 않아요. 내려받은 파일을 그대로 골랐는지 확인해 주세요.'
          : '암호 파일의 형식이 맞지 않아요. 처음부터 끝까지 빠짐없이 붙여넣었는지 확인해 주세요.';
    }
  }

  /** 읽은 글자를 살핀다: 암호 파일이면 암호를 묻고, 아니면 지금처럼 바로 검사한다 */
  function examine(text: string, name: string, from: 'file' | 'paste') {
    locked = null;
    password = '';
    lockError = null;
    if (!looksEncrypted(text)) {
      result = app.inspect(text);
      return;
    }
    result = null;
    if (!canEncrypt()) {
      readError = lockMessage('unsupported', from);
      return;
    }
    // 형식·반복 횟수가 틀린 파일은 암호를 묻기 전에 거른다
    const head = readEncrypted(text);
    if (!head.ok) {
      readError = lockMessage(head.code, from);
      return;
    }
    locked = { text, name, source: from };
  }

  async function unlock() {
    if (!locked || unlocking || password === '') return;
    const target = locked;
    const typed = password;
    password = '';
    unlocking = true;
    lockError = null;
    const opened = await decryptBackup(target.text, typed);
    unlocking = false;
    // 기다리는 사이 다른 파일로 바뀌었으면 버린다
    if (locked !== target) return;
    if (!opened.ok) {
      lockError = opened.code;
      void tick().then(() => passwordEl?.focus());
      return;
    }
    // 푼 평문은 암호 없는 파일과 똑같이 검사한다(덮어쓰기 경고·되돌리기 보관 포함)
    locked = null;
    fileName = target.name;
    source = target.source;
    result = app.inspect(opened.plain);
  }

  async function take(f: File) {
    busy = true;
    readError = '';
    result = null;
    locked = null;
    source = 'file';
    fileName = f.name;
    try {
      examine(await readFileText(f, MAX_ENCRYPTED_BYTES), f.name, 'file');
    } catch (error) {
      readError = error instanceof Error ? error.message : '파일을 읽지 못했어요.';
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    if (file) void take(file);
  });

  function onPick(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    const f = el.files?.[0];
    if (f) void take(f);
    el.value = '';
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const f = event.dataTransfer?.files?.[0];
    if (f) void take(f);
  }

  function inspectPasted() {
    fileName = '붙여넣은 글자';
    source = 'paste';
    readError = '';
    examine(pasted, fileName, 'paste');
  }

  function confirm() {
    if (!ok) return;
    const outcome = app.importData(ok.data, ok.exportedAt);
    if (outcome === 'failed') {
      app.toast(
        '지금 데이터를 되돌릴 수 있게 보관하지 못해 불러오지 않았어요. 먼저 설정에서 데이터를 내려받아 주세요.',
        'warn',
        'icon-warn',
        8000,
      );
      onclose();
      return;
    }
    if (outcome === 'imported') nav.go('home');
    app.toast(
      outcome === 'replaced'
        ? '데이터를 불러왔어요. 설정에서 이전 상태로 되돌릴 수 있어요.'
        : '데이터를 불러왔어요. 다시 만나서 반가워요!',
      'good',
      'icon-upload',
    );
    onclose();
  }

  function again() {
    result = null;
    readError = '';
    fileName = '';
    locked = null;
    password = '';
    lockError = null;
  }
</script>

<Modal title="데이터 불러오기" icon="icon-upload" {onclose}>
  {#if ok}
    <div class="stack wide">
      <p>이 파일을 불러올까요?</p>
      <dl class="well stack">
        <div class="kv">
          <dt>파일</dt>
          <dd>{fileName}</dd>
        </div>
        <div class="kv">
          <dt>닉네임</dt>
          <dd>{ok.data.profile.nickname}</dd>
        </div>
        <div class="kv">
          <dt>직급·호봉</dt>
          <dd>{ok.data.profile.rank}급 {ok.data.profile.step}호봉</dd>
        </div>
        <div class="kv">
          <dt>연가 기록</dt>
          <dd>{ok.data.leave.records.length}건</dd>
        </div>
        <div class="kv">
          <dt>배지</dt>
          <dd>{Object.keys(ok.data.achievements).length}개</dd>
        </div>
        {#if ok.exportedAt}
          <div class="kv">
            <dt>내보낸 때</dt>
            <dd>{formatInstant(ok.exportedAt)}</dd>
          </div>
        {/if}
      </dl>
      {#if ok.migrated}
        <p class="note">
          예전 형식(버전 {ok.fromVersion})의 파일이라 지금 형식으로 바꿔서 불러와요.
        </p>
      {/if}
      {#if hasExisting}
        <p class="note warn">
          지금 이 브라우저에 있는 데이터는 불러온 내용으로 바뀌어요. 바뀌기 직전 상태는 자동으로
          보관되니 설정에서 되돌릴 수 있어요.
        </p>
      {/if}
      <div class="btn-row end">
        <button type="button" class="btn" onclick={again}>다른 파일</button>
        <button type="button" class="btn primary" data-autofocus onclick={confirm}>
          {hasExisting ? '덮어쓰고 불러오기' : '불러오기'}
        </button>
      </div>
    </div>
  {:else if locked}
    <div class="stack wide" id="import-locked">
      <p class="locked-head">
        <Icon name="icon-lock" />
        <span>암호가 걸린 백업이에요. 내려받을 때 정한 암호를 넣어 주세요.</span>
      </p>
      <dl class="well stack">
        <div class="kv">
          <dt>파일</dt>
          <dd class="name">{locked.name}</dd>
        </div>
      </dl>
      <div class="field">
        <label for="import-pw">암호</label>
        <input
          bind:this={passwordEl}
          bind:value={password}
          id="import-pw"
          class="input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          autocapitalize="off"
          readonly={unlocking}
          aria-invalid={lockError === 'wrong-or-damaged' ? 'true' : undefined}
          aria-describedby={lockError ? 'import-lock-error' : undefined}
          data-autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.isComposing) {
              e.preventDefault();
              void unlock();
            }
          }}
        />
      </div>
      {#if unlocking}<p class="cap muted" role="status">암호를 확인하는 중이에요…</p>{/if}
      {#if lockError}
        <div class="note warn" role="alert" id="import-lock-error">
          <p>{lockMessage(lockError, locked.source)}</p>
          <p>지금 데이터는 그대로예요. 아무것도 바뀌지 않았어요.</p>
        </div>
      {/if}
      <p class="cap muted">암호는 저장하지 않아요. 잊었다면 호봉도 이 파일을 되살릴 수 없어요.</p>
      <div class="btn-row end">
        <button type="button" class="btn" onclick={again}>다른 파일</button>
        <button
          type="button"
          class="btn primary"
          onclick={() => void unlock()}
          disabled={password === '' || unlocking}
        >
          열기
        </button>
      </div>
    </div>
  {:else}
    <div class="stack wide">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="drop well"
        class:dragging
        ondragover={(e) => {
          e.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={onDrop}
      >
        <Icon name="icon-upload" scale={2} />
        <p>내려받아 둔 <span class="nowrap">hobong-backup-….json</span> 파일을 골라 주세요.</p>
        <button
          type="button"
          class="btn primary"
          data-autofocus
          onclick={() => inputEl?.click()}
          disabled={busy}
        >
          파일 고르기
        </button>
        <p class="cap muted fine-only">이 칸에 파일을 끌어다 놓아도 돼요.</p>
        <input
          bind:this={inputEl}
          type="file"
          accept=".json,application/json,text/plain"
          hidden
          onchange={onPick}
        />
      </div>

      {#if busy}<p class="cap muted" role="status">파일을 읽는 중…</p>{/if}

      {#if readError || (result && !result.ok)}
        <div class="note warn" role="alert">
          <p>{readError || (result && !result.ok ? result.reason : '')}</p>
          {#if result && !result.ok && result.details.length > 0}
            <ul class="details">
              {#each result.details.slice(0, 6) as detail, i (i)}
                <li>· {detail}</li>
              {/each}
            </ul>
          {/if}
          {#if result && !result.ok && !result.code}
            <p>
              {source === 'file'
                ? '내려받은 파일을 그대로 골랐는지 확인해 주세요.'
                : '백업 내용을 처음부터 끝까지 빠짐없이 붙여넣었는지 확인해 주세요.'}
            </p>
          {/if}
          <p>지금 데이터는 그대로예요. 아무것도 바뀌지 않았어요.</p>
        </div>
      {/if}

      <button
        type="button"
        class="btn small paste-toggle"
        aria-expanded={showPaste}
        onclick={() => (showPaste = !showPaste)}
      >
        <span aria-hidden="true">{showPaste ? '▼' : '▶'}</span>
        <span>파일을 고를 수 없나요? 글자로 붙여넣기</span>
      </button>
      {#if showPaste}
        <div class="stack">
          <label for="import-paste" class="cap muted">백업 내용을 통째로 붙여넣어 주세요.</label>
          <textarea
            id="import-paste"
            class="input"
            bind:value={pasted}
            spellcheck="false"
            autocomplete="off"
            placeholder={'{ "app": "hobong", ... }'}></textarea>
          <div class="btn-row end">
            <button
              type="button"
              class="btn"
              onclick={inspectPasted}
              disabled={pasted.trim() === ''}
            >
              확인하기
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</Modal>

<style>
  .drop {
    display: grid;
    justify-items: center;
    gap: 9px;
    text-align: center;
    padding: 18px 12px;
    outline: 3px dashed var(--ink-2);
    outline-offset: -6px;
  }
  .drop.dragging {
    outline-color: var(--accent);
    background: var(--panel);
  }
  .details {
    margin: 6px 0;
  }
  .locked-head {
    display: flex;
    gap: 9px;
    align-items: flex-start;
  }
  .name {
    overflow-wrap: anywhere;
  }
  /* 글자가 두 줄로 넘어가도 표시(▶/▼) 옆에 왼쪽 정렬로 붙는다 */
  .paste-toggle {
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    width: fit-content;
  }
  dl,
  dd,
  dt {
    margin: 0;
  }
</style>
