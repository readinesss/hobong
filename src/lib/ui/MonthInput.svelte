<script lang="ts">
  /**
   * 연·월 입력(두 칸). DateInput 의 연·월판이다: 숫자 칸 둘, 묶음 이름표, 도움말·오류를 aria-describedby 로 잇는다.
   * 값은 'YYYY-MM' 이고, 덜 채웠거나 없는 달(13월)이면 '' 이다. 달력에서 고르는 버튼은 두지 않는다
   * (type="month" 를 지원하지 않는 브라우저가 있어 두 칸만으로 다 되게 한다).
   */
  interface Props {
    id: string;
    label: string;
    /** 'YYYY-MM' 또는 아직 완성되지 않았으면 '' */
    value: string;
    onchange?: (value: string) => void;
    hint?: string;
    error?: string;
    /** 빈 칸에 흐리게 보일 보기(연도·월). 값으로 치지 않는다 */
    yearPlaceholder?: string;
    monthPlaceholder?: string;
    /**
     * 설명에 더 이을 요소 id(빈칸으로 구분). 주면 설명 전체(이 글 + 도움말 + 오류)를 묶음이 아니라 **연도 칸**에 단다 —
     * 포커스가 연도 칸으로 가는 화면에서 VoiceOver·TalkBack 은 묶음의 설명을 읽지 않는다(DateInput 과 같다).
     */
    describedby?: string;
  }

  let {
    id,
    label,
    value = $bindable(''),
    onchange,
    hint,
    error,
    yearPlaceholder = '연도',
    monthPlaceholder = '월',
    describedby,
  }: Props = $props();

  let year = $state('');
  let month = $state('');
  let yearEl = $state<HTMLInputElement>();
  let monthEl = $state<HTMLInputElement>();

  let rootEl = $state<HTMLDivElement>();

  /** 연도 칸으로 포커스를 옮긴다(폼을 열 때) */
  export function focus(): void {
    yearEl?.focus();
  }

  /**
   * 이름표·두 칸·오류 글이 함께 보이게 화면을 맞춘다. 휴대폰에서 화면 키보드가 올라오면 보이는 높이가 절반쯤
   * 되는데, 포커스만으로는 칸 아래의 오류 글이 가려질 수 있다. 이미 다 보이면 움직이지 않는다.
   */
  export function reveal(): void {
    rootEl?.scrollIntoView({ block: 'nearest' });
  }

  function compose(y: string, m: string): string {
    if (y.length !== 4 || m === '') return '';
    const yy = Number(y);
    const mm = Number(m);
    if (!(mm >= 1 && mm <= 12) || !(yy >= 1900 && yy <= 2200)) return '';
    return `${y}-${String(mm).padStart(2, '0')}`;
  }

  // 바깥에서 값이 바뀌면 두 칸에 반영한다(안에서 치는 중인 값과 같으면 그대로 둔다).
  $effect(() => {
    const current = compose(year, month);
    if (value !== current) {
      const parts = /^(\d{4})-(\d{2})$/.exec(value);
      if (parts) {
        year = parts[1] as string;
        month = String(Number(parts[2]));
      } else if (value === '' && current !== '') {
        year = '';
        month = '';
      }
    }
  });

  function emit() {
    const next = compose(year, month);
    if (next !== value) {
      value = next;
      onchange?.(next);
    }
  }

  function digits(text: string, max: number): string {
    return text.replace(/\D/g, '').slice(0, max);
  }

  /** '2030-03', '203003', '2030.3', '2030년 3월' 같은 글자를 한 번에 채운다 */
  function fillFrom(text: string): boolean {
    const compact = /^\s*(\d{4})(\d{2})\s*$/.exec(text);
    const parts = compact ?? /^\s*(\d{4})\D+(\d{1,2})\D*$/.exec(text);
    if (!parts) return false;
    year = parts[1] as string;
    month = String(Number(parts[2]));
    emit();
    return true;
  }

  function onPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text') ?? '';
    if (fillFrom(text)) {
      event.preventDefault();
      monthEl?.focus();
    }
  }

  function onYear(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    if (el.value.replace(/\D/g, '').length === 6 && fillFrom(el.value)) return;
    year = digits(el.value, 4);
    el.value = year;
    emit();
    if (year.length === 4) monthEl?.focus();
  }

  function onMonth(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    month = digits(el.value, 2);
    el.value = month;
    emit();
  }

  function onBackspace(event: KeyboardEvent) {
    if (event.key === 'Backspace' && month === '') {
      event.preventDefault();
      yearEl?.focus();
    }
  }

  const describedBy = $derived(
    [describedby ?? '', hint ? `${id}-hint` : '', error ? `${id}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined,
  );
</script>

<div class="field" bind:this={rootEl}>
  <span class="label" id="{id}-label">{label}</span>
  <div
    class="month"
    role="group"
    aria-labelledby="{id}-label"
    aria-describedby={describedby ? undefined : describedBy}
  >
    <input
      bind:this={yearEl}
      {id}
      class="input y"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder={yearPlaceholder}
      maxlength="10"
      aria-label="{label} 연도"
      aria-describedby={describedby ? describedBy : undefined}
      aria-invalid={error ? 'true' : undefined}
      value={year}
      oninput={onYear}
      onpaste={onPaste}
    />
    <span class="unit" aria-hidden="true">년</span>
    <input
      bind:this={monthEl}
      id="{id}-m"
      class="input m"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder={monthPlaceholder}
      maxlength="2"
      aria-label="{label} 월"
      aria-invalid={error ? 'true' : undefined}
      value={month}
      oninput={onMonth}
      onpaste={onPaste}
      onkeydown={onBackspace}
    />
    <span class="unit" aria-hidden="true">월</span>
  </div>
  {#if hint}<span class="hint cap" id="{id}-hint">{hint}</span>{/if}
  <!-- 오류는 알림(role=alert)으로 읽지 않는다. 폼이 한 번만 알린다. -->
  {#if error}<span class="error cap" id="{id}-error">{error}</span>{/if}
</div>

<style>
  .month {
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    min-width: 0;
  }
  .month .input {
    width: auto;
    min-width: 0;
    text-align: center;
    padding-left: 3px;
    padding-right: 3px;
  }
  /* 좁은 칸에서도 줄 전체가 칸 밖으로 나가지 않게 줄어든다 */
  .month .y {
    flex: 4 1 0;
    min-width: 54px;
    max-width: 96px;
  }
  .month .m {
    flex: 2 1 0;
    min-width: 44px;
    max-width: 60px;
  }
  .unit {
    flex: none;
    margin-right: 6px;
  }
</style>
