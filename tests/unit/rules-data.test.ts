/**
 * 규정 데이터 검증.
 * - data/<연도>.json 의 형식·일관성
 * - 봉급표를 법령 원문 발췌본(docs/sources)과 대조
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRegistry, resolveRules, RulesError } from '../../src/lib/rules/resolve.ts';
import {
  EXTRA_PAY_TABLE_IDS,
  FEATURE_KEYS,
  PAY_TABLE_IDS,
  RULE_SECTION_KEYS,
  TRACK_IDS,
  isAvailable,
  type Avail,
  type FeatureKey,
  type LadderId,
  type RetirementRules,
  type RulesFile,
  type SourceRef,
  type TrackRules,
} from '../../src/lib/rules/types.ts';
import { dayOfWeek, isValidYmd } from '../../src/lib/calc/date.ts';
import { promotedStep } from '../../src/lib/calc/promotion.ts';
import { LIMITS } from '../../src/lib/store/schema.ts';

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, 'data');
const files: RulesFile[] = readdirSync(DATA_DIR)
  .filter((f) => /^\d{4}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) as RulesFile);
const registry = buildRegistry(files);
const r2026 = resolveRules(registry, 2026);

/** 모든 근거: 'source' 칸과 직종의 적용 근거(tracks.items.*.applies 의 값) */
function collectSources(value: unknown, out: SourceRef[] = []): SourceRef[] {
  if (Array.isArray(value)) value.forEach((v) => collectSources(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'source') out.push(v as SourceRef);
      else if (key === 'applies' && v && typeof v === 'object') {
        for (const ref of Object.values(v)) out.push(ref as SourceRef);
      } else collectSources(v, out);
    }
  }
  return out;
}

/** 직종 구역에서 화면에 찍힐 문구(범위·사유·안내) */
const TRACK_TEXT_KEYS = new Set([
  'scope',
  'reason',
  'pendingReason',
  'workHoursNote',
  'leaveNote',
  'quotaNote',
  'discretionNote',
  'label',
]);
function trackTexts(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => trackTexts(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'source' || key === 'applies') continue;
      if (typeof v === 'string' && (TRACK_TEXT_KEYS.has(key) || key === 'note')) {
        if (v) out.push(v);
      } else if (key === 'notes' && Array.isArray(v)) out.push(...(v as string[]));
      else trackTexts(v, out);
    }
  }
  return out;
}

/** 화면(설정 > 근거 법령 등)에 그대로 찍히는 글: 각 근거의 note, 파일 머리의 notes, 직종 문구 */
function screenNotes(file: RulesFile): string[] {
  const out: string[] = [...(file.notes ?? [])];
  for (const source of collectSources(file)) {
    if (source.note) out.push(source.note);
  }
  if (file.tracks) out.push(...trackTexts(file.tracks.items));
  return out;
}

describe('근거 법령 화면에 보이는 설명', () => {
  it.each(files.map((f) => [f.year, f] as const))(
    '%i.json: 개발 메모(내부 버전·파일 이름·저장소 경로·필드 이름·ISO 날짜)가 없다',
    (_year, file) => {
      for (const note of screenNotes(file)) {
        expect(note).not.toMatch(/\bv2\b|화면 안내용|구현상의 가정|\.txt|docs\/|\.json/);
        expect(note).not.toMatch(/\b(salary|pending|status|verified|effective|grace)\b/);
        expect(note).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    },
  );
  it.each(files.map((f) => [f.year, f] as const))(
    '%i.json: 화면 말투(해요체)에 맞춰 한다체 문장으로 끝나지 않는다',
    (_year, file) => {
      for (const note of screenNotes(file)) {
        // '…않는다.', '…했다.', '…이다.' 처럼 끝나는 문장(명사로 끝나는 메모는 괜찮다)
        expect(note, note).not.toMatch(
          /[가-힣](는|ㄴ|한|했|었|았|였|이|있|없|된|운|른|왔|겼|췄|쓴|센|바꾼|않는)다[.)]/,
        );
      }
    },
  );
  it('반영하지 않는 사정(한계)을 밝힌 문장은 남아 있다', () => {
    const file = files.find((f) => f.year === 2026) as RulesFile;
    const limits = screenNotes(file).filter((n) => n.includes('반영하지 않아요'));
    expect(limits.length).toBeGreaterThanOrEqual(10);
    // 서비스의 해석(가정)은 그렇다고 풀어 쓴다
    expect(screenNotes(file).filter((n) => n.includes('이 서비스의')).length).toBeGreaterThan(0);
  });
});

