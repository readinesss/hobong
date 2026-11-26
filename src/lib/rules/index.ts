/**
 * 번들에 포함된 규정 데이터 접근점.
 * data/ 아래에 <연도>.json 을 추가하면 코드 수정 없이 반영된다.
 */
import { buildRegistry, resolveRules, availableYears, type RulesRegistry } from './resolve.ts';
import type { Rules, RulesFile } from './types.ts';

const modules = import.meta.glob<RulesFile>('../../../data/2*.json', {
  eager: true,
  import: 'default',
});

export const registry: RulesRegistry = buildRegistry(Object.values(modules));

const cache = new Map<number, Rules>();

/** year에 적용할 규정(없으면 가장 가까운 이전 연도 규정) */
export function rulesFor(year: number): Rules {
  let rules = cache.get(year);
  if (!rules) {
    rules = resolveRules(registry, year);
    cache.set(year, rules);
  }
  return rules;
}

export function ruleYears(): number[] {
  return availableYears(registry);
}

export * from './types.ts';
export {
  isSalaryConfirmed,
  isPayTableConfirmed,
  hasHolidayData,
  resolveRules,
  buildRegistry,
} from './resolve.ts';
export {
  resolveCareer,
  rankLabel,
  rankStepLabel,
  rankSlug,
  selectableRanks,
  defaultSel,
  type CareerSel,
  type CareerRules,
  type PayInfo,
} from './career.ts';
