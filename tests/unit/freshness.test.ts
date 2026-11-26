import { describe, expect, it } from 'vitest';
import { checkFreshness, REVERIFY_AFTER_DAYS } from '../../src/lib/rules/freshness.ts';
import { buildRegistry } from '../../src/lib/rules/resolve.ts';
import { registry } from '../../src/lib/rules/index.ts';
import type { RulesFile } from '../../src/lib/rules/types.ts';

function file(year: number, extra: Partial<RulesFile> = {}): RulesFile {
  return {
    schema: 1,
    year,
    target: { id: 'general-national', label: '국가직 일반직' },
    status: 'verified',
    verifiedAt: `${year}-01-10`,
    laws: {},
    holidays: {
      items: [{ date: `${year}-01-01`, name: '1월 1일' }],
      source: { law: 'holidayRegulation', article: '제2조' },
    },
    ...extra,
  } as RulesFile;
}

const ids = (list: { id: string }[]) => list.map((f) => f.id);

describe('규정 데이터 점검', () => {
  it('지금 들어 있는 데이터는 오늘(2026-11-25) 기준으로 손볼 것이 없다', () => {
    expect(checkFreshness(registry, '2026-11-25')).toEqual([]);
  });

  it('해가 바뀌었는데 봉급표가 확정 전이면 알린다', () => {
    const found = checkFreshness(registry, '2027-01-04');
    expect(ids(found)).toEqual(['pending-2027-salary', 'pending-2027-payTables']);
    expect(found[0]).toMatchObject({ level: 'action', year: 2027 });
    expect(found[0]?.title).toContain('봉급표');
    // 직종별 봉급표(별표 4·8·10·11)도 확정 전임을 따로 알린다
    expect(found[1]).toMatchObject({ level: 'action', year: 2027 });
    expect(found[1]?.title).toContain('별표 4·8·10·11');
  });

  it('그 해 파일이 없으면 이전 연도로 계산 중임을 알린다', () => {
    const found = checkFreshness(buildRegistry([file(2026)]), '2027-02-01');
    expect(ids(found)).toEqual(['missing-2027']);
    expect(found[0]?.detail).toContain('2026년 규정으로 계산');
  });

  it('공휴일이 비어 있으면 알린다', () => {
    const empty = file(2026, {
      holidays: { items: [], source: { law: 'holidayRegulation', article: '제2조' } },
    });
    expect(ids(checkFreshness(buildRegistry([empty]), '2026-03-01'))).toEqual(['holidays-2026']);
  });

  it('7월부터는 다음 해 공휴일을 챙기라고 알린다', () => {
    const only = buildRegistry([file(2026)]);
    expect(checkFreshness(only, '2026-06-30')).toEqual([]);
    const found = checkFreshness(only, '2026-07-01');
    expect(ids(found)).toEqual(['holidays-2027']);
    expect(found[0]).toMatchObject({ level: 'upcoming', year: 2027 });
    // 다음 해 파일에 공휴일이 들어오면 사라진다
    const both = buildRegistry([file(2026), file(2027, { extends: 2026, status: 'partial' })]);
    expect(checkFreshness(both, '2026-07-01')).toEqual([]);
  });

  it('원문을 확인한 지 오래되면 다시 확인하라고 알린다', () => {
    const reg = buildRegistry([file(2026), file(2027)]);
    expect(checkFreshness(reg, '2026-07-12')).toEqual([]); // 183일째
    const found = checkFreshness(reg, '2026-07-13');
    expect(ids(found)).toEqual(['reverify-2026-2026-01-10']);
    expect(found[0]?.detail).toContain(`${REVERIFY_AFTER_DAYS + 1}일`);
  });
});
