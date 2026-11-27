<script lang="ts">
  /**
   * 일반직 직렬 고르기(#16, 선택 사항). 직군별 묶음(optgroup)의 목록과 글자로 찾는 칸.
   * 고르지 않는 것이 기본이다. 목록에 없는 저장값(데이터가 바뀜)은 지우지 않고 '목록에 없음'으로 보여 둔다.
   */
  import { findSeries, seriesData } from '../../lib/character/series.ts';

  interface Props {
    value: string | null;
    onchange: (value: string | null) => void;
  }

  let { value, onchange }: Props = $props();

  let query = $state('');
  const needle = $derived(query.trim().replace(/\s+/g, ''));
  /** 저장값이 목록에 없으면(옛 이름·새 데이터) 그 값을 그대로 고른 채로 둔다 */
  const unknown = $derived(value !== null && findSeries(value) === null);
  /** 목록에 있는 고른 값의 원문 이름(옛 이름 aliases 로 저장돼 있어도 지금 이름으로 보인다) */
  const current = $derived(findSeries(value)?.entry.name ?? null);

  const groups = $derived(
    seriesData.groups
      .map((g) => ({
        name: g.name,
        series: g.series.filter(
          (s) =>
            needle === '' ||
            g.name.includes(needle) ||
            s.name.includes(needle) ||
            (s.aliases ?? []).some((a) => a.includes(needle)) ||
            // 고른 것은 찾는 글자와 맞지 않아도 목록에 남긴다(고른 값이 사라져 보이지 않게)
            s.name === current,
        ),
      }))
      .filter((g) => g.series.length > 0),
  );
  const found = $derived(
    needle === ''
      ? 0
      : seriesData.groups.reduce(
          (n, g) =>
            n +
            g.series.filter(
              (s) =>
                g.name.includes(needle) ||
                s.name.includes(needle) ||
                (s.aliases ?? []).some((a) => a.includes(needle)),
            ).length,
          0,
        ),
  );
  const onlyMatch = $derived.by(() => {
    if (needle === '') return null;
    const all = seriesData.groups.flatMap((g) =>
      g.series.filter((s) => g.name.includes(needle) || s.name.includes(needle)),
    );
    return all.length === 1 ? (all[0]?.name ?? null) : null;
  });

  let select = $state<HTMLSelectElement>();

  function onFindKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    // 찾는 칸에서 Enter 를 눌러도 폼이 저장되지 않게 한다. 하나만 찾았으면 그것을 고른다
    event.preventDefault();
    if (onlyMatch && onlyMatch !== value) onchange(onlyMatch);
    select?.focus();
  }
</script>

<div class="field series" id="pf-series-field">
  <label for="pf-series">직렬</label>
  <div class="find">
    <input
      id="pf-series-find"
      class="input"
      type="search"
      enterkeyhint="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="글자로 찾기 (예: 간호)"
      aria-label="직렬 찾기"
      aria-describedby="pf-series-found"
      aria-controls="pf-series"
      bind:value={query}
      onkeydown={onFindKey}
    />
  </div>
  <p class="cap muted" id="pf-series-found" role="status">
    {needle === ''
      ? ''
      : found === 0
        ? '맞는 직렬이 없어요. 다른 글자로 찾아 주세요.'
        : `${found}개 찾았어요. 아래 목록에서 골라 주세요.`}
  </p>
  <select
    bind:this={select}
    id="pf-series"
    class="input"
    value={unknown ? (value ?? '') : (current ?? '')}
    aria-describedby="pf-series-hint"
    onchange={(e) => {
      const next = e.currentTarget.value;
      onchange(next === '' ? null : next);
    }}
  >
    <option value="">고르지 않음</option>
    {#each groups as group (group.name)}
      <optgroup label="{group.name} 직군">
        {#each group.series as s (s.name)}
          <option value={s.name}>{s.name}</option>
        {/each}
      </optgroup>
    {/each}
    {#if unknown && value !== null}
      <option {value}>{value} (목록에 없는 저장값)</option>
    {/if}
  </select>
  <span class="hint cap stack" id="pf-series-hint">
    <span> 선택 사항이에요. 고르면 호봉이가 어울리는 소품을 들어요. 계산에는 쓰지 않아요. </span>
    <span>
      직렬은 이 브라우저에만 저장해요(내려받은 백업 파일에는 들어가요). 홈에 보일지는 설정 '내
      정보'에서, 카드에 넣을지는 카드 화면에서 정해요(카드는 기본으로 넣지 않아요).
    </span>
    <span>직렬 이름을 숨겨도 호봉이가 들고 있는 소품으로 직렬이 짐작될 수 있어요.</span>
    {#if unknown}
      <span>저장된 직렬이 지금 목록에 없어 소품과 이름을 보이지 않아요. 그대로 두어도 돼요.</span>
    {/if}
  </span>
</div>

<style>
  .find {
    display: flex;
    gap: 6px;
  }
  .find .input {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
