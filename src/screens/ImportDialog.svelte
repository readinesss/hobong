<script lang="ts">
  import { app } from '../lib/app/state.svelte.ts';
  import { readFileText } from '../lib/app/files.ts';
  import { formatInstant } from '../lib/app/format.ts';
  import { MAX_BACKUP_BYTES, type ParseResult } from '../lib/store/backup.ts';
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

  const hasExisting = $derived(app.data !== null);
  const ok = $derived(result && result.ok ? (result as Ok) : null);

  async function take(f: File) {
    busy = true;
    readError = '';
    result = null;
    fileName = f.name;
    try {
      result = app.inspect(await readFileText(f, MAX_BACKUP_BYTES));
    } catch (error) {
      readError = error instanceof Error ? error.message : '파일을 읽지 못했습니다.';
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
    readError = '';
    result = app.inspect(pasted);
  }

  function confirm() {
    if (!ok) return;
    app.importData(ok.data);
    app.toast(
      hasExisting ? '데이터를 불러왔어요. 설정에서 이전 상태로 되돌릴 수 있어요.' : '데이터를 불러왔어요. 다시 만나서 반가워요!',
      'good',
      'icon-upload',
    );
    onclose();
  }

  function again() {
    result = null;
    readError = '';
    fileName = '';
  }
</script>

<Modal title="데이터 불러오기" icon="icon-upload" {onclose}>
  {#if ok}
    <div class="stack wide">
      <p>이 파일을 불러올까요?</p>
      <dl class="well stack">
        <div class="kv"><dt>파일</dt><dd>{fileName}</dd></div>
        <div class="kv"><dt>닉네임</dt><dd>{ok.data.profile.nickname}</dd></div>
        <div class="kv"><dt>직급·호봉</dt><dd>{ok.data.profile.grade}급 {ok.data.profile.step}호봉</dd></div>
        <div class="kv"><dt>연가 기록</dt><dd>{ok.data.leave.records.length}건</dd></div>
        <div class="kv"><dt>업적</dt><dd>{Object.keys(ok.data.achievements).length}개</dd></div>
        {#if ok.exportedAt}
          <div class="kv"><dt>내보낸 때</dt><dd>{formatInstant(ok.exportedAt)}</dd></div>
        {/if}
      </dl>
      {#if ok.migrated}
        <p class="note">예전 형식(버전 {ok.fromVersion})의 파일이라 지금 형식으로 바꿔서 불러와요.</p>
      {/if}
      {#if hasExisting}
        <p class="note warn">
          지금 이 브라우저에 있는 데이터는 불러온 내용으로 바뀌어요. 바뀌기 직전 상태는 자동으로 보관되니 설정에서 되돌릴 수 있어요.
        </p>
      {/if}
      <div class="btn-row end">
        <button type="button" class="btn" onclick={again}>다른 파일</button>
        <button type="button" class="btn primary" data-autofocus onclick={confirm}>
          {hasExisting ? '덮어쓰고 불러오기' : '불러오기'}
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
        <button type="button" class="btn primary" data-autofocus onclick={() => inputEl?.click()} disabled={busy}>
          파일 고르기
        </button>
        <p class="cap muted">이 칸에 파일을 끌어다 놓아도 돼요.</p>
        <input bind:this={inputEl} type="file" accept=".json,application/json,text/plain" hidden onchange={onPick} />
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
          <p>지금 데이터는 그대로예요. 아무것도 바뀌지 않았어요.</p>
        </div>
      {/if}

      <button type="button" class="btn small paste-toggle" aria-expanded={showPaste} onclick={() => (showPaste = !showPaste)}>
        {showPaste ? '▼' : '▶'} 파일을 고를 수 없나요? 글자로 붙여넣기
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
            placeholder={'{ "app": "hobong", ... }'}
          ></textarea>
          <div class="btn-row end">
            <button type="button" class="btn" onclick={inspectPasted} disabled={pasted.trim() === ''}>확인하기</button>
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
  .paste-toggle {
    justify-content: flex-start;
    width: fit-content;
  }
  dl,
  dd,
  dt {
    margin: 0;
  }
</style>
