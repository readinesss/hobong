<script lang="ts">
  /**
   * 직렬 고르기(#16, 선택 사항). 직군별 묶음(optgroup)의 목록과 글자로 찾는 칸(#31: 직류 이름으로도 찾고 직류까지 고른다).
   * - 어느 직렬 표인지(scope)는 직종 데이터의 seriesScope 가 정한다(일반직 국가 표, 지방 일반직 지방 표).
   * - 고르지 않는 것이 기본이다. 목록에 없는 저장값(데이터가 바뀜·다른 표의 이름)은 지우지 않고 '목록에 없음'으로 보여 둔다.
   * - 다른 표에만 있는 이름은 고를 수 없고, 안내 상자에 그 직종을 고르면 무엇이 달라지는지 한 줄로 보인다.
   *   직종을 저절로 바꾸지 않는다([직종 고르기로 가기]는 직종 칸으로 옮겨 줄 뿐이다).
   * 자리(위에서부터): 찾는 칸 → 상태 줄(role=status, 짧게 — 수만) → 다른 표 안내 상자(라이브 영역 아님) → 목록.
   */
  import { josa, withRo } from '../../lib/app/format.ts';
  import { otherTableNote } from '../../lib/app/track.ts';
  import type { CareerRules } from '../../lib/rules/career.ts';
  import type { Rules } from '../../lib/rules/types.ts';
  import {
    counterpartOf,
    groupsOf,
    hitText,
    jikryuOf,
    otherScope,
    searchSeries,
    seriesByKey,
    seriesNeedle,
    seriesText,
    SERIES_TABLE_NAME,
    type SeriesScope,
  } from '../../lib/character/series.ts';

  interface Props {
    /** 저장된 직렬 키 */
    value: string | null;
    /** 저장된 직류(직렬과 짝이 맞을 때만 보인다) */
    jikryu: string | null;
    /** 지금 직종의 직렬 표 */
    scope: SeriesScope;
    /** 직렬과 직류를 함께 넘긴다. 직렬만 고르면 jikryu 는 null */
    onchange: (series: string | null, jikryu: string | null) => void;
    /** 다른 표 안내 상자의 차이 줄을 만들 규정(그해 규정과 지금 직종의 해석 결과) */
    rules: Rules;
    career: CareerRules;
    /** [직종 고르기로 가기]: 직종 칸(또는 직종 질문)으로 옮긴다. 주지 않으면 단추를 보이지 않는다 */
    ongotrack?: () => void;
    /** id 앞머리. 한 화면에 둘이 있어도(첫 입력의 대화와 폼) id 가 겹치지 않게 */
    idPrefix?: string;
    /** 찾는 칸의 설명에 더 이을 요소 id(빈칸으로 구분). 말을 거는 첫 입력의 맞장구·알 상태 */
    describedby?: string;
    /**
     * 말을 거는 첫 입력: 도움말을 이 한 줄로 줄이고 나머지(어디에 저장하고 어디에 보이는지)는 [자세히]에 접는다.
     * 주지 않으면 도움말을 모두 펼쳐 보인다(한 번에 쓰기·설정).
     */
    brief?: string;
    /**
     * 찾는 글자(바깥이 쥐면 이 칸이 사라졌다 다시 나와도 남는다 — 첫 입력의 대화에서 직종 질문에 다녀올 때).
     * 주지 않으면 이 칸 안에서만 둔다
     */
    query?: string;
  }

  let {
    value,
    jikryu,
    scope,
    onchange,
    rules,
    career,
    ongotrack,
    idPrefix = 'pf',
    describedby,
    brief,
    query = $bindable(''),
  }: Props = $props();
  let more = $state(false);

  /** 고른 뒤 한 번 읽을 말(찾는 글자가 바뀌면 지운다) */
  let picked = $state('');
  const needle = $derived(seriesNeedle(query));
  /** 저장값이 지금 표에 없으면(옛 이름·새 데이터·다른 표의 이름) 그 값을 그대로 고른 채로 둔다 */
  const unknown = $derived(value !== null && seriesByKey(value, scope) === null);
  /** 지금 표에 있는 고른 값의 원문 이름(옛 이름 aliases 로 저장돼 있어도 지금 이름으로 보인다) */
  const current = $derived(seriesByKey(value, scope)?.entry.name ?? null);
  /** 고른 직류(그 직렬의 직류일 때만) */
  const currentJikryu = $derived(jikryuOf(value, jikryu, scope));

  /** 목록 항목의 값: 직렬은 이름 그대로, 직류는 '직렬|직류'('|'는 저장 키 형식에 들 수 없어 섞이지 않는다) */
  const SEP = '|';
  const optionValue = (series: string, j: string | null) => (j ? `${series}${SEP}${j}` : series);
  const selectedValue = $derived(
    unknown ? (value ?? '') : current ? optionValue(current, currentJikryu) : '',
  );

  const hits = $derived(searchSeries(query, scope, { other: true }));
  const mine = $derived(hits.filter((h) => h.scope === scope));
  const other = $derived(hits.filter((h) => h.scope !== scope));
  /** 다른 표 안내(그 표를 쓰는 직종이 데이터에 없으면 null) */
  const note = $derived(other.length > 0 ? otherTableNote(rules, career, scope, other) : null);

  interface Item {
    key: string;
    label: string;
  }
  /** 목록: 빈 찾기면 직군별 전체 직렬, 찾으면 맞은 직렬·직류(원문 표 순서). 고른 값은 맞지 않아도 남긴다 */
  const groups = $derived(
    groupsOf(scope)
      .map((g) => {
        const items: Item[] = [];
        for (const s of g.series) {
          if (needle === '') {
            items.push({ key: s.name, label: s.name });
            if (s.name === current && currentJikryu)
              items.push({
                key: optionValue(s.name, currentJikryu),
                label: seriesText(s.name, currentJikryu),
              });
            continue;
          }
          const hit = mine.find((h) => h.group === g.name && h.series === s.name);
          const hitKey = hit ? optionValue(s.name, hit.by === 'jikryu' ? hit.jikryu : null) : null;
          if (s.name === current) {
            const keep = optionValue(s.name, currentJikryu);
            if (keep !== hitKey)
              items.push({ key: keep, label: seriesText(s.name, currentJikryu) });
          }
          if (hit && hitKey) items.push({ key: hitKey, label: hitText(hit) });
        }
        return { key: `${g.scope}:${g.name}`, name: g.name, items };
      })
      .filter((g) => g.items.length > 0),
  );
  /** Enter 로 고를 것: 지금 표에서 정확히 하나만 맞을 때만(다른 표의 결과는 세지 않는다) */
  const onlyMatch = $derived(mine.length === 1 ? mine[0] : undefined);

  const otherTable = $derived(SERIES_TABLE_NAME[otherScope(scope)]);
  const statusText = $derived.by(() => {
    if (picked) return picked;
    if (needle === '') return '';
    const tail =
      other.length > 0
        ? ` ${otherTable}${mine.length > 0 ? '에도' : '에는'} ${other.length}개 있어요.`
        : '';
    if (mine.length > 0) return `${mine.length}개 찾았어요. 아래 목록에서 골라 주세요.${tail}`;
    // 다른 표에만 있으면 다시 찾으라고 하지 않는다(아래 안내 상자가 답이다)
    return other.length > 0
      ? `${SERIES_TABLE_NAME[scope]}에는 없어요. ${otherTable}에 ${other.length}개 있어요.`
      : '맞는 직렬·직류가 없어요. 다른 글자로 찾아 주세요.';
  });
  /**
   * 직종을 바꿔 직렬 표가 달라졌을 때 저장값이 이 표에서는 다른 모양으로 있으면(국가 '행정 · 교육행정 직류' ↔ 지방
   * '교육행정' 직렬) 한 줄로 알리고 고르기 단추를 둔다. 저절로 바꾸지 않는다(저장값은 고를 때까지 그대로)
   */
  const counterpart = $derived(counterpartOf(value, jikryu, scope));
  const counterpartText = $derived.by(() => {
    if (!counterpart || value === null) return '';
    const table = SERIES_TABLE_NAME[scope];
    return counterpart.jikryu
      ? `${table}에서는 ${josa(value, '이', '가')} ${counterpart.series} 직렬의 직류예요.`
      : `${table}에는 ${counterpart.series} 직렬이 따로 있어요.`;
  });

  let select = $state<HTMLSelectElement>();

  function choose(series: string | null, j: string | null) {
    onchange(series, j);
    picked = series
      ? `${josa(seriesText(series, j), '을', '를')} 골랐어요.`
      : '직렬을 고르지 않았어요.';
  }

  function onFindKey(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    // 찾는 칸에서 Enter 를 눌러도 폼이 저장되지 않게 한다. 하나만 찾았으면 그것을 고른다
    event.preventDefault();
    const hit = onlyMatch;
    if (hit) {
      const j = hit.by === 'jikryu' ? hit.jikryu : null;
      if (hit.series !== value || j !== currentJikryu) {
        choose(hit.series, j);
      }
    }
    select?.focus();
  }
