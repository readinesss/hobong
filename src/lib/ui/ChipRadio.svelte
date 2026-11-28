<script lang="ts" generics="T extends string | number">
  /**
   * 칩 모양의 라디오 묶음(월급날·밝기·카드 모양).
   * 라디오 묶음의 키보드 관례를 따른다: 묶음 전체가 Tab 정지점 하나이고(고른 칩),
   * ←/→/↑/↓ 로 옮기며 바로 고르고, Home/End 로 처음·끝을 고른다.
   */
  interface Option {
    value: T;
    label: string;
    /** 지금은 고를 수 없다(aria-disabled. 화살표 키로 옮길 때 건너뛴다) */
    disabled?: boolean;
  }

  interface Props {
    options: readonly Option[];
    value: T;
    onchange: (value: T) => void;
    /** 묶음 이름(보이는 제목이 있으면 labelledby 를 쓴다) */
    label?: string;
    labelledby?: string;
    /** 묶음의 설명으로 이을 요소 id(빈칸으로 구분) */
    describedby?: string;
  }

  let { options, value, onchange, label, labelledby, describedby }: Props = $props();

  let group = $state<HTMLDivElement>();
  const checkedIndex = $derived(options.findIndex((o) => o.value === value));

  function choose(index: number, step = 1) {
    const count = options.length;
    if (count === 0) return;
    let next = ((index % count) + count) % count;
    // 고를 수 없는 칩은 건너뛴다(모두 고를 수 없으면 그대로 둔다)
    for (let i = 0; i < count && options[next]?.disabled; i += 1)
      next = (((next + step) % count) + count) % count;
    const option = options[next] as Option;
    if (option.disabled) return;
    if (option.value !== value) onchange(option.value);
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }

  function onkeydown(event: KeyboardEvent, index: number) {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [index + 1, 1],
      ArrowDown: [index + 1, 1],
      ArrowLeft: [index - 1, -1],
      ArrowUp: [index - 1, -1],
      Home: [0, 1],
      End: [options.length - 1, -1],
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next[0], next[1]);
  }
</script>

<div
  bind:this={group}
  class="chips"
  role="radiogroup"
  aria-label={labelledby ? undefined : label}
  aria-labelledby={labelledby}
  aria-describedby={describedby}
>
  {#each options as option, i (option.value)}
    <button
      type="button"
      class="chip"
      role="radio"
      aria-checked={option.value === value}
      aria-disabled={option.disabled ? 'true' : undefined}
      tabindex={i === (checkedIndex >= 0 ? checkedIndex : 0) ? 0 : -1}
      onclick={() => {
        if (!option.disabled) onchange(option.value);
      }}
      onkeydown={(e) => onkeydown(e, i)}
    >
      {option.label}
    </button>
  {/each}
</div>
