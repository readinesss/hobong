/**
 * 규정 데이터 검증.
 * - data/<연도>.json 의 형식·일관성
 * - 봉급표를 법령 원문 발췌본(docs/sources)과 대조
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistry, resolveRules, RulesError } from '../../src/lib/rules/resolve.ts';
import { SECTION_KEYS, type RulesFile, type SourceRef } from '../../src/lib/rules/types.ts';
import { dayOfWeek, isValidYmd } from '../../src/lib/calc/date.ts';
import { promotedStep } from '../../src/lib/calc/promotion.ts';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data');
const files: RulesFile[] = readdirSync(DATA_DIR)
  .filter((f) => /^\d{4}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as RulesFile);
const registry = buildRegistry(files);
const r2026 = resolveRules(registry, 2026);

function collectSources(value: unknown, out: SourceRef[] = []): SourceRef[] {
  if (Array.isArray(value)) value.forEach((v) => collectSources(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'source') out.push(v as SourceRef);
      else collectSources(v, out);
    }
  }
  return out;
}

describe('규정 파일 형식', () => {
  it.each(files.map((f) => [f.year, f] as const))('%i.json: 머리 정보', (_year, file) => {
    expect(file.schema).toBe(1);
    expect(file.target.id).toBe('national-general');
    expect(['verified', 'partial']).toContain(file.status);
    expect(isValidYmd(file.verifiedAt)).toBe(true);
    for (const law of Object.values(file.laws)) {
      expect(law.name.length).toBeGreaterThan(0);
      expect(isValidYmd(law.effective)).toBe(true);
      expect(law.promulgation.length).toBeGreaterThan(0);
      expect(law.url).toMatch(/^https:\/\//);
    }
    if (file.status === 'partial') expect(file.pending?.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.year, f] as const))(
    '%i.json: 모든 항목에 근거(법령·조항·발췌본)가 있다',
    (year, file) => {
      const laws = resolveRules(registry, year).laws;
      const sources = collectSources(file);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(laws[source.law], `알 수 없는 법령 키: ${source.law}`).toBeDefined();
        expect(source.article.length).toBeGreaterThan(0);
        if (source.revised) expect(isValidYmd(source.revised)).toBe(true);
        expect(source.snapshot, `${source.law} ${source.article}: 발췌본 없음`).toBeTruthy();
        // 발췌본은 그 값이 들어 있는 파일의 연도 디렉터리(docs/sources/<연도>/)에 둔다.
        expect(
          existsSync(join(ROOT, 'docs/sources', String(year), source.snapshot as string)),
          `발췌본 파일 없음: docs/sources/${year}/${source.snapshot}`,
        ).toBe(true);
        for (const extra of source.also ?? []) {
          expect(laws[extra.law], `알 수 없는 법령 키: ${extra.law}`).toBeDefined();
          expect(extra.article.length).toBeGreaterThan(0);
          if (extra.snapshot) {
            expect(
              existsSync(join(ROOT, 'docs/sources', String(year), extra.snapshot)),
              `발췌본 파일 없음: docs/sources/${year}/${extra.snapshot}`,
            ).toBe(true);
          }
        }
      }
    },
  );

  it.each(files.map((f) => [f.year, f] as const))(
    '%i.json: 적어 둔 법령은 모두 어떤 값의 근거로 쓰인다',
    (_year, file) => {
      const used = new Set<string>();
      for (const source of collectSources(file)) {
        used.add(source.law);
        for (const extra of source.also ?? []) used.add(extra.law);
      }
      for (const key of Object.keys(file.laws)) {
        expect(used.has(key), `laws.${key} 를 근거로 쓰는 값이 없다`).toBe(true);
      }
    },
  );

  it.each(files.map((f) => [f.year, f] as const))(
    '%i.json: 법령의 시행일·공포번호가 발췌본 머리말과 같다',
    (year, file) => {
      const laws = resolveRules(registry, year).laws;
      const seen = new Set<string>();
      const check = (lawKey: string, snapshot: string | undefined) => {
        if (!snapshot) return;
        const text = readFileSync(join(ROOT, 'docs/sources', String(year), snapshot), 'utf8');
        const head = text.split('\n').find((line) => line.startsWith('# 출처:')) ?? '';
        const m = /\[시행 (\d{4})\. (\d{1,2})\. (\d{1,2})\.\] \[([^\]]*?제(\d+)호[^\]]*)\]/.exec(
          head,
        );
        if (!m) return; // 달력자료·해석례는 시행일·공포번호가 없다
        const law = laws[lawKey];
        if (!law) throw new Error(`법령 키 없음: ${lawKey}`);
        const effective = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        expect(law.effective, `${snapshot} 머리말의 시행일`).toBe(effective);
        expect(law.promulgation, `${snapshot} 머리말의 공포번호`).toContain(`제${m[5]}호`);
        seen.add(lawKey);
      };
      for (const source of collectSources(file)) {
        // 달력자료처럼 다른 문서의 발췌본을 붙인 경우는 보조 근거에서 확인한다
        if (source.snapshot && !/^kasi-/.test(source.snapshot)) check(source.law, source.snapshot);
        for (const extra of source.also ?? []) check(extra.law, extra.snapshot);
      }
      if (year === 2026) {
        expect([...seen].sort()).toEqual(
          [
            'allowance',
            'appointment',
            'appointmentRule',
            'holidayAct',
            'pay',
            'service',
            'serviceDirective',
            'stateOfficialsAct',
          ].sort(),
        );
      }
    },
  );

  it('비율은 0.1% 단위다(금액 계산을 정수로 하기 위한 전제)', () => {
    const rates = [
      ...r2026.allowances.diligence.tiers.map((t) => t.rate),
      r2026.allowances.seniorTreatment.rate,
      r2026.allowances.holidayBonus.rate,
      r2026.leave.compensation.rate,
    ];
    for (const rate of rates)
      expect(Math.abs(rate * 1000 - Math.round(rate * 1000))).toBeLessThan(1e-9);
  });

  it('2026년은 모든 항목이 자기 연도 값이다', () => {
    expect(r2026.meta.fallback).toBe(false);
    expect(r2026.meta.status).toBe('verified');
    for (const key of SECTION_KEYS) expect(r2026.meta.sectionYear[key]).toBe(2026);
  });
});

describe('연도 합치기', () => {
  it('2027년: 공휴일만 자기 값, 나머지는 2026년 값을 이어 쓴다', () => {
    const r = resolveRules(registry, 2027);
    expect(r.year).toBe(2027);
    expect(r.meta.fallback).toBe(false);
    expect(r.meta.status).toBe('partial');
    expect(r.meta.sectionYear.holidays).toBe(2027);
    expect(r.meta.sectionYear.salary).toBe(2026);
    expect(r.salary.table).toEqual(r2026.salary.table);
    expect(r.holidays.items[0]?.date).toBe('2027-01-01');
    expect(r.laws.kasi?.effective).toBe('2027-01-01');
    expect(r.laws.pay?.name).toBe('공무원보수규정');
  });
  it('파일이 없는 해는 가장 가까운 이전 연도 규정을 쓰되 공휴일은 비운다', () => {
    const r = resolveRules(registry, 2030);
    expect(r.year).toBe(2030);
    expect(r.meta.fallback).toBe(true);
    expect(r.meta.sectionYear.salary).toBe(2026);
    expect(r.holidays.items).toEqual([]);
  });
  it('가장 이른 파일보다 앞선 해는 가장 이른 파일을 쓴다', () => {
    const r = resolveRules(registry, 2010);
    expect(r.meta.fallback).toBe(true);
    expect(r.salary.table['9'][0]).toBe(2_133_000);
    expect(r.holidays.items).toEqual([]);
  });
  it('잘못된 구성은 거부한다', () => {
    const base = files.find((f) => f.year === 2026) as RulesFile;
    expect(() => buildRegistry([base, base])).toThrow(RulesError);
    expect(() => buildRegistry([{ ...base, schema: 2 as unknown as 1 }])).toThrow(RulesError);
    const loop = buildRegistry([
      { ...base, year: 2001, extends: 2002 },
      { ...base, year: 2002, extends: 2001 },
    ]);
    expect(() => resolveRules(loop, 2002)).toThrow(/순환/);
    const partial = buildRegistry([{ ...base, salary: undefined }]);
    expect(() => resolveRules(partial, 2026)).toThrow(/salary/);
    expect(() => resolveRules(buildRegistry([]), 2026)).toThrow(RulesError);
  });
});

describe('값의 일관성', () => {
  it('봉급표: 호봉이 오를수록, 직급이 높을수록 많다', () => {
    const table = r2026.salary.table;
    const grades = ['9', '8', '7', '6', '5', '4', '3', '2', '1'] as const;
    for (const g of grades) {
      const row = table[g];
      expect(row.length).toBeGreaterThanOrEqual(23);
      for (let i = 1; i < row.length; i += 1) expect(row[i]).toBeGreaterThan(row[i - 1] as number);
      for (const v of row) expect(v % 100).toBe(0);
    }
    for (let step = 0; step < 23; step += 1) {
      for (let i = 1; i < grades.length; i += 1) {
        expect(table[grades[i] as '9'][step]).toBeGreaterThan(
          table[grades[i - 1] as '9'][step] as number,
        );
      }
    }
    expect(grades.map((g) => table[g].length)).toEqual([31, 31, 31, 32, 30, 28, 27, 25, 23]);
  });

  it('연가 구간은 빈틈없이 이어지고 일수가 늘어난다', () => {
    const tiers = r2026.leave.annual.tiers;
    expect(tiers[0]?.fromMonths).toBe(1);
    for (let i = 1; i < tiers.length; i += 1) {
      expect(tiers[i]?.fromMonths).toBe(tiers[i - 1]?.toMonths);
      expect(tiers[i]?.days).toBeGreaterThan(tiers[i - 1]?.days as number);
    }
    expect(tiers[tiers.length - 1]?.toMonths).toBeNull();
    expect(tiers.map((t) => t.days)).toEqual([11, 15, 16, 17, 20, 21]);
    const adv = r2026.leave.advance.tiers;
    for (let i = 1; i < adv.length; i += 1) expect(adv[i]?.fromMonths).toBe(adv[i - 1]?.toMonths);
  });

  it('정근수당 지급률은 근무연수에 따라 오른다', () => {
    const tiers = r2026.allowances.diligence.tiers;
    for (let i = 1; i < tiers.length; i += 1)
      expect(tiers[i]?.rate).toBeGreaterThan(tiers[i - 1]?.rate as number);
    expect(tiers[tiers.length - 1]).toEqual({ underYears: null, rate: 0.5 });
  });

  it('정년 구간은 1~12월을 빠짐없이 덮는다', () => {
    const months = new Set<number>();
    for (const p of r2026.retirement.periods) {
      for (let m = p.fromMonth; m <= p.toMonth; m += 1) months.add(m);
    }
    expect(months.size).toBe(12);
    expect(r2026.retirement.age).toBe(60);
  });

  it('보수 지급일 기본값은 선택지 안에 있다', () => {
    const days = r2026.payday.options.map((o) => o.day);
    expect(days).toEqual([10, 17, 20, 25]);
    expect(days).toContain(r2026.payday.defaultDay);
  });

  it.each([2026, 2027])('%i년 공휴일: 그 해 날짜, 날짜순, 중복 없음, 대체공휴일은 평일', (year) => {
    const items = resolveRules(registry, year).holidays.items;
    expect(items.length).toBeGreaterThan(15);
    const dates = items.map((h) => h.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    for (const item of items) {
      expect(isValidYmd(item.date)).toBe(true);
      expect(item.date.startsWith(`${year}-`)).toBe(true);
      if (item.name.startsWith('대체공휴일')) {
        expect([1, 2, 3, 4, 5]).toContain(dayOfWeek(item.date));
      }
    }
    expect(items.filter((h) => h.tag === 'seollal')).toHaveLength(1);
    expect(items.filter((h) => h.tag === 'chuseok')).toHaveLength(1);
    // 고정 공휴일
    for (const md of [
      '01-01',
      '03-01',
      '05-01',
      '05-05',
      '06-06',
      '07-17',
      '08-15',
      '10-03',
      '10-09',
      '12-25',
    ]) {
      expect(dates, `${year}-${md}`).toContain(`${year}-${md}`);
    }
  });

  it('대체공휴일 규칙(관공서공휴일규정 제3조)과 목록이 맞는다', () => {
    // 토·일과 겹치면 대체공휴일이 생기는 날(설·추석 연휴는 일요일만, 현충일·1월 1일은 대상 아님)
    const substitutable = [
      '3·1절',
      '노동절',
      '어린이날',
      '부처님 오신 날',
      '제헌절',
      '광복절',
      '개천절',
      '한글날',
      '기독탄신일',
    ];
    for (const year of [2026, 2027]) {
      const items = resolveRules(registry, year).holidays.items;
      const names = items.map((h) => h.name);
      for (const item of items) {
        const dow = dayOfWeek(item.date);
        // 2026년 노동절·제헌절 규정은 5월부터 시행이라 그 전 날짜에는 영향이 없다(둘 다 금요일).
        if (substitutable.includes(item.name)) {
          const needs = dow === 0 || dow === 6;
          expect(names.includes(`대체공휴일(${item.name})`), `${item.date} ${item.name}`).toBe(
            needs,
          );
        }
        if (item.tag === 'seollal' || item.tag === 'chuseok' || item.name.endsWith('연휴')) {
          const base = item.name.replace(' 연휴', '');
          if (dow === 0) expect(names).toContain(`대체공휴일(${base})`);
        }
        if (item.name === '현충일' || item.name === '1월 1일') {
          expect(names).not.toContain(`대체공휴일(${item.name})`);
        }
      }
    }
  });
});

describe('법령 원문 발췌본과 대조', () => {
  /** pdftotext -layout 으로 뽑은 별표 3에서 봉급표를 다시 읽는다(열 위치 기준) */
  function parseSalarySnapshot(text: string): Record<string, number[]> {
    const rows: { step: number; cells: { end: number; value: number }[] }[] = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(\d{1,2})\s+[\d,]/.exec(line);
      if (!m) continue;
      const cells: { end: number; value: number }[] = [];
      const re = /\d{1,3}(?:,\d{3})+/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        cells.push({
          end: match.index + match[0].length,
          value: Number(match[0].replace(/,/g, '')),
        });
      }
      rows.push({ step: Number(m[1]), cells });
    }
    const first = rows.find((r) => r.step === 1);
    if (!first || first.cells.length !== 9) throw new Error('1호봉 행(9개 직급)을 찾지 못했습니다');
    const columnEnds = first.cells.map((c) => c.end);
    const grades = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const out: Record<string, number[]> = Object.fromEntries(grades.map((g) => [g, []]));
    for (const row of rows.sort((a, b) => a.step - b.step)) {
      for (const cell of row.cells) {
        let best = 0;
        columnEnds.forEach((end, i) => {
          if (Math.abs(end - cell.end) < Math.abs((columnEnds[best] as number) - cell.end))
            best = i;
        });
        expect(Math.abs((columnEnds[best] as number) - cell.end)).toBeLessThanOrEqual(2);
        const list = out[grades[best] as string] as number[];
        expect(list.length).toBe(row.step - 1);
        list.push(cell.value);
      }
    }
    return out;
  }

  // 봉급표를 자기 값으로 가진 해는 모두 원문 발췌본이 있어야 하고, 한 칸도 다르면 안 된다.
  // 새 봉급표를 넣을 때 발췌본 없이(기억이나 추정으로) 숫자만 넣는 일을 막는다.
  const withSalary = files.filter((f) => f.salary !== undefined);
  it('봉급표를 가진 해가 하나 이상 있다', () => {
    expect(withSalary.map((f) => f.year)).toContain(2026);
  });
  it.each(withSalary.map((f) => [f.year, f] as const))(
    '%i년 봉급표가 공무원보수규정 별표 3 원문과 한 칸도 다르지 않다',
    (year, file) => {
      const salary = file.salary as NonNullable<RulesFile['salary']>;
      const path = join(ROOT, 'docs/sources', String(year), 'pay-reg-table3-salary.txt');
      expect(existsSync(path), `${path} 발췌본이 있어야 한다`).toBe(true);
      const text = readFileSync(path, 'utf8');
      // 발췌본이 데이터에 적힌 개정일의 별표인지 확인한다(예: 2026-01-02 → "개정 2026. 1. 2.").
      const [y, m, d] = (salary.source.revised ?? '').split('-').map(Number);
      expect(text).toContain(`[별표 3] <개정 ${y}. ${m}. ${d}.>`);
      const parsed = parseSalarySnapshot(text);
      expect(parsed).toEqual(salary.table);
    },
  );
  it('2026년 봉급표는 258칸이다', () => {
    const count = Object.values(r2026.salary.table).reduce((n, row) => n + row.length, 0);
    expect(count).toBe(258);
  });

  const snap = (name: string) => readFileSync(join(ROOT, 'docs/sources/2026', name), 'utf8');
  it('정년·시보', () => {
    const t = snap('state-officials-act.txt');
    expect(t).toContain(
      '공무원의 정년은 다른 법률에 특별한 규정이 있는 경우를 제외하고는 60세로 한다',
    );
    expect(t).toContain(
      '1월부터 6월 사이에 있으면 6월 30일에, 7월부터 12월 사이에 있으면 12월 31일에',
    );
    expect(t).toContain('6급 이하의 공무원을 신규 채용하는 경우에는 6개월간');
    expect(t).toContain('5급 공무원');
    expect(r2026.probation.monthsByGrade).toEqual({ '5': 12, '6': 6, '7': 6, '8': 6, '9': 6 });
  });
  it('승급·지급일·승진 시 호봉', () => {
    const t = snap('pay-reg-articles.txt');
    expect(t).toContain('승급기간”이라 한다)은 1년으로 한다');
    expect(t).toContain('공무원의 호봉은 매달 1일자로 승급한다');
    expect(t).toContain('보수 지급일이 토요일이거나 공휴일이면 그 전 날 지급한다');
    expect(r2026.stepRaise).toMatchObject({ periodMonths: 12, dayOfMonth: 1 });
    const payday = snap('pay-reg-table30-payday.txt');
    for (const option of r2026.payday.options) expect(payday).toContain(`${option.day}일`);
    expect(payday).toMatch(/25일\s+그 밖의 기관 및 그 소속 기관/);
    const t28 = snap('pay-reg-table28-promotion-step.txt');
    expect(t28).toMatch(/\n\s+1\s+1\s+12\s+11\s+23\s+22/);
    expect(t28).toMatch(/\n\s+2\s+1\s+13\s+12\s+24\s+23/);
  });
  it('연가', () => {
    const t = snap('service-reg-leave.txt');
    expect(t).toContain(
      '[제15조제1항 표] 재직기간 연가 일수 / 1개월 이상 1년 미만 11 / 1년 이상 3년 미만 15 / 3년 이상 4년 미만 16 / 4년 이상 5년 미만 17 / 5년 이상 6년 미만 20 / 6년 이상 21',
    );
    expect(t).toContain(
      '[제16조제6항 표] 재직기간 미리 사용하게 할 수 있는 최대 연가 / 1년 미만 5 / 1년 이상 2년 미만 6 / 2년 이상 3년 미만 7 / 3년 이상 4년 미만 8 / 4년 이상 10',
    );
    expect(t).toContain('반일 연가 2회는 연가 1일로 계산한다');
    expect(t).toContain('누계 8시간을 연가 1일로 계산한다');
    expect(t).toContain('15일 이상은 1개월로 계산하고, 15일 미만은 산입하지 아니하며');
    expect(t).toContain('연가대상 일수는 20일을 초과할 수 없다');
    expect(t).toContain('재직기간이 5년 이상 10년 미만인 공무원: 3일');
    expect(t).toContain('재직기간이 10년 이상 20년 미만인 공무원: 5일');
    expect(t).toContain('재직기간이 20년 이상인 공무원: 7일');
    expect(t).toContain('오전 9시부터 오후 6시까지로 하며, 점심시간은 낮 12시부터 오후 1시까지');
    const d = snap('service-directive-leave-excerpt.txt');
    expect(d).toContain('재직기간은 연가사용 직전일을 기준으로 계산함');
    expect(d).toContain('반일연가 1회는 4시간으로 계산');
    expect(r2026.leave.units).toMatchObject({ hoursPerDay: 8, halfDayHours: 4 });
    expect(r2026.leave.compensation.maxDays).toBe(20);
    expect(r2026.leave.longService.tiers.map((x) => [x.fromYears, x.days])).toEqual([
      [5, 3],
      [10, 5],
      [20, 7],
    ]);
    expect(r2026.workHours).toMatchObject({
      start: '09:00',
      end: '18:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
    });
  });
  it('승진소요최저연수·근속승진·대우공무원', () => {
    const t = snap('appointment-decree.txt');
    expect(t).toContain('가. 4급 및 5급: 3년 이상');
    expect(t).toContain('나. 6급: 2년 이상');
    expect(t).toContain('다. 7급, 8급 및 9급: 1년 이상');
    expect(t).toContain('1. 7급: 11년 이상');
    expect(t).toContain('2. 8급: 7년 이상');
    expect(t).toContain('3. 9급: 5년 6개월 이상');
    expect(t).toContain('100분의 50에 해당하는 인원 수');
    expect(t).toContain('근속승진기간에 도달하기 5일 전부터');
    const rule = snap('appointment-rule.txt');
    expect(rule).toContain('가. 5급 및 4급 : 7년 이상');
    expect(rule).toContain('나. 9급부터 6급까지 : 4년 이상');
    expect(rule).toContain('다음 월 1일에 일괄 발령');
    expect(r2026.promotion.minService.monthsByGrade).toEqual({
      '9': 12,
      '8': 12,
      '7': 12,
      '6': 24,
      '5': 36,
      '4': 36,
    });
    expect(r2026.promotion.longService.monthsByGrade).toEqual({ '9': 66, '8': 84, '7': 132 });
    expect(r2026.promotion.longService.reviewLeadDays).toBe(5);
    expect(r2026.promotion.seniorTreatment.monthsByGrade).toEqual({
      '9': 48,
      '8': 48,
      '7': 48,
      '6': 48,
      '5': 84,
      '4': 84,
    });
  });
  it('수당', () => {
    const t = snap('allowance-reg-articles.txt');
    expect(t).toContain('월봉급액의 4.1퍼센트를 대우공무원수당으로');
    expect(t).toContain('매년 1월과 7월의 보수지급일에');
    expect(t).toContain('월 16만원의 정액급식비');
    expect(t).toContain('월봉급액의 60퍼센트');
    expect(t).toContain('월봉급액의 86퍼센트 × 1/30 × 연가보상일수');
    const t2 = snap('allowance-reg-table2-diligence.txt');
    const expectRate = (label: string, pct: number) =>
      expect(t2).toMatch(new RegExp(`${label}\\s+월봉급액의 ${pct}% 해당 금액`));
    expectRate('2년 미만', 10);
    expectRate('5년 미만', 20);
    expectRate('6년 미만', 25);
    expectRate('7년 미만', 30);
    expectRate('8년 미만', 35);
    expectRate('9년 미만', 40);
    expectRate('10년 미만', 45);
    expectRate('10년 이상', 50);
    expect(r2026.allowances.diligence.tiers.map((x) => [x.underYears, x.rate])).toEqual([
      [2, 0.1],
      [5, 0.2],
      [6, 0.25],
      [7, 0.3],
      [8, 0.35],
      [9, 0.4],
      [10, 0.45],
      [null, 0.5],
    ]);
    expect(r2026.allowances.seniorTreatment.rate).toBe(0.041);
    expect(r2026.allowances.holidayBonus.rate).toBe(0.6);
    expect(r2026.leave.compensation).toMatchObject({ rate: 0.86, divisor: 30 });
    expect(r2026.allowances.meal.amount).toBe(160_000);
    const t15 = snap('allowance-reg-table15-position.txt');
    expect(t15).toMatch(/4급\(상당\)[\s\S]*?400,000원/);
    expect(t15).toMatch(/5급\(상당\)[\s\S]*?250,000원/);
    expect(t15).toMatch(/6급\(상당\)[\s\S]*?185,000원/);
    expect(t15).toMatch(/7급\(상당\)[\s\S]*?180,000원/);
    expect(t15).toMatch(/8ㆍ9급\(상당\)[\s\S]*?175,000원/);
  });
  // ── 발췌본을 읽어 데이터 값과 직접 맞춰 보는 검사(데이터만 틀리게 고치면 실패해야 한다) ──
  const won = (n: number) => n.toLocaleString('en-US');
  const squash = (text: string) => text.replace(/\s+/g, '');

  /** "[제○조 표] … / 1년 이상 3년 미만 15 / …" 줄을 (시작 개월, 끝 개월, 일수)로 읽는다 */
  function parseTierLine(
    text: string,
    marker: string,
  ): { from: number; to: number | null; days: number }[] {
    const line = text.split('\n').find((l) => l.startsWith(marker));
    if (!line) throw new Error(`발췌본에 '${marker}' 줄이 없습니다`);
    const months = (label: string) => {
      const m = /(\d+)(년|개월)/.exec(label);
      if (!m) throw new Error(`기간을 읽지 못함: ${label}`);
      return Number(m[1]) * (m[2] === '년' ? 12 : 1);
    };
    return line
      .split(' / ')
      .slice(1)
      .map((cell) => {
        const both = /^(.+?) 이상 (.+?) 미만 (\d+)$/.exec(cell);
        if (both)
          return {
            from: months(both[1] as string),
            to: months(both[2] as string),
            days: Number(both[3]),
          };
        const under = /^(.+?) 미만 (\d+)$/.exec(cell);
        if (under) return { from: 0, to: months(under[1] as string), days: Number(under[2]) };
        const over = /^(.+?) 이상 (\d+)$/.exec(cell);
        if (over) return { from: months(over[1] as string), to: null, days: Number(over[2]) };
        throw new Error(`표 칸을 읽지 못함: ${cell}`);
      });
  }

  it('연가 일수·미리 쓰기 표의 구간과 일수가 발췌본과 같다', () => {
    const t = snap('service-reg-leave.txt');
    expect(
      r2026.leave.annual.tiers.map((x) => ({ from: x.fromMonths, to: x.toMonths, days: x.days })),
    ).toEqual(parseTierLine(t, '[제15조제1항 표]'));
    expect(
      r2026.leave.advance.tiers.map((x) => ({ from: x.fromMonths, to: x.toMonths, days: x.days })),
    ).toEqual(parseTierLine(t, '[제16조제6항 표]'));
    expect(r2026.leave.firstYear).toMatchObject({ minDaysForMonth: 15, rounding: 'half-up' });
    expect(t).toContain(
      '권장 연가 일수 중 미사용 연가 일수에 대해서는 제16조제5항에 따른 연가보상비를 지급하지 않을 수 있다',
    );
  });

  it('장기재직휴가: 구간·일수·시행일·부칙 특례가 발췌본과 같다', () => {
    const t = snap('service-reg-leave.txt');
    const tiers = r2026.leave.longService.tiers;
    for (const tier of tiers) {
      const label =
        tier.toYears === null
          ? `재직기간이 ${tier.fromYears}년 이상인 공무원: ${tier.days}일`
          : `재직기간이 ${tier.fromYears}년 이상 ${tier.toYears}년 미만인 공무원: ${tier.days}일`;
      expect(t).toContain(label);
    }
    expect(t).toContain('<신설 2025. 7. 22., 2026. 6. 23.>');
    expect(tiers.map((x) => x.effective)).toEqual(['2026-06-23', '2025-07-22', '2025-07-22']);
    // 부칙: 시행 당시 재직 N년 이상 (구간 상한) 미만이면 시행 이후 2년이 되는 날까지
    expect(t).toContain('부 칙 <대통령령 제35665호, 2025. 7. 22.>');
    expect(t).toContain('이 영 시행 당시 재직기간이 18년 이상 20년 미만인 공무원은');
    expect(t).toContain('부 칙 <대통령령 제36442호, 2026. 6. 23.>');
    expect(t).toContain('이 영 시행 당시 재직기간이 8년 이상 10년 미만인 공무원은');
    expect(t.match(/이 영 시행 이후 2년이 되는 날까지/g)).toHaveLength(2);
    expect(tiers[0]?.grace).toEqual({ fromYears: 8, until: '2028-06-23' });
    expect(tiers[1]?.grace).toEqual({ fromYears: 18, until: '2027-07-22' });
    expect(tiers[2]?.grace).toBeUndefined();
    for (const tier of tiers) {
      if (!tier.grace) continue;
      // 특례 기한 = 시행일로부터 2년
      expect(tier.grace.until).toBe(
        `${Number(tier.effective.slice(0, 4)) + 2}${tier.effective.slice(4)}`,
      );
    }
  });

  it('승진 시 호봉: 별표 28 가목의 모든 칸과 비고 1', () => {
    const t = snap('pay-reg-table28-promotion-step.txt');
    const pairs: [number, number][] = [];
    for (const line of t.split('\n')) {
      if (!/^\s+\d/.test(line)) continue;
      const nums = line.trim().split(/\s+/).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2)
        pairs.push([nums[i] as number, nums[i + 1] as number]);
    }
    expect(pairs).toHaveLength(32);
    for (const [before, after] of pairs) {
      expect(promotedStep(r2026.promotionStep, before), `승진 전 ${before}호봉`).toBe(after);
    }
    expect(t).toContain('1. 승진 후 해당 호봉이 없는 경우에는 승진 후 계급의 최고 호봉으로 한다.');
    expect(r2026.promotionStep.capAtMaxStep).toBe(true);
    // 6급 32호봉 → 5급에는 31호봉이 없으므로 최고 호봉(30)
    expect(promotedStep(r2026.promotionStep, 32, r2026.salary.table['5'].length)).toBe(30);
  });

  it('보수 지급일: 기관명까지 별표 30과 같다', () => {
    const t = squash(snap('pay-reg-table30-payday.txt'));
    for (const option of r2026.payday.options) {
      expect(t, `${option.day}일`).toContain(`${option.day}일${squash(option.orgs)}`);
    }
    expect(r2026.payday.defaultDay).toBe(25);
    expect(r2026.payday.shift).toBe('previous-day-if-saturday-or-holiday');
  });

  it('정년 구간·대우공무원 발령일·정근수당 기준이 조문과 같다', () => {
    expect(r2026.retirement.age).toBe(60);
    expect(r2026.retirement.periods).toEqual([
      { fromMonth: 1, toMonth: 6, retireMonth: 6, retireDay: 30 },
      { fromMonth: 7, toMonth: 12, retireMonth: 12, retireDay: 31 },
    ]);
    expect(snap('appointment-rule.txt')).toContain('다음 월 1일에 일괄 발령하여야 한다');
    expect(r2026.promotion.seniorTreatment.appointDayOfMonth).toBe(1);
    const a = snap('allowance-reg-articles.txt');
    expect(a).toContain(
      '전년도 7월 1일부터 12월 31일까지의 기간 중 1개월 이상 봉급이 지급된 공무원',
    );
    expect(a).toContain(
      '해당 연도 1월 1일부터 6월 30일까지의 기간 중 1개월 이상 봉급이 지급된 공무원',
    );
    expect(r2026.allowances.diligence).toMatchObject({
      payMonths: [1, 7],
      periodMonths: 6,
      minMonthsToQualify: 1,
      minDaysForMonth: 15,
    });
    expect(r2026.allowances.holidayBonus.basisTags).toEqual(['seollal', 'chuseok']);
  });

  it('정근수당 가산금이 별표 2 제2호와 같다', () => {
    const t = snap('allowance-reg-table2-diligence.txt');
    const tiers = r2026.allowances.diligenceExtra.tiers;
    tiers.forEach((tier, i) => {
      const prev = tiers[i - 1]?.underYears ?? null;
      const amount = `${won(tier.amount)}원`;
      const patterns: RegExp[] = [];
      if (tier.underYears !== null)
        patterns.push(new RegExp(`${tier.underYears}년 미만\\s+${amount}`));
      if (prev !== null) patterns.push(new RegExp(`${prev}년 이상\\s+${amount}`));
      expect(
        patterns.some((re) => re.test(t)),
        `${tier.underYears ?? '그 이상'}년 구간 ${amount}`,
      ).toBe(true);
    });
    // 5년 이상 10년 미만은 "전 공무원(군인 제외)" 칸이 한 칸(50,000원)으로 합쳐져 있다
    //(7년에서 나뉘는 것은 군인 칸뿐이다).
    expect(tiers.map((x) => [x.underYears, x.amount])).toEqual([
      [5, 30_000],
      [10, 50_000],
      [15, 60_000],
      [20, 80_000],
      [null, 100_000],
    ]);
    const extra = r2026.allowances.diligenceExtra.additional;
    expect(extra.map((x) => [x.fromYears, x.toYears])).toEqual([
      [20, 25],
      [25, null],
    ]);
    // 추가 가산금 문장은 PDF 표의 비고 칸에 여러 줄로 나뉘어 있다
    expect(t).toContain('ㆍ근무연수가 20년 이상');
    expect(t).toContain('25년 미만인 사람에게는');
    expect(t).toContain(`월 ${won(extra[0]?.amount ?? 0)}원을, 25년 이상인`);
    expect(t).toContain(`사람에게는 월 ${won(extra[1]?.amount ?? 0)}원을`);
  });

  it('직급보조비 1~9급이 별표 15와 같다', () => {
    const t = snap('allowance-reg-table15-position.txt');
    const labels: Record<string, string> = {
      '1': '1급\\(상당\\)',
      '2': '2급\\(상당\\)',
      '3': '3급\\(상당\\)',
      '4': '4급\\(상당\\)',
      '5': '5급\\(상당\\)',
      '6': '6급\\(상당\\)',
      '7': '7급\\(상당\\)',
      '8': '8ㆍ9급\\(상당\\)',
      '9': '8ㆍ9급\\(상당\\)',
    };
    for (const [grade, label] of Object.entries(labels)) {
      const m = new RegExp(`${label}[\\s\\S]*?([\\d,]+)원`).exec(t);
      expect(m, `${grade}급 칸`).not.toBeNull();
      expect(
        r2026.allowances.position.amountByGrade[grade as keyof typeof labels & string as never],
        `${grade}급 직급보조비`,
      ).toBe(Number((m?.[1] ?? '').replace(/,/g, '')));
    }
  });

  /** 달력자료 발췌본의 "이름 M월 D일" · "이름 M월D일~ M월D일" 줄을 날짜 목록으로 편다 */
  function parseCalendar(text: string, year: number): string[] {
    const out: string[] = [];
    const ymd = (m: number, d: number) =>
      `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || line.startsWith('*')) continue;
      // "**" 는 국경일이지만 (자료를 만들 당시) 공휴일이 아닌 날이다
      if (line.includes('**')) continue;
      const range = /(\d{1,2})월\s*(\d{1,2})일\s*~\s*(\d{1,2})월\s*(\d{1,2})일/.exec(line);
      if (range) {
        const [m1, d1, m2, d2] = range.slice(1).map(Number) as [number, number, number, number];
        expect(m1).toBe(m2); // 설·추석 연휴는 한 달 안에 있다
        for (let d = d1; d <= d2; d += 1) out.push(ymd(m1, d));
        continue;
      }
      const single = /(\d{1,2})월\s*(\d{1,2})일\s*\(/.exec(line);
      if (single) out.push(ymd(Number(single[1]), Number(single[2])));
    }
    return out;
  }

  it('공휴일: 규정 조문', () => {
    const act = snap('holiday-act.txt');
    expect(act).toContain('1. 「국경일에 관한 법률」에 따른 국경일');
    expect(act).toContain('5. 노동절(5월 1일)');
    const reg = snap('holiday-regulation.txt');
    expect(reg).toContain('6. 노동절(5월 1일)');
    expect(reg).toContain('이 영은 2026년 5월 1일부터 시행한다');
  });

  it('공휴일: 2027년 날짜가 달력자료와 하루도 다르지 않다', () => {
    const k27 = readFileSync(join(ROOT, 'docs/sources/2027/kasi-calendar-2027.txt'), 'utf8');
    expect(k27).toContain('설날 2월 6일~ 2월 8일');
    expect(k27).toContain('추석 9월14일~ 9월16일');
    const fromCalendar = parseCalendar(k27, 2027);
    expect(fromCalendar.length).toBeGreaterThan(15);
    const fromData = resolveRules(registry, 2027).holidays.items.map((x) => x.date);
    expect([...new Set(fromData)].sort()).toEqual([...new Set(fromCalendar)].sort());
  });

  it('공휴일: 2026년 날짜가 달력자료 + 그 뒤 시행된 노동절·제헌절과 같다', () => {
    const k26 = snap('kasi-calendar-2026.txt');
    expect(k26).toContain('설날 2월16일~ 2월18일');
    expect(k26).toContain('추석 9월24일~ 9월26일');
    expect(k26).toContain('전국동시지방선거 6월 3일');
    // 이 달력자료는 2024년에 만들어져, 2026년에 공휴일이 된 두 날이 빠져 있다(발췌본 머리말 참고).
    const fromCalendar = parseCalendar(k26, 2026);
    expect(k26).toContain('제헌절 ** 7월 17일');
    const added = ['2026-05-01', '2026-07-17'];
    for (const d of added) expect(fromCalendar).not.toContain(d);
    const fromData = r2026.holidays.items.map((x) => x.date);
    expect([...new Set(fromData)].sort()).toEqual([...new Set([...fromCalendar, ...added])].sort());
  });
});