describe('규정 파일 형식', () => {
  it.each(files.map((f) => [f.year, f] as const))('%i.json: 머리 정보', (_year, file) => {
    expect(file.schema).toBe(1);
    expect(file.target).toEqual(files[0]?.target);
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
            'policeAct',
            'policePromotion',
            'policePromotionRule',
            'policeAppointment',
            'policeService',
            'fireAct',
            'firePromotion',
            'firePromotionRule',
            'fireService',
            'educationAct',
            'teacherLeave',
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
    for (const key of RULE_SECTION_KEYS) expect(r2026.meta.sectionYear[key]).toBe(2026);
    for (const id of PAY_TABLE_IDS) expect(r2026.meta.payTableYear[id]).toBe(2026);
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
    // 별표 4·8·10·11 도 2026년 표(확정 전)를 이어 쓴다
    const file2027 = files.find((f) => f.year === 2027) as RulesFile;
    expect(file2027.pending).toEqual(expect.arrayContaining(['salary', 'payTables']));
    expect(r.meta.sectionYear.payTables).toBe(2026);
    for (const id of PAY_TABLE_IDS) expect(r.meta.payTableYear[id]).toBe(2026);
    expect(r.payTables.items.table10?.table).toEqual(r2026.payTables.items.table10?.table);
  });
  it('봉급표 구역은 표 단위로 합친다(바뀐 표만 넣으면 나머지는 이전 해 표)', () => {
    const base = files.find((f) => f.year === 2026) as RulesFile;
    const t10 = base.payTables?.items.table10;
    if (!t10) throw new Error('table10 없음');
    const next: RulesFile = {
      ...base,
      year: 2031,
      extends: 2026,
      status: 'partial',
      pending: ['payTables'],
      laws: {},
      payTables: { items: { table10: { ...t10, table: { ...t10.table, '순경·소방사': [1] } } } },
    };
    for (const key of RULE_SECTION_KEYS) {
      if (key !== 'payTables') delete (next as unknown as Record<string, unknown>)[key];
    }
    const r = resolveRules(buildRegistry([base, next]), 2031);
    expect(r.meta.payTableYear).toMatchObject({ table3: 2026, table4: 2026, table10: 2031 });
    expect(r.payTables.items.table10?.table['순경·소방사']).toEqual([1]);
    expect(r.payTables.items.table4).toEqual(base.payTables?.items.table4);
    expect(r.meta.sectionYear.payTables).toBe(2031);
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
    expect(() => resolveRules(buildRegistry([{ ...base, tracks: undefined }]), 2026)).toThrow(
      /tracks/,
    );
    const noT11 = { items: { ...base.payTables?.items, table11: undefined } };
    expect(() =>
      resolveRules(buildRegistry([{ ...base, payTables: noT11 as RulesFile['payTables'] }]), 2026),
    ).toThrow(/table11/);
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
    // 저장 형식 검증이 쓰는 값과 같아야 한다(검증은 규정 파일에 기대지 않는다)
    expect(r2026.leave.units).toMatchObject({
      hoursPerDay: LIMITS.leaveHoursPerDay,
      halfDayHours: LIMITS.leaveHalfDayHours,
    });
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

// ───────────────────────── 직종 확대(#20): 별표 4·8·10·11, 직종별 규정 ─────────────────────────
describe('직종 확대 데이터(#20): 발췌본과 대조', () => {
  const snap = (name: string) => readFileSync(join(ROOT, 'docs/sources/2026', name), 'utf8');
  const squash = (text: string) => text.replace(/\s+/g, '');
  const tracks = r2026.tracks;
  const items = r2026.tracks.items;
  const pt = r2026.payTables.items;

  /**
   * pdftotext -layout 으로 뽑은 봉급표를 열 위치로 다시 읽는다(별표 3 대조와 같은 방식).
   * 1호봉 행의 칸 수로 열 끝 위치를 잡고, 이후 칸을 가장 가까운 열에 넣는다(오차 2자 이내).
   */
  function parseColumns(text: string, keys: readonly string[]): Record<string, number[]> {
    const rows: { step: number; cells: { end: number; value: number }[] }[] = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(\d{1,2})\s+[\d,]/.exec(line);
      if (!m) continue;
      const cells: { end: number; value: number }[] = [];
      for (const match of line.matchAll(/\d{1,3}(?:,\d{3})+/g)) {
        cells.push({
          end: (match.index ?? 0) + match[0].length,
          value: Number(match[0].replace(/,/g, '')),
        });
      }
      rows.push({ step: Number(m[1]), cells });
    }
    const first = rows.find((r) => r.step === 1);
    if (!first || first.cells.length !== keys.length)
      throw new Error(`1호봉 행(${keys.length}개 열)을 찾지 못했습니다`);
    const ends = first.cells.map((c) => c.end);
    const out: Record<string, number[]> = Object.fromEntries(keys.map((k) => [k, []]));
    for (const row of rows.sort((a, b) => a.step - b.step)) {
      for (const cell of row.cells) {
        let best = 0;
        ends.forEach((end, i) => {
          if (Math.abs(end - cell.end) < Math.abs((ends[best] as number) - cell.end)) best = i;
        });
        expect(Math.abs((ends[best] as number) - cell.end)).toBeLessThanOrEqual(2);
        const list = out[keys[best] as string] as number[];
        expect(list.length, `${row.step}호봉 ${keys[best]}`).toBe(row.step - 1);
        list.push(cell.value);
      }
    }
    return out;
  }
  /** 별표 11: 한 줄에 (호봉, 봉급, 호봉, 봉급) 두 단 */
  function parseTwoColumn(text: string): number[] {
    const pairs: [number, number][] = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)\s+([\d,]+)\s+(\d+)\s+([\d,]+)\s*$/.exec(line);
      if (!m) continue;
      pairs.push([Number(m[1]), Number((m[2] as string).replace(/,/g, ''))]);
      pairs.push([Number(m[3]), Number((m[4] as string).replace(/,/g, ''))]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    expect(pairs.map((p) => p[0])).toEqual(Array.from({ length: pairs.length }, (_, i) => i + 1));
    return pairs.map((p) => p[1]);
  }

  // 봉급표를 자기 값으로 가진 해는 모두 원문 발췌본이 있어야 하고, 한 칸도 다르면 안 된다.
  const withPayTables = files.filter((f) => f.payTables !== undefined);
  it('별표 4·8·10·11 을 가진 해가 하나 이상 있다', () => {
    expect(withPayTables.map((f) => f.year)).toContain(2026);
  });
  it.each(
    withPayTables.flatMap((f) =>
      Object.entries(f.payTables?.items ?? {}).map(([id, t]) => [f.year, id, t] as const),
    ),
  )('%i년 %s 가 원문 발췌본과 한 칸도 다르지 않다', (year, _id, table) => {
    if (!table) throw new Error('표 없음');
    const path = join(ROOT, 'docs/sources', String(year), table.source.snapshot as string);
    expect(existsSync(path), `${path} 발췌본이 있어야 한다`).toBe(true);
    const text = readFileSync(path, 'utf8');
    const [y, m, d] = (table.source.revised ?? '').split('-').map(Number);
    expect(text).toContain(`[${table.annex}] <개정 ${y}. ${m}. ${d}.>`);
    const keys = table.columns.map((c) => c.key);
    expect(Object.keys(table.table)).toEqual(keys);
    const parsed =
      keys.length === 1 ? { [keys[0] as string]: parseTwoColumn(text) } : parseColumns(text, keys);
    expect(parsed).toEqual(table.table);
  });

  it('칸 수·계급별 최고호봉', () => {
    const lengths = (id: 'table4' | 'table8' | 'table10' | 'table11') =>
      (pt[id]?.columns ?? []).map((c) => pt[id]?.table[c.key]?.length);
    const total = (id: 'table4' | 'table8' | 'table10' | 'table11') =>
      lengths(id).reduce((n: number, v) => n + (v ?? 0), 0);
    expect(lengths('table4')).toEqual([23, 25, 27, 28, 30, 32, 31, 31, 31]);
    expect(lengths('table8')).toEqual([24, 25, 27, 29, 30, 32, 31, 31, 31]);
    expect(lengths('table10')).toEqual([23, 25, 27, 28, 30, 32, 31, 31, 31, 31]);
    expect(lengths('table11')).toEqual([40]);
    expect([total('table4'), total('table8'), total('table10'), total('table11')]).toEqual([
      258, 260, 289, 40,
    ]);
  });

  it('호봉이 오를수록 많고, 100원 단위다', () => {
    for (const id of EXTRA_PAY_TABLE_IDS) {
      for (const [key, row] of Object.entries(pt[id]?.table ?? {})) {
        for (let i = 1; i < row.length; i += 1)
          expect(row[i], `${id} ${key} ${i + 1}호봉`).toBeGreaterThan(row[i - 1] as number);
        for (const v of row) expect(v % 100).toBe(0);
      }
    }
  });

  it('몇 칸을 손으로 대조: 경위 1호봉, 경감 32호봉, 교원 40호봉, 공안 7급 1호봉, 우정1급 24호봉', () => {
    expect(pt.table10?.table['경위·소방위']?.[0]).toBe(2_507_700);
    expect(pt.table10?.table['경감·소방경']?.[31]).toBe(5_372_500);
    expect(pt.table10?.table['경위·소방위']).toHaveLength(31);
    expect(pt.table11?.table['봉급']?.[39]).toBe(6_205_700);
    expect(pt.table4?.table['7']?.[0]).toBe(2_472_100);
    expect(pt.table8?.table['1']?.[23]).toBe(6_201_400);
    expect(pt.table10?.table['총경·소방정']?.[18]).toBe(5_893_300);
  });

  it('머리글: 별표 4·8 의 열 이름, 별표 10 의 경찰(윗줄)·소방(아랫줄) 계급 이름', () => {
    const headOf = (name: string, start: RegExp): [string, string] => {
      const lines = snap(name).split('\n');
      const i = lines.findIndex((l) => start.test(l));
      expect(i, `${name} 머리글`).toBeGreaterThan(0);
      return [lines[i] as string, lines[i + 1] as string];
    };
    const [a4, b4] = headOf('pay-reg-table4-public-safety.txt', /^\s*계급/);
    expect(squash(a4 + b4)).toBe(`계급${(pt.table4?.columns ?? []).map((c) => c.label).join('')}`);
    const [a8, b8] = headOf('pay-reg-table8-postal.txt', /^계급/);
    expect(squash(a8 + b8)).toBe(`계급${(pt.table8?.columns ?? []).map((c) => c.label).join('')}`);
    const [police, fire] = headOf('pay-reg-table10-police-fire.txt', /^\s*계급/);
    const keys = (pt.table10?.columns ?? []).map((c) => c.key.split('·'));
    expect(squash(police)).toBe(`계급${keys.map((k) => k[0]).join('')}`);
    expect(squash(fire)).toBe(`호봉${keys.map((k) => k[1]).join('')}`);
  });

  it('계급 사다리: 경찰·소방은 법 제3조를 뒤집은 순서, 별표 10 열과 짝이 맞는다', () => {
    const fromAct = (name: string) => {
      const lines = snap(name).split('\n');
      const i = lines.findIndex((l) => l.startsWith('제3조(계급 구분)'));
      const out: string[] = [];
      for (const line of lines.slice(i + 1)) {
        if (!line.trim()) break;
        out.push(line.replace(/\(.*$/, ''));
      }
      return out.reverse();
    };
    const police = tracks.ladders.police.ranks;
    const fire = tracks.ladders.fire.ranks;
    expect(police.map((r) => r.key)).toEqual(fromAct('police-officials-act.txt'));
    expect(fire.map((r) => r.key)).toEqual(fromAct('fire-officials-act.txt'));
    expect(police).toHaveLength(11);
    expect(fire).toHaveLength(11);
    const columns = (pt.table10?.columns ?? []).map((c) => c.key);
    for (const ladder of [police, fire]) {
      const withColumn = ladder.filter((r) => r.payColumn !== null);
      expect(withColumn.map((r) => r.payColumn).reverse()).toEqual(columns);
      const side = ladder === police ? 0 : 1;
      for (const r of withColumn) expect((r.payColumn as string).split('·')[side]).toBe(r.key);
      // 봉급표 열이 없는 맨 위 계급은 고를 수 없다
      const top = ladder[ladder.length - 1];
      expect(top?.payColumn).toBeNull();
      expect(top?.selectable).toBe(false);
      expect(ladder.filter((r) => r.selectable === false)).toHaveLength(1);
    }
  });

  it('계급 사다리: 일반직·우정·교원·외무', () => {
    const general = tracks.ladders.general.ranks;
    expect(general.map((r) => r.key)).toEqual(['9', '8', '7', '6', '5', '4', '3', '2', '1']);
    for (const r of general) expect(r.payColumn).toBe(r.key);
    const postal = tracks.ladders.postal.ranks;
    expect(postal.map((r) => r.label)).toEqual(
      [...(pt.table8?.columns ?? [])].reverse().map((c) => c.label),
    );
    expect(postal.map((r) => r.label)).toEqual(
      ['9', '8', '7', '6', '5', '4', '3', '2', '1'].map((g) => `우정${g}급`),
    );
    expect(snap('appointment-decree.txt')).toContain(
      '우정직공무원의 계급은 우정1급부터 우정9급까지로 구분하고',
    );
    expect(tracks.ladders.teacher.ranks).toEqual([
      { key: '교원', label: '교원', payColumn: '봉급', hideLabel: true },
    ]);
    // 외무: 별표 3 머리의 "N급ㆍ" 과 "M등급" 이 같은 열에 짝지어져 있다
    const lines = snap('pay-reg-table3-salary.txt').split('\n');
    const gradeLine = lines.find((l) => /4급ㆍ\s+5급ㆍ/.test(l)) ?? '';
    const tierLine = lines.find((l) => /6등급\s+5등급/.test(l)) ?? '';
    const grades = [...gradeLine.matchAll(/(\d)급ㆍ/g)].map((m) => m[1]);
    const tiers = [...tierLine.matchAll(/(\d)등급/g)].map((m) => m[1]);
    expect(grades).toEqual(['4', '5', '6', '7', '8', '9']);
    const pairs = Object.fromEntries(tiers.map((t, i) => [t, grades[i]]));
    for (const r of tracks.ladders.foreign.ranks) {
      expect(r.label).toBe(`${r.key}등급`);
      expect(r.payColumn, `${r.label}`).toBe(pairs[r.key]);
    }
    expect(snap('pay-reg-table1-classification.txt')).toContain('1등급부터 6등급까지의 외무공무원');
  });

  it('구조: 직종 목록, 봉급표 id, 사다리, 모든 payColumn 이 그 표에 있다', () => {
    expect(Object.keys(items).sort()).toEqual([...TRACK_IDS].sort());
    expect(Object.keys(r2026.payTables.items).sort()).toEqual([...EXTRA_PAY_TABLE_IDS].sort());
    const tableOf = (id: string): Record<string, number[]> =>
      id === 'table3' ? r2026.salary.table : (r2026.payTables.items[id as 'table4']?.table ?? {});
    for (const [trackId, track] of Object.entries(items) as [string, TrackRules][]) {
      for (const id of track.payTables) expect(PAY_TABLE_IDS, trackId).toContain(id);
      for (const id of Object.keys(track.byPayTable ?? {}))
        expect(track.payTables, `${trackId}.byPayTable`).toContain(id);
      for (const id of track.payTables) {
        const ladderId = (track.byPayTable?.[id]?.ladder ?? track.ladder) as LadderId | null;
        expect(ladderId, `${trackId}/${id}: 봉급표가 있으면 사다리도 있다`).toBeTruthy();
        const table = tableOf(id);
        for (const rank of tracks.ladders[ladderId as LadderId].ranks) {
          if (rank.payColumn === null) continue;
          expect(table[rank.payColumn], `${trackId}/${id}/${rank.key}`).toBeDefined();
        }
      }
      if (track.payTables.length === 0) expect(track.ladder ?? null).toBeNull();
      expect(track.payday.defaultDay).toBeGreaterThanOrEqual(1);
      expect(r2026.payday.options.map((o) => o.day)).toContain(track.payday.defaultDay);
    }
    expect(items.general.payTables[0]).toBe('table3');
  });

  it('안전장치: 일반직이 아닌 ready 직종은 모든 항목을 덮어쓰기나 적용 근거로 밝혀 둔다', () => {
    const ready = (Object.entries(items) as [string, TrackRules][]).filter(
      ([id, t]) => id !== 'general' && t.status === 'ready',
    );
    expect(ready.map(([id]) => id).sort()).toEqual(['fire', 'police', 'teacher']);
    for (const [id, t] of ready) {
      for (const f of FEATURE_KEYS) {
        const explicit = (t as unknown as Record<FeatureKey, unknown>)[f] !== undefined;
        const applied = t.applies?.[f] !== undefined;
        expect(explicit || applied, `${id}.${f}`).toBe(true);
        // 한 항목을 두 번 밝히지 않는다(덮어쓰기가 이긴다는 사실에 기대지 않게)
        expect(explicit && applied, `${id}.${f} 덮어쓰기와 적용 근거가 함께 있다`).toBe(false);
      }
    }
    for (const t of Object.values(items)) {
      for (const f of Object.keys(t.applies ?? {})) expect(FEATURE_KEYS).toContain(f);
    }
  });

  it('꺼진 항목은 정해진 상태와 사유를 가진다', () => {
    const offs: { status: string; reason: string }[] = [];
    const walk = (o: Record<string, unknown>) => {
      for (const f of FEATURE_KEYS) {
        const v = o[f] as object | undefined;
        if (v && !isAvailable(v)) offs.push(v as { status: string; reason: string });
      }
    };
    for (const t of Object.values(items)) {
      walk(t as unknown as Record<string, unknown>);
      for (const b of Object.values(t.byPayTable ?? {}))
        walk(b as unknown as Record<string, unknown>);
    }
    expect(offs.length).toBeGreaterThan(10);
    for (const off of offs) {
      expect(['pending', 'none', 'external']).toContain(off.status);
      expect(off.reason.length).toBeGreaterThan(5);
    }
  });

  it('정년 구간은 직종마다 1~12월을 한 번씩 덮는다', () => {
    const all: [string, RetirementRules][] = [['기본', r2026.retirement]];
    for (const [id, t] of Object.entries(items)) {
      if (t.retirement && isAvailable(t.retirement)) all.push([id, t.retirement]);
    }
    expect(all.map(([id]) => id)).toEqual(['기본', 'police', 'coastGuard', 'fire', 'teacher']);
    for (const [id, r] of all) {
      const months: number[] = [];
      for (const p of r.periods) for (let m = p.fromMonth; m <= p.toMonth; m += 1) months.push(m);
      expect(
        months.sort((a, b) => a - b),
        id,
      ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }
  });

  /** "1. 총경: 3년 이상" · "2. 경정 및 경감: 2년 이상" 같은 줄을 계급 → 개월로 읽는다 */
  function parseRankList(text: string, after: string): Record<string, number> {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.startsWith(after));
    expect(i, after).toBeGreaterThanOrEqual(0);
    const out: Record<string, number> = {};
    for (const line of lines.slice(i + 1)) {
      const m = /^\d\.\s*(.+?)\s*:\s*(\d+)년(?:\s*(\d+)개월)?(?: 이상)?$/.exec(line);
      if (!m) break;
      const months = Number(m[2]) * 12 + Number(m[3] ?? 0);
      for (const name of (m[1] as string).split(/,\s*|ㆍ|\s+및\s+/)) out[name.trim()] = months;
    }
    return out;
  }
  /** "1. 순경을 경장으로 근속승진임용하려는 경우: 해당 계급에서 4년 이상 근속자" */
  function parseLongService(text: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of text.matchAll(
      /^\d\. (\S+?)[을를] \S+? 근속승진임용(?:을 )?하려는 경우: 해당 계급에서 (\d+)년(?: (\d+)개월)? 이상 근속자$/gm,
    )) {
      out[m[1] as string] = Number(m[2]) * 12 + Number(m[3] ?? 0);
    }
    return out;
  }
  /** "치안감: 4년" 처럼 한 줄에 하나씩 적힌 계급정년 */
  function parseRankLimit(text: string, after: string): Record<string, number> {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l === after);
    expect(i, after).toBeGreaterThanOrEqual(0);
    const out: Record<string, number> = {};
    for (const line of lines.slice(i + 1)) {
      const m = /^(\S+): (\d+)년$/.exec(line);
      if (!m) break;
      out[m[1] as string] = Number(m[2]);
    }
    return out;
  }
  function avail<T extends object>(v: Avail<T> | undefined): T {
    if (!v || !isAvailable(v)) throw new Error('꺼진 항목');
    return v;
  }

  it('경찰: 정년·계급정년·승진소요·근속승진·대우공무원이 조문과 같다', () => {
    const act = snap('police-officials-act.txt');
    const rule = snap('police-promotion-rule.txt');
    const enf = snap('police-promotion-enforcement-rule.txt');
    const p = items.police;
    const ret = avail(p.retirement);
    expect(act).toContain(`1. 연령정년: ${ret.age}세`);
    expect(act).toContain(
      '그 정년이 된 날이 1월에서 6월 사이에 있으면 6월 30일에 당연퇴직하고, 7월에서 12월 사이에 있으면 12월 31일에 당연퇴직한다',
    );
    expect(ret.periods).toEqual(r2026.retirement.periods);
    expect(ret.rankLimit?.yearsByRank).toEqual(parseRankLimit(act, '2. 계급정년'));
    expect(avail(p.minService).monthsByGrade).toEqual(
      parseRankList(rule, '제5조(승진소요 최저근무연수)'),
    );
    const long = avail(p.longService);
    expect(long.monthsByGrade).toEqual(parseLongService(act));
    expect(long.monthsByGrade['경사']).toBe(78); // 6년 6개월
    expect(rule).toContain('경감으로의 근속승진임용을 위한 심사를 할 때에는');
    expect(rule).toContain('100분의 50에 해당하는 인원수');
    expect(long.quotaTo).toBe('경감');
    // 경찰에는 '기간 도달 5일 전부터 심사' 규정이 없다
    expect(rule).not.toContain('도달하기 5일 전부터');
    expect(long.reviewLeadDays).toBeNull();
    const senior = avail(p.seniorTreatment);
    const fromRule = parseRankList(enf, '제35조(대우공무원 선발을 위한 근무기간)');
    expect(fromRule).toEqual({ 총경: 84, 경정: 84, '경감 이하': 48 });
    for (const [rank, months] of Object.entries(senior.monthsByGrade)) {
      expect(months, rank).toBe(fromRule[rank] ?? fromRule['경감 이하']);
    }
    expect(Object.keys(senior.monthsByGrade)).toEqual(
      Object.keys(avail(p.minService).monthsByGrade),
    );
    expect(enf).toContain('그 다음 달 1일에 일괄하여 대우공무원으로 발령하여야 한다');
    expect(senior.appointDayOfMonth).toBe(1);
  });

  it('소방: 정년·계급정년·승진소요·근속승진(5일 전 심사)·대우공무원이 조문과 같다', () => {
    const act = snap('fire-officials-act.txt');
    const rule = snap('fire-promotion-rule.txt');
    const enf = snap('fire-promotion-enforcement-rule.txt');
    const f = items.fire;
    const ret = avail(f.retirement);
    expect(act).toContain(`1. 연령정년: ${ret.age}세`);
    expect(act).toContain(
      '1월에서 6월 사이에 있는 경우에는 6월 30일에 당연히 퇴직하고, 7월에서 12월 사이에 있는 경우에는 12월 31일에 당연히 퇴직한다',
    );
    expect(ret.periods).toEqual(r2026.retirement.periods);
    expect(ret.rankLimit?.yearsByRank).toEqual(parseRankLimit(act, '2. 계급정년'));
    expect(avail(f.minService).monthsByGrade).toEqual(
      parseRankList(rule, '제5조(승진소요최저근무연수)'),
    );
    const long = avail(f.longService);
    expect(long.monthsByGrade).toEqual(parseLongService(act));
    expect(rule).toContain('근속승진 기간에 도달하기 5일 전부터 승진심사를 할 수 있다');
    expect(long.reviewLeadDays).toBe(5);
    expect(rule).toContain('소방경으로의 근속승진임용을 위한 심사를 할 때에는');
    expect(long.quotaTo).toBe('소방경');
    const senior = avail(f.seniorTreatment);
    const fromRule = parseRankList(enf, '제36조(대우공무원 선발을 위한 근무기간)');
    expect(fromRule).toEqual({
      소방정: 84,
      소방령: 84,
      소방경: 48,
      소방위: 48,
      소방장: 48,
      소방교: 48,
      소방사: 48,
    });
    expect(senior.monthsByGrade).toEqual(fromRule);
    expect(enf).toContain('그 다음 월 1일에 일괄하여 대우공무원으로 발령하여야 한다');
    expect(f.leaveLongService).toMatchObject({ status: 'external' });
    expect(snap('fire-service-rule.txt')).toContain(
      '시ㆍ도 소속 소방공무원의 장기재직휴가에 관하여는 소속 지방자치단체의 장기재직휴가에 관한 조례를 적용한다',
    );
  });

  it('소방 문구에 경찰 문구가 섞이지 않았다', () => {
    const texts = [
      ...collectSources(items.fire).map((s) => s.note ?? ''),
      ...trackTexts(items.fire),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/경찰|제26조|임용령 제8조|재난·민원/);
    }
    // 해양경찰은 경찰공무원 승진임용 규정·경찰공무원 임용령의 적용을 확인하지 않았다
    for (const s of collectSources(items.coastGuard)) {
      for (const law of [s.law, ...(s.also ?? []).map((a) => a.law)]) {
        expect(['policePromotion', 'policePromotionRule', 'policeAppointment']).not.toContain(law);
      }
      expect(s.note ?? '').not.toMatch(/임용령 제8조|제26조/);
    }
    expect(snap('police-promotion-rule.txt')).toContain(
      '경찰공무원(해양경찰청 소속 경찰공무원은 제외한다. 이하 같다)의 승진임용은',
    );
  });

  it('해양경찰: 경찰공무원 복무규정이 적용돼 연가는 국가공무원 복무규정을 따른다(T4)', () => {
    const t = snap('police-service-rule.txt');
    expect(t).toContain(
      '제1조(목적) 이 영은 경찰공무원의 복무에 관한 사항을 규정함을 목적으로 한다.',
    );
    expect(t).toContain(
      '경찰청장 또는 해양경찰청장은 대간첩작전을 주임무로 하는 경찰공무원, 해양경찰청의 해상근무경찰공무원',
    );
    expect(t).toContain(
      '경찰공무원의 복무에 관하여 이 영에서 규정한 사항 외에는 「국가공무원 복무규정」을 적용한다.',
    );
    const c = items.coastGuard;
    for (const f of [
      'leaveAnnual',
      'leaveAdvance',
      'leaveLongService',
      'leaveCompensation',
    ] as const)
      expect(c.applies?.[f], f).toBeDefined();
    for (const f of ['minService', 'seniorTreatment', 'seniorAllowance'] as const)
      expect(c[f]).toMatchObject({ status: 'pending' });
    expect(avail(c.longService).monthsByGrade).toEqual(
      avail(items.police.longService).monthsByGrade,
    );
    expect(avail(c.longService).quotaTo).toBeNull();
  });

  it('교원: 정년 62세·퇴직일 구간, 미리 쓰기 표, 연가보상비 제외, 직급보조비는 다른 기준', () => {
    const edu = snap('education-officials-act.txt');
    const t = items.teacher;
    const ret = avail(t.retirement);
    expect(edu).toContain(`교육공무원의 정년은 ${ret.age}세로 한다`);
    expect(edu).toContain(
      '그 정년에 이른 날이 3월에서 8월 사이에 있는 경우에는 8월 31일에, 9월에서 다음 해 2월 사이에 있는 경우에는 다음 해 2월 말일에 각각 당연히 퇴직한다',
    );
    // 시보(T8): 교육공무원법에 시보 조항이 없고(비고), 제53조제5항이 국가공무원법 제29조를 빼지 않는다 → pending
    const art53 = edu.split('\n').find((l) => l.startsWith('⑤ 「국가공무원법」 제6조, 제17조'));
    expect(art53).toContain('교육공무원에게');
    expect(art53).not.toContain('제29조');
    expect(edu.split('\n')[3]).toContain('"시보"를 찾았으나 한 곳도 없었다');
    expect(t.probation).toMatchObject({ status: 'pending' });
    expect(ret.periods).toEqual([
      { fromMonth: 3, toMonth: 8, retireMonth: 8, retireDay: 31 },
      { fromMonth: 9, toMonth: 12, retireMonth: 2, retireDay: 'last', yearOffset: 1 },
      { fromMonth: 1, toMonth: 2, retireMonth: 2, retireDay: 'last' },
    ]);
    // 미리 쓰기 표(그림을 옮긴 두 단 표)
    const dir = snap('teacher-leave-directive.txt');
    const cells: { label: string; days: number }[] = [];
    for (const line of dir.split('\n')) {
      if (!/^\S.*\|\s*\d+일 \|\|/.test(line)) continue;
      for (const half of line.split('||')) {
        const [label, days] = half.split('|').map((x) => x.trim());
        cells.push({ label: label as string, days: Number((days as string).replace('일', '')) });
      }
    }
    const order = [
      '6월 미만',
      '6월 이상 1년 미만',
      '1년 이상 2년 미만',
      '2년 이상 3년 미만',
      '3년 이상 4년 미만',
      '4년 이상',
    ];
    cells.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    const adv = avail(t.leaveAdvance);
    expect(adv.tiers.map((x) => ({ label: x.label, days: x.days }))).toEqual(cells);
    for (let i = 1; i < adv.tiers.length; i += 1)
      expect(adv.tiers[i]?.fromMonths).toBe(adv.tiers[i - 1]?.toMonths);
    expect(adv.tiers[0]?.fromMonths).toBe(0);
    expect(adv.tiers[adv.tiers.length - 1]?.toMonths).toBeNull();
    expect(snap('allowance-reg-articles.txt')).toContain(
      '1. 교육공무원(방학이 없는 기관에 근무하는 사람은 제외한다)',
    );
    expect(t.leaveCompensation).toMatchObject({ status: 'none' });
    expect(t.positionAllowance).toMatchObject({ status: 'external' });
    expect((t.positionAllowance as { reason: string }).reason).toContain('비고 제8호');
    expect(snap('allowance-reg-table15-full.txt')).toContain(
      '8. 위 표에서 규정되지 않은 공무원의 직급보조비는 인사혁신처장이 기획예산처장관과 협의',
    );
    expect(dir).toContain('제16조의2, 제16조의3, 제16조의4, 제19조는 적용하지 아니한다');
    expect(t.leaveScreen).toMatchObject({ savingCarryOver: false });
    expect(dir).toContain('교육정보시스템(나이스)');
    expect(t.payday.defaultDay).toBe(17);
    for (const f of [
      'promotionStep',
      'minService',
      'longService',
      'seniorTreatment',
      'seniorAllowance',
    ] as const)
      expect(t[f]).toMatchObject({ status: 'none' });
  });

  it('직급보조비: 경찰·소방 금액이 별표 15 의 경찰ㆍ소방공무원 열과 같다', () => {
    // 본표 행(금액이 줄 끝에 있는 줄부터 다음 금액 줄 전까지)을 나눈다
    const lines = snap('allowance-reg-table15-full.txt').split('\n');
    const end = lines.findIndex((l) => l.trim() === '비고');
    const blocks: { amount: number; lines: string[] }[] = [];
    for (const line of lines.slice(0, end)) {
      const m = /([\d,]+)원\s*$/.exec(line);
      if (m) blocks.push({ amount: Number((m[1] as string).replace(/,/g, '')), lines: [] });
      blocks[blocks.length - 1]?.lines.push(line);
    }
    // 경찰ㆍ소방 열(글자 위치 33~41 안팎)만 이어 붙인다. 칸 안의 줄바꿈으로 이름이 둘로 나뉜다.
    const column = (b: { lines: string[] }, to: number) =>
      b.lines.map((l) => l.slice(33, to).replace(/\s+/g, '')).join('');
    const police = items.police.positionAllowance as { amountByGrade: Record<string, number> };
    const fire = items.fire.positionAllowance as { amountByGrade: Record<string, number> };
    for (const [rank, amount] of Object.entries(police.amountByGrade)) {
      const block = blocks.find((b) => b.lines.some((l) => l.includes(rank)));
      expect(block?.amount, rank).toBe(amount);
    }
    // 소방 계급은 같은 칸(별표 10 열 짝)의 경찰 계급과 같은 행에 적혀 있다
    const pairOf = (fireKey: string): string => {
      const i = tracks.ladders.fire.ranks.findIndex((r) => r.key === fireKey);
      return tracks.ladders.police.ranks[i]?.key as string;
    };
    expect(pairOf('소방총감')).toBe('치안총감');
    expect(pairOf('소방장')).toBe('경사');
    for (const [rank, amount] of Object.entries(fire.amountByGrade)) {
      const block = blocks.find((b) => b.lines.some((l) => l.includes(pairOf(rank))));
      expect(
        column(block ?? { lines: [] }, 41) + column(block ?? { lines: [] }, 42),
        rank,
      ).toContain(rank);
      expect(block?.amount, rank).toBe(amount);
    }
    // 같은 칸의 경찰·소방 계급은 같은 금액(별표 10 열 짝)
    for (const r of tracks.ladders.police.ranks) {
      const pair = tracks.ladders.fire.ranks.find(
        (f) => f.payColumn !== null && f.payColumn === r.payColumn,
      );
      if (pair) expect(fire.amountByGrade[pair.key]).toBe(police.amountByGrade[r.key]);
    }
    expect(fire.amountByGrade['소방총감']).toBe(police.amountByGrade['치안총감']);
    expect(snap('allowance-reg-table15-full.txt')).toContain('경찰공무원 중 치안총감과 소방');
    expect(items.coastGuard.positionAllowance).toEqual(items.police.positionAllowance);
  });

  it('우정직: 승진소요·대우공무원·상당 계급(T5)·직급보조비', () => {
    const t8 = items.general.byPayTable?.table8;
    const dec = snap('appointment-decree.txt');
    expect(t8?.ladder).toBe('postal');
    expect(dec).toContain('가. 우정2급: 3년 이상');
    expect(dec).toContain('나. 우정3급, 우정4급, 우정5급 및 우정6급: 1년 6개월 이상');
    expect(dec).toContain('다. 우정7급, 우정8급 및 우정9급: 1년 이상');
    expect(avail(t8?.minService)).toMatchObject({
      monthsByGrade: { '2': 36, '3': 18, '4': 18, '5': 18, '6': 18, '7': 12, '8': 12, '9': 12 },
    });
    expect(Object.keys(avail(t8?.minService).monthsByGrade)).toHaveLength(8);
    expect(snap('appointment-rule.txt')).toContain(
      '2. 우정직공무원 우정9급부터 우정2급까지 : 4년 이상',
    );
    expect(avail(t8?.seniorTreatment).monthsByGrade).toEqual(
      Object.fromEntries(['9', '8', '7', '6', '5', '4', '3', '2'].map((g) => [g, 48])),
    );
    // 공무원임용령 제3조제5항: 우정1·2급 → 5급, 우정3~6급 → 6급, 우정7·8·9급 → 7·8·9급
    expect(dec).toContain(
      '⑤ 우정1급 및 우정2급은 일반직 5급에, 우정3급ㆍ우정4급ㆍ우정5급 및 우정6급은 일반직 6급에, 우정7급은 일반직 7급에, 우정8급은 일반직 8급에, 우정9급은 일반직 9급에 각각 상당한다.',
    );
    const equiv: Record<string, string> = {
      '1': '5',
      '2': '5',
      '3': '6',
      '4': '6',
      '5': '6',
      '6': '6',
      '7': '7',
      '8': '8',
      '9': '9',
    };
    const pos = avail(t8?.positionAllowance);
    for (const [g, e] of Object.entries(equiv)) {
      expect(pos.amountByGrade[g], `우정${g}급`).toBe(r2026.allowances.position.amountByGrade[e]);
    }
    expect(t8?.longService).toMatchObject({ status: 'pending' });
    expect(t8?.probation).toMatchObject({ status: 'pending' });
    expect(items.general.byPayTable?.table4).toEqual({});
  });

  it('일반직 근속승진의 인원 제한 목표 직급이 데이터에 있다', () => {
    expect(r2026.promotion.longService.quotaTo).toBe('6');
    expect(r2026.promotion.longService.quotaNote).toContain('6급');
  });
});
