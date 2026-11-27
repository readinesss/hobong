<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    unit?: string;
    hint?: string;
    error?: string;
    onchange?: (value: number) => void;
    /** 설명에 더 이을 요소 id(빈칸으로 구분) */
    describedby?: string;
  }

  let {
    id,
    label,
    value = $bindable(1),
    min,
    max,
    unit = '',
    hint,
    error,
    onchange,
    describedby,
  }: Props = $props();

  function set(next: number) {
    const clamped = Math.min(max, Math.max(min, Math.round(next)));
    if (clamped !== value) {
      value = clamped;
      onchange?.(clamped);
    }
  }

  function onInput(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    const digits = el.value.replace(/\D/g, '').slice(0, 3);
    el.value = digits;
    if (digits !== '') set(Number(digits));
  }

  function onBlur(event: Event) {
    (event.currentTarget as HTMLInputElement).value = String(value);
  }

  /**
   * 칸에 들어서면 든 숫자를 모두 고른다. 기본값 '1'이 든 칸에 9를 치면 '19'가 되어 조용히 틀리던 것을 막는다.
   * 마우스로 눌러 들어온 때는 뒤따르는 mouseup 이 고른 것을 풀지 않게 한 번 막는다.
   */
  let justFocused = false;
  function selectAll(el: HTMLInputElement) {
    try {
      el.select();
      el.setSelectionRange(0, el.value.length);
    } catch {
      // 고르기를 지원하지 않는 환경에서는 그대로 둔다
    }
  }
  function onFocus(event: FocusEvent) {
    justFocused = true;
    selectAll(event.currentTarget as HTMLInputElement);
  }
  function onMouseUp(event: MouseEvent) {
    if (!justFocused) return;
    justFocused = false;
    event.preventDefault();
    selectAll(event.currentTarget as HTMLInputElement);
  }
</script>

<div class="field">
  <label for={id}>{label}</label>
  <div class="stepper">
    <button
      type="button"
      class="btn small"
      onclick={() => set(value - 1)}
      disabled={value <= min}
      aria-label="{label} 줄이기"
    >
      <Icon name="icon-minus" />
    </button>
    <input
      {id}
      class="input"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      value={String(value)}
      oninput={onInput}
      onblur={onBlur}
      onfocus={onFocus}
      onmouseup={onMouseUp}
      onkeydown={() => (justFocused = false)}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={[describedby ?? '', hint ? `${id}-hint` : '', error ? `${id}-error` : '']
        .filter(Boolean)
        .join(' ') || undefined}
    />
    {#if unit}<span class="unit">{unit}</span>{/if}
    <button
      type="button"
      class="btn small"
      onclick={() => set(value + 1)}
      disabled={value >= max}
      aria-label="{label} 늘리기"
    >
      <Icon name="icon-plus" />
    </button>
  </div>
  {#if hint}<span class="hint cap" id="{id}-hint">{hint}</span>{/if}
  <!-- 칸별 오류는 알림(role=alert)으로 읽지 않는다. 폼의 요약 하나만 알린다. -->
  {#if error}<span class="error cap" id="{id}-error">{error}</span>{/if}
</div>

<style>
  .stepper {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .stepper .input {
    width: 66px;
    text-align: center;
    flex: none;
  }
  .unit {
    margin-right: 6px;
    white-space: nowrap;
  }
</style>