</script>

<div class="field series" id="{idPrefix}-series-field">
  <label for="{idPrefix}-series">직렬</label>
  <div class="find">
    <input
      id="{idPrefix}-series-find"
      class="input"
      type="search"
      enterkeyhint="search"
      autocomplete="off"
      spellcheck="false"
      placeholder="글자로 찾기 (예: 간호, 교육행정)"
      aria-label="직렬·직류 찾기"
      aria-describedby="{describedby ? `${describedby} ` : ''}{idPrefix}-series-found{note
        ? ` ${idPrefix}-series-other`
        : ''}"
      aria-controls="{idPrefix}-series"
      bind:value={query}
      oninput={() => (picked = '')}
      onkeydown={onFindKey}
    />
  </div>
  <p class="cap muted" id="{idPrefix}-series-found" role="status">{statusText}</p>
  {#if note}
    <div class="cap note stack other" id="{idPrefix}-series-other">
      <strong>{note.title}</strong>
      <span>{note.who}</span>
      {#if note.diff}<span>{note.diff}</span>{/if}
      {#if ongotrack}
        <div class="btn-row">
          <button type="button" class="btn small" onclick={() => ongotrack?.()}>
            직종 고르기로 가기
          </button>
        </div>
      {/if}
    </div>
  {/if}
  <select
    bind:this={select}
    id="{idPrefix}-series"
    class="input"
    value={selectedValue}
    aria-describedby="{idPrefix}-series-hint{counterpart ? ` ${idPrefix}-series-counterpart` : ''}"
    onchange={(e) => {
      const next = e.currentTarget.value;
      if (next === '') return choose(null, null);
      const [series = next, j = null] = next.split(SEP);
      choose(series, j);
    }}
  >
    <option value="">고르지 않음</option>
    {#each groups as group (group.key)}
      <optgroup label="{group.name} 직군">
        {#each group.items as item (item.key)}
          <option value={item.key}>{item.label}</option>
        {/each}
      </optgroup>
    {/each}
    {#if unknown && value !== null}
      <option {value}>{value} (목록에 없는 저장값)</option>
    {/if}
  </select>
  {#if counterpart}
    <div class="cap note stack" id="{idPrefix}-series-counterpart">
      <span>{counterpartText}</span>
      <div class="btn-row">
        <button
          type="button"
          class="btn small"
          onclick={() => counterpart && choose(counterpart.series, counterpart.jikryu)}
        >
          {withRo(
            counterpart.jikryu
              ? seriesText(counterpart.series, counterpart.jikryu)
              : `${counterpart.series} 직렬`,
          )} 고르기
        </button>
      </div>
    </div>
  {/if}
  {#snippet privacy()}
    <span>
      직렬은 이 브라우저에만 저장해요(내려받은 임용정보 패키지에는 들어가요). 홈에 보일지는 설정 '내
      정보'에서, 카드에 넣을지는 카드 화면에서 정해요(카드는 기본으로 넣지 않아요).
    </span>
    <span>
      직류 이름(예: 교육행정·회계)으로 찾아 직류까지 고를 수 있어요. 직류도 이 브라우저에만 저장하고
      카드·공유에는 넣지 않아요.
    </span>
    <span>직렬 이름을 숨겨도 호봉이가 들고 있는 소품으로 직렬이 짐작될 수 있어요.</span>
  {/snippet}
  <span class="hint cap stack" id="{idPrefix}-series-hint">
    {#if brief}
      <span>{brief}</span>
    {:else}
      <span> 선택 사항이에요. 고르면 호봉이가 어울리는 소품을 들어요. 계산에는 쓰지 않아요. </span>
      {@render privacy()}
    {/if}
    {#if unknown}
      <span>
        저장된 직렬이 지금 직종의 목록에 없어 소품과 이름을 보이지 않아요. 그대로 두어도 돼요.
      </span>
    {/if}
  </span>
  {#if brief}
    <button
      type="button"
      class="btn ghost small more"
      aria-expanded={more}
      aria-controls="{idPrefix}-series-more"
      onclick={() => (more = !more)}
    >
      <span aria-hidden="true">{more ? '▼' : '▶'}</span>
      <span>자세히</span>
    </button>
    {#if more}
      <span class="hint cap stack" id="{idPrefix}-series-more">{@render privacy()}</span>
    {/if}
  {/if}
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
  .more {
    justify-content: flex-start;
    width: fit-content;
  }
  .other {
    overflow-wrap: anywhere;
  }
</style>
