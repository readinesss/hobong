<script lang="ts">
  /**
   * 근거 법령. 이 사람의 직종에서 쓰는 근거(CareerRules.sources)를 항목별로 묶고, 계산하지 않는 항목은
   * '준비 중'·'해당 없음'·'다른 기준'과 사유를 그 자리에 적는다. 직종과 무관한 공통 규정(월급날·근무시간·
   * 공휴일·연가 단위·정액급식비·봉급 계산)은 아래에 따로 둔다. 직종이 공통 규정과 다른 근거를 두면(지방 일반직의 월급날·
   * 근무시간·연가 단위·정액급식비·봉급 계산) 그 근거를 직종 칸에 보이고 공통 칸에서는 뺀다.
   */
  import { view } from '../../lib/app/view.svelte.ts';
  import {
    FEATURE_LABEL,
    featureValue,
    OFF_STATUS_LABEL,
    trackNameOf,
  } from '../../lib/app/track.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import type { CareerRules } from '../../lib/rules/career.ts';
  import {
    FEATURE_KEYS,
    isAvailable,
    type FeatureKey,
    type RuleSectionKey,
    type SourceRef,
    type Unavailable,
  } from '../../lib/rules/types.ts';

  /** 구역 이름(열세 구역) */
  const SECTION_LABELS: Record<RuleSectionKey, string> = {
    retirement: '정년',
    probation: '시보',
    salary: '봉급표',
    stepRaise: '정기승급',
    promotionStep: '승진 시 호봉',
    payday: '보수 지급일',
    workHours: '근무시간',
    leave: '연가',
    promotion: '승진',
    allowances: '수당',
    holidays: '공휴일',
    payTables: '봉급표(별표 4·8·10·11)',
    tracks: '직종별 규정·계급',
  };
  /** 항목이 일반직 기본 구역의 어디에 있는지(어느 해 값인지 표시) */
  const FEATURE_SECTION: Record<FeatureKey, RuleSectionKey> = {
    stepRaise: 'stepRaise',
    promotionStep: 'promotionStep',
    retirement: 'retirement',
    probation: 'probation',
    minService: 'promotion',
    longService: 'promotion',
    seniorTreatment: 'promotion',
    leaveAnnual: 'leave',
    leaveAdvance: 'leave',
    leaveCompensation: 'leave',
    leaveLongService: 'leave',
    diligence: 'allowances',
    holidayBonus: 'allowances',
    seniorAllowance: 'allowances',
    positionAllowance: 'allowances',
  };
  /** 직종과 무관하게 모두에게 같은 공통 규정 */
  const COMMON: {
    key: string;
    sub?: string;
    section: RuleSectionKey;
    pick: (r: typeof view.rules) => SourceRef;
  }[] = [
    { key: 'payday', section: 'payday', pick: (r) => r.payday.source },
    { key: 'workHours', section: 'workHours', pick: (r) => r.workHours.source },
    { key: 'holidays', section: 'holidays', pick: (r) => r.holidays.source },
    {
      key: 'leave.units',
      sub: '반일·시간 환산',
      section: 'leave',
      pick: (r) => r.leave.units.source,
    },
    {
      key: 'leave.firstYear',
      sub: '임용 연도 계산',
      section: 'leave',
      pick: (r) => r.leave.firstYear.source,
    },
    {
      key: 'allowances.meal',
      sub: '정액급식비',
      section: 'allowances',
      pick: (r) => r.allowances.meal.source,
    },
    {
      key: 'salary.prorate',
      sub: '달 가운데 임용·승급(생애 봉급)',
      section: 'salary',
      pick: (r) => r.salary.calc.prorate,
    },
    {
      key: 'salary.leaving',
      sub: '퇴직하는 달(생애 봉급)',
      section: 'salary',
      pick: (r) => r.salary.calc.leaving,
    },
  ];

  interface Row {
    key: string;
    label: string;
    /** 어느 해 값인지(꺼진 항목은 null) */
    year: number | null;
    source: SourceRef | null;
    off: Unavailable | null;
  }

  function yearOfSection(c: CareerRules, section: RuleSectionKey): number {
    // 일반직이 아닌 직종의 덮어쓰기·적용 근거는 tracks 구역에서 온다
    return view.rules.meta.sectionYear[c.sel.track === 'general' ? section : 'tracks'];
  }

  const rows = $derived.by(() => {
    const c = view.careerRules;
    const out: Row[] = [];
    const add = (key: string, label: string, year: number | null, source: SourceRef) =>
      out.push({ key, label, year, source, off: null });
    for (const s of c.sources.filter((s) => s.feature === 'track'))
      add('track', '직종', yearOfSection(c, 'tracks'), s.source);
    // 봉급(봉급표)·계급
    if (isAvailable(c.pay)) add('pay', `봉급표(${c.pay.annex})`, c.pay.tableYear, c.pay.source);
    else out.push({ key: 'pay', label: '봉급', year: null, source: null, off: c.pay });
    for (const s of c.sources.filter((s) => s.feature === 'ladder'))
      add('ladder', c.ladder?.noun ?? '계급', view.rules.meta.sectionYear.tracks, s.source);
    // 항목별
    for (const feature of FEATURE_KEYS) {
      const value = featureValue(c, feature);
      const label = FEATURE_LABEL[feature];
      if (!isAvailable(value)) {
        out.push({
          key: feature,
          label,
          year: null,
          source: null,
          off: value as unknown as Unavailable,
        });
        continue;
      }
      const year = yearOfSection(c, FEATURE_SECTION[feature]);
      const own = c.sources.filter((s) => s.feature === feature);
      const applied = own.some((s) => s.base);
      // 적용 조항(직종 규정) → 그 조항으로 쓰는 기본 구역의 조문(숫자와 해석·미반영 단서가 있는 곳)
      // 정근수당의 두 번째 근거(같은 무리 안)는 가산금이다
      let nth = 0;
      own.forEach((s, i) => {
        if (applied && !s.base) {
          add(`${feature}.${i}`, `${label} · 적용 조항`, year, s.source);
          return;
        }
        const name = feature === 'diligence' && nth > 0 ? '정근수당 가산금' : label;
        nth += 1;
        if (s.base)
          add(
            `${feature}.${i}`,
            `${name} · 적용하는 조문`,
            view.rules.meta.sectionYear[FEATURE_SECTION[feature]],
            s.source,
          );
        else add(`${feature}.${i}`, name, year, s.source);
      });
      if (feature === 'retirement')
        for (const s of c.sources.filter((s) => s.feature === 'rankLimit'))
          add('rankLimit', '계급정년', year, s.source);
      if (feature === 'leaveAnnual')
        for (const s of c.sources.filter((s) => s.feature === 'leaveScreen'))
          add('leaveScreen', '연가 화면(기록 시스템·저축)', yearOfSection(c, 'tracks'), s.source);
    }
    // 기본 구역(공통 규정)과 다른 근거로 정한 월급날·연가 단위(지방 일반직: 지방공무원 보수규정 제19조, 복무규정)
    for (const s of c.sources.filter((s) => s.feature === 'payday'))
      add('own-payday', SECTION_LABELS.payday, yearOfSection(c, 'tracks'), s.source);
    for (const s of c.sources.filter((s) => s.feature === 'leaveUnits'))
      add('own-leave-units', '연가 · 반일·시간 환산', yearOfSection(c, 'tracks'), s.source);
    for (const s of c.sources.filter((s) => s.feature === 'leaveFirstYear'))
      add('own-leave-first-year', '연가 · 임용 연도 계산', yearOfSection(c, 'tracks'), s.source);
    for (const s of c.sources.filter((s) => s.feature === 'workHours'))
      add('own-work-hours', SECTION_LABELS.workHours, yearOfSection(c, 'tracks'), s.source);
    for (const s of c.sources.filter((s) => s.feature === 'meal'))
      add('own-meal', '수당 · 정액급식비', yearOfSection(c, 'tracks'), s.source);
    c.sources
      .filter((s) => s.feature === 'payCalc')
      .forEach((s, i) =>
        add(
          `own-pay-calc-${i}`,
          i === 0 ? '봉급표 · 달 가운데 임용·승급(생애 봉급)' : '봉급표 · 퇴직하는 달(생애 봉급)',
          yearOfSection(c, 'tracks'),
          s.source,
        ),
      );
    return out;
  });
  /** 직종이 따로 근거를 둔 공통 규정(위 직종 칸에 보인다) */
  const OWN_COMMON: Partial<
    Record<string, 'payday' | 'leaveUnits' | 'leaveFirstYear' | 'workHours' | 'meal' | 'payCalc'>
  > = {
    payday: 'payday',
    workHours: 'workHours',
    'leave.units': 'leaveUnits',
    'leave.firstYear': 'leaveFirstYear',
    'allowances.meal': 'meal',
    'salary.prorate': 'payCalc',
    'salary.leaving': 'payCalc',
  };
  const common = $derived(
    COMMON.filter((item) => {
      const own = OWN_COMMON[item.key];
      return !own || !view.careerRules.sources.some((s) => s.feature === own);
    }).map((item) => ({
      key: item.key,
      label: item.sub
        ? `${SECTION_LABELS[item.section]} · ${item.sub}`
        : SECTION_LABELS[item.section],
      year: view.rules.meta.sectionYear[item.section],
      source: item.pick(view.rules),
      off: null,
    })),
  );
  const laws = $derived(view.rules.laws);
  const dots = (date: string) => formatKorean(date, false);
