/**
 * 연도별 규정 파일을 합쳐 "그 해에 적용할 규정"을 만든다(순수 함수).
 *
 * - 해당 연도 파일에 없는 항목은 extends 연도에서 가져온다(항목 단위 교체, 깊은 병합 아님).
 *   단, 봉급표 구역(payTables)만은 표(items 의 키) 단위로 합친다. 개정 봉급표가 나왔을 때 바뀐 표만
 *   먼저 넣고 나머지는 이전 연도 표(확정 전)로 둘 수 있게 하려는 것이다.
 * - 해당 연도 파일이 아예 없으면 그보다 앞선 가장 최근 연도 파일을 쓰고 fallback으로 표시한다.
 *   단, 공휴일은 연도가 다르면 쓸 수 없으므로 빈 목록이 된다.
 */
import {
  EXTRA_PAY_TABLE_IDS,
  RULE_SECTION_KEYS,
  type ExtraPayTableId,
  type LawInfo,
  type PayTableId,
  type PayTablesSection,
  type RuleSectionKey,
  type Rules,
  type RuleSections,
  type RulesFile,
} from './types.ts';

export class RulesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesError';
  }
}

export type RulesRegistry = ReadonlyMap<number, RulesFile>;

export function buildRegistry(files: readonly RulesFile[]): RulesRegistry {
  const map = new Map<number, RulesFile>();
  for (const file of files) {
    if (file.schema !== 1) {
      throw new RulesError(
        `지원하지 않는 규정 데이터 형식입니다(year ${file.year}, schema ${String(file.schema)})`,
      );
    }
    if (map.has(file.year)) throw new RulesError(`${file.year}년 규정 파일이 두 개입니다`);
    map.set(file.year, file);
  }
  return map;
}

export function availableYears(registry: RulesRegistry): number[] {
  return [...registry.keys()].sort((a, b) => a - b);
}

interface Resolved {
  sections: Partial<RuleSections>;
  sectionYear: Partial<Record<RuleSectionKey, number>>;
  /** payTables 의 표마다 어느 연도 파일에서 왔는지 */
  payTableYear: Partial<Record<ExtraPayTableId, number>>;
  laws: Record<string, LawInfo>;
}

function resolveChain(registry: RulesRegistry, year: number, seen: Set<number>): Resolved {
  const file = registry.get(year);
  if (!file) throw new RulesError(`${year}년 규정 파일이 없습니다`);
  if (seen.has(year)) throw new RulesError(`규정 파일의 extends가 순환합니다(${year})`);
  seen.add(year);

  const base: Resolved =
    file.extends !== undefined
      ? resolveChain(registry, file.extends, seen)
      : { sections: {}, sectionYear: {}, payTableYear: {}, laws: {} };

  const sections: Partial<RuleSections> = { ...base.sections };
  const sectionYear: Partial<Record<RuleSectionKey, number>> = { ...base.sectionYear };
  const payTableYear: Partial<Record<ExtraPayTableId, number>> = { ...base.payTableYear };
  for (const key of RULE_SECTION_KEYS) {
    const value = file[key];
    if (value === undefined) continue;
    if (key === 'payTables') {
      // 표 단위 병합
      const own = (value as PayTablesSection).items;
      sections.payTables = { items: { ...sections.payTables?.items, ...own } };
      for (const id of Object.keys(own) as ExtraPayTableId[]) payTableYear[id] = file.year;
    } else {
      (sections as Record<RuleSectionKey, unknown>)[key] = value;
    }
    sectionYear[key] = file.year;
  }
  return { sections, sectionYear, payTableYear, laws: { ...base.laws, ...file.laws } };
}

/** year에 적용할 규정. 파일이 하나도 없거나 가장 이른 파일보다 앞선 연도면 가장 이른 파일을 쓴다. */
export function resolveRules(registry: RulesRegistry, year: number): Rules {
  const years = availableYears(registry);
  if (years.length === 0) throw new RulesError('규정 파일이 하나도 없습니다');

  const exact = registry.has(year);
  const earlier = years.filter((y) => y <= year);
  const sourceYear = exact ? year : (earlier[earlier.length - 1] ?? (years[0] as number));
  const file = registry.get(sourceYear) as RulesFile;
  const resolved = resolveChain(registry, sourceYear, new Set());

  for (const key of RULE_SECTION_KEYS) {
    if (resolved.sections[key] === undefined) {
      throw new RulesError(`${sourceYear}년 규정에 '${key}' 항목이 없습니다`);
    }
  }
  const sections = resolved.sections as RuleSections;
  const sectionYear = resolved.sectionYear as Record<RuleSectionKey, number>;
  for (const id of EXTRA_PAY_TABLE_IDS) {
    if (sections.payTables.items[id] === undefined) {
      throw new RulesError(`${sourceYear}년 규정의 payTables 에 '${id}' 봉급표가 없습니다`);
    }
  }
  const payTableYear: Record<PayTableId, number> = {
    table3: sectionYear.salary,
    ...(resolved.payTableYear as Record<ExtraPayTableId, number>),
  };

  // 공휴일은 날짜 목록이라 다른 해의 것을 쓸 수 없다.
  const holidays =
    sectionYear.holidays === year ? sections.holidays : { ...sections.holidays, items: [] };

  return {
    ...sections,
    holidays,
    year,
    target: file.target,
    laws: resolved.laws,
    meta: {
      sectionYear: { ...sectionYear, holidays: sectionYear.holidays === year ? year : sourceYear },
      payTableYear,
      fallback: !exact,
      status: exact ? file.status : 'partial',
      verifiedAt: file.verifiedAt,
      notes: file.notes ?? [],
    },
  };
}

/** 해당 연도의 봉급표가 그 해 것으로 확정돼 있는지(아니면 이전 연도 표로 계산 중) */
export function isSalaryConfirmed(rules: Rules): boolean {
  return rules.meta.sectionYear.salary === rules.year;
}

/** 해당 연도의 봉급표(id)가 그 해 것으로 확정돼 있는지(table3 은 isSalaryConfirmed 와 같다) */
export function isPayTableConfirmed(rules: Rules, id: PayTableId): boolean {
  return rules.meta.payTableYear[id] === rules.year;
}

/** 해당 연도의 공휴일 데이터가 있는지 */
export function hasHolidayData(rules: Rules): boolean {
  return rules.meta.sectionYear.holidays === rules.year && rules.holidays.items.length > 0;
}
