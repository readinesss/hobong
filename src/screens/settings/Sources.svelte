<script lang="ts">
  import { view } from '../../lib/app/view.svelte.ts';
  import { formatKorean } from '../../lib/calc/date.ts';
  import { SECTION_KEYS, type SectionKey, type SourceRef } from '../../lib/rules/types.ts';

  const SECTION_LABELS: Record<SectionKey, string> = {
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
  };
  const SUB_LABELS: Record<string, string> = {
    'leave.annual': '재직기간별 일수',
    'leave.units': '반일·시간 환산',
    'leave.firstYear': '임용 연도 계산',
    'leave.advance': '미리 쓰기',
    'leave.compensation': '연가보상비',
    'leave.longService': '장기재직휴가',
    'promotion.minService': '승진소요최저연수',
    'promotion.longService': '근속승진',
    'promotion.seniorTreatment': '대우공무원',
    'allowances.seniorTreatment': '대우공무원수당',
    'allowances.diligence': '정근수당',
    'allowances.diligenceExtra': '정근수당 가산금',
    'allowances.holidayBonus': '명절휴가비',
    'allowances.meal': '정액급식비',
    'allowances.position': '직급보조비',
  };

  interface Row {
    key: string;
    label: string;
    year: number;
    source: SourceRef;
  }

  const rows = $derived.by(() => {
    const rules = view.rules;
    const out: Row[] = [];
    for (const section of SECTION_KEYS) {
      const value = rules[section] as unknown as Record<string, unknown>;
      const year = rules.meta.sectionYear[section];
      if (value.source) {
        out.push({
          key: section,
          label: SECTION_LABELS[section],
          year,
          source: value.source as SourceRef,
        });
        continue;
      }
      for (const [sub, inner] of Object.entries(value)) {
        const source = (inner as { source?: SourceRef } | null)?.source;
        if (source) {
          out.push({
            key: `${section}.${sub}`,
            label: `${SECTION_LABELS[section]} · ${SUB_LABELS[`${section}.${sub}`] ?? sub}`,
            year,
            source,
          });
        }
      }
    }
    return out;
  });
  const laws = $derived(view.rules.laws);
  const dots = (date: string) => formatKorean(date, false);
</script>

<div class="stack wide">
  <p>
    화면의 모든 수치는 아래 법령에서 왔어요. 법령이 바뀌면 코드가 아니라 데이터 파일(<span
      class="nowrap"
    >
      data/연도.json
    </span>)만 고쳐요. 국가법령정보센터 원문을 {dots(view.rules.meta.verifiedAt)} 확인했어요.
  </p>
  {#if view.salaryPending}
    <p class="note warn">
      {view.rules.year}년 봉급표는 아직 반영되지 않았어요. 금액은 {view.rules.meta.sectionYear
        .salary}년 봉급표로 계산하고 있어요.
    </p>
  {/if}
  <ul class="list">
    {#each rows as row (row.key)}
      {@const law = laws[row.source.law]}
      <li class="well">
        <div class="kv">
          <strong>{row.label}</strong>
          <span class="tag">{row.year}년 값</span>
        </div>
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
        {#if row.source.note}<p class="cap muted">{row.source.note}</p>{/if}
      </li>
    {/each}
  </ul>
  {#each view.rules.meta.notes as note, i (i)}
    <p class="cap muted">※ {note}</p>
  {/each}
</div>

<style>
  .list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 9px;
  }
  .list li {
    display: grid;
    gap: 3px;
    align-content: start;
    min-width: 0;
  }
  strong {
    font-weight: 400;
  }
</style>