</script>

{#snippet list(items: Row[])}
  <ul class="list">
    {#each items as row (row.key)}
      <li class="well" data-off={row.off?.status}>
        <div class="kv">
          <strong>{row.label}</strong>
          {#if row.off}
            <span class="tag">{OFF_STATUS_LABEL[row.off.status]}</span>
          {:else if row.year !== null}
            <span class="tag">{row.year}년 값</span>
          {/if}
        </div>
        {#if row.off}
          <p class="cap muted">{OFF_STATUS_LABEL[row.off.status]}: {row.off.reason}</p>
        {:else if row.source}
          {@const law = laws[row.source.law]}
          <p>
            {law?.name ?? row.source.law}
            {row.source.article}
          </p>
          <p class="cap muted">
            {[
              law ? `시행 ${dots(law.effective)} · ${law.promulgation}` : '',
              row.source.revised ? `해당 조항 개정 ${dots(row.source.revised)}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {#each row.source.also ?? [] as also (also.law + also.article)}
            <p class="cap muted">함께: {laws[also.law]?.name ?? also.law} {also.article}</p>
          {/each}
          {#if row.source.note}<p class="cap muted">{row.source.note}</p>{/if}
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="stack wide">
  <p>
    화면의 모든 수치는 아래 법령에서 왔어요. 법령이 바뀌면 코드가 아니라 데이터 파일(<span
      class="nowrap"
    >
      data/연도.json
    </span>)만 고쳐요. 국가법령정보센터 원문을 {dots(view.rules.meta.verifiedAt)} 확인했어요.
  </p>
  {#if view.salaryPending && view.salary}
    <p class="note warn">
      {view.rules.year}년 봉급표는 아직 반영되지 않았어요. 금액은 {view.salary.tableYear}년 봉급표({view
        .salary.annex})로 계산하고 있어요.
    </p>
  {/if}

  <section class="stack" aria-labelledby="sources-track-title" id="sources-track">
    <h3 id="sources-track-title">{trackNameOf(view.careerRules)} 규정</h3>
    <p class="cap muted">{view.careerRules.track.scope}</p>
    <p class="cap muted">
      '준비 중'은 원문을 아직 확인하지 못한 항목, '해당 없음'은 이 직종에는 없는 항목, '다른 기준'은
      조례·기관 기준 등 다른 규정이 정해 여기서 계산하지 않는 항목이에요. 이런 항목에는 숫자를
      보이지 않아요.
    </p>
    {@render list(rows)}
  </section>

  <section class="stack" aria-labelledby="sources-common-title">
    <h3 id="sources-common-title">모든 직종에 같은 규정</h3>
    {@render list(common)}
  </section>

  {#each view.rules.meta.notes as note, i (i)}
    <p class="cap muted">※ {note}</p>
  {/each}
</div>

<style>
  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
    gap: 9px;
  }
  .list li {
    display: grid;
    gap: 3px;
    align-content: start;
    min-width: 0;
  }
  .list p {
    overflow-wrap: anywhere;
  }
  strong {
    font-weight: 400;
  }
  /* '정근수당 가산금 · 적용하는 조문'처럼 긴 이름은 좁은 화면에서 줄을 바꾸고, 꼬리표는 줄이지 않는다 */
  .list .kv > strong {
    flex: 0 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .list .kv > .tag {
    flex: none;
  }
  h3 {
    margin: 0;
    font-size: inherit;
    font-weight: 400;
  }
</style>
