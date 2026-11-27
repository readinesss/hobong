<script lang="ts">
  import { daysInMonth, formatYmd, isValidYmd, parseYmd, type Ymd } from '../calc/date.ts';
  import Icon from './Icon.svelte';

  interface Props {
    id: string;
    label: string;
    /** 'YYYY-MM-DD' 또는 아직 완성되지 않았으면 '' */
    value: Ymd | '';
    onchange?: (value: Ymd | '') => void;
    hint?: string;
    error?: string;
    min?: Ymd;
    max?: Ymd;
    required?: boolean;
    /**
     * 세 칸이 다 찼는데 없는 날짜(2월 30일, 13월 등)일 때의 안내. 바깥 폼이 오류 개수에 세도록 묶어 쓴다.
     * 비어 있거나 덜 채운 상태는 '' 이다(그때는 바깥의 "넣어 주세요" 안내가 맡는다).
     */
    problem?: string;
    /** 묶음의 이름을 다른 요소(말풍선의 질문 문장)로 바꾼다. 세 칸의 이름('… 연도')은 label 그대로 */
    labelledby?: string;
    /**
     * 설명에 더 이을 요소 id(빈칸으로 구분). 맞장구·알 상태처럼 칸 밖에 있는 글.
     * 주면 설명 전체(이 글 + 도움말 + 오류)를 묶음이 아니라 **연도 칸**에 단다: 포커스가 연도 칸으로 가는 화면
     * (말을 거는 첫 입력)에서 VoiceOver·TalkBack 은 묶음의 설명을 읽지 않는다. 묶음과 칸에 함께 달면 두 번 읽힌다.
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
    min,
    max,
    required = false,
    problem = $bindable(''),
    labelledby,
    describedby,
  }: Props = $props();

  let year = $state('');
  let month = $state('');
  let day = $state('');
  let yearEl = $state<HTMLInputElement>();
  let monthEl = $state<HTMLInputElement>();
  let dayEl = $state<HTMLInputElement>();
  let nativeEl = $state<HTMLInputElement>();

  const canPick =
    typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype;

  // 바깥에서 값이 바뀌면 세 칸에 반영한다(안에서 치는 중인 값과 같으면 그대로 둔다).
  $effect(() => {
    const current = compose(year, month, day);
    if (value !== current) {
      if (value && isValidYmd(value)) {
        const p = parseYmd(value);
        year = String(p.y);
        month = String(p.m);
        day = String(p.d);
      } else if (value === '' && current !== '') {
        year = '';
        month = '';
        day = '';
      }
    }
  });

  function compose(y: string, m: string, d: string): Ymd | '' {
    if (y.length !== 4 || m === '' || d === '') return '';
    const yy = Number(y);
    const mm = Number(m);
    const dd = Number(d);
    if (
      !(mm >= 1 && mm <= 12) ||
      !(yy >= 1900 && yy <= 2200) ||
      !(dd >= 1 && dd <= daysInMonth(yy, mm))
    )
      return '';
    return formatYmd({ y: yy, m: mm, d: dd });
  }

  /** 세 칸이 다 찼는데 날짜가 되지 않는 까닭 */
  function explain(y: string, m: string, d: string): string {
    if (y.length !== 4 || m === '' || d === '') return '';
    const yy = Number(y);
    const mm = Number(m);
    const dd = Number(d);
    if (!(yy >= 1900 && yy <= 2200)) return '연도를 확인해 주세요.';
    if (!(mm >= 1 && mm <= 12)) return '월은 1~12로 넣어 주세요.';
    const last = daysInMonth(yy, mm);
    if (!(dd >= 1 && dd <= last)) return `없는 날짜예요. ${yy}년 ${mm}월은 ${last}일까지예요.`;
    return '';
  }

  $effect(() => {
    const next = explain(year, month, day);
    if (next !== problem) problem = next;
  });

  /** 칸 아래에 보일 안내: 없는 날짜가 바깥의 "넣어 주세요"보다 먼저다 */
  const message = $derived(problem || error || '');

  function emit() {
    const next = compose(year, month, day);
    if (next !== value) {
      value = next;
      onchange?.(next);
    }
  }

  function digits(text: string, max: number): string {
    return text.replace(/\D/g, '').slice(0, max);
  }

  /** '1995-05-20', '19950520', '1995.5.20' 같은 글자를 한 번에 채운다 */
  function fillFrom(text: string): boolean {
    const compact = /^\s*(\d{4})(\d{2})(\d{2})\s*$/.exec(text);
    const parts = compact ?? /^\s*(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/.exec(text);
    if (!parts) return false;
    year = parts[1] as string;
    month = String(Number(parts[2]));
    day = String(Number(parts[3]));
    emit();
    return true;
  }

  function onPaste(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text') ?? '';
    if (fillFrom(text)) {
      event.preventDefault();
      dayEl?.focus();
    }
  }

  function onYear(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    if (el.value.replace(/\D/g, '').length === 8 && fillFrom(el.value)) return;
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
    if (month.length === 2 || Number(month) > 1) dayEl?.focus();
  }

  function onDay(event: Event) {
    const el = event.currentTarget as HTMLInputElement;
    day = digits(el.value, 2);
    el.value = day;
    emit();
  }

  function onBackspace(event: KeyboardEvent, current: string, prev?: HTMLInputElement) {
    if (event.key === 'Backspace' && current === '' && prev) {
      event.preventDefault();
      prev.focus();
    }
  }

  function openPicker() {
    try {
      if (nativeEl) {
        nativeEl.value = value || '';
        nativeEl.showPicker();
      }
    } catch {
      yearEl?.focus();
    }
  }

  function onNative(event: Event) {
    const v = (event.currentTarget as HTMLInputElement).value;
    if (isValidYmd(v)) fillFrom(v);
  }

  const describedBy = $derived(
    [describedby ?? '', hint ? `${id}-hint` : '', message ? `${id}-error` : '']
      .filter(Boolean)
      .join(' ') || undefined,
  );
</script>

<div class="field">
  <span class="label" id="{id}-label">
    {label}
    {#if required}<span class="cap muted">필수</span>{/if}
  </span>
  <div
    class="date"
    role="group"
    aria-labelledby={labelledby ?? `${id}-label`}
    aria-describedby={describedby ? undefined : describedBy}
  >
    <input
      bind:this={yearEl}
      {id}
      class="input y"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="연도"
      maxlength="10"
      aria-label="{label} 연도"
      aria-describedby={describedby ? describedBy : undefined}
      aria-invalid={message ? 'true' : undefined}
      aria-required={required ? 'true' : undefined}
      value={year}
      oninput={onYear}
      onpaste={onPaste}
    />
    <span aria-hidden="true">.</span>
    <input
      bind:this={monthEl}
      class="input md"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="월"
      maxlength="2"
      aria-label="{label} 월"
      aria-invalid={message ? 'true' : undefined}
      aria-required={required ? 'true' : undefined}
      value={month}
      oninput={onMonth}
      onpaste={onPaste}
      onkeydown={(e) => onBackspace(e, month, yearEl)}
    />
    <span aria-hidden="true">.</span>
    <input
      bind:this={dayEl}
      class="input md"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      placeholder="일"
      maxlength="2"
      aria-label="{label} 일"
      aria-invalid={message ? 'true' : undefined}
      aria-required={required ? 'true' : undefined}
      value={day}
      oninput={onDay}
      onpaste={onPaste}
      onkeydown={(e) => onBackspace(e, day, monthEl)}
    />
    {#if canPick}
      <button
        type="button"
        class="btn small pick"
        onclick={openPicker}
        aria-label="{label} 달력에서 고르기"
      >
        <Icon name="icon-calendar" />
      </button>
      <input
        bind:this={nativeEl}
        class="native"
        type="date"
        tabindex="-1"
        aria-hidden="true"
        {min}
        {max}
        onchange={onNative}
      />
    {/if}
  </div>
  {#if hint}<span class="hint cap" id="{id}-hint">{hint}</span>{/if}
  <!-- 칸별 오류는 알림(role=alert)으로 읽지 않는다. 폼의 요약 하나만 알린다. -->
  {#if message}<span class="error cap" id="{id}-error">{message}</span>{/if}
</div>

<style>
  .date {
    position: relative;
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%;
    min-width: 0;
  }
  .date .input {
    width: auto;
    min-width: 0;
    text-align: center;
    padding-left: 3px;
    padding-right: 3px;
  }
  /* 좁은 칸(320px 폭의 예외 칸 안)에서도 줄 전체가 칸 밖으로 나가지 않게 줄어든다 */
  .date .y {
    flex: 4 1 0;
    min-width: 54px;
    max-width: 96px;
  }
  .date .md {
    flex: 2 1 0;
    min-width: 44px;
    max-width: 60px;
  }
  .pick {
    flex: none;
    margin-left: 3px;
  }
  /* 달력만 띄우는 용도의 보이지 않는 입력란 */
  .native {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
    border: 0;
    padding: 0;
  }
</style>
