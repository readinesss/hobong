import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  completedMonths,
  completedYears,
  dayOfWeek,
  daysInMonth,
  diffDays,
  endOfMonth,
  formatKorean,
  isValidYmd,
  onOrNextDayOfMonth,
  parseHm,
  periodCompleteDate,
  spanBetween,
  toEpochDay,
  fromEpochDay,
  todayYmd,
} from './date.ts';

describe('날짜 기본', () => {
  it('형식과 실재하는 날짜만 받는다', () => {
    expect(isValidYmd('2026-11-25')).toBe(true);
    expect(isValidYmd('2024-02-29')).toBe(true);
    expect(isValidYmd('2026-02-29')).toBe(false);
    expect(isValidYmd('2026-13-01')).toBe(false);
    expect(isValidYmd('2026-1-5')).toBe(false);
    expect(isValidYmd('20261125')).toBe(false);
    expect(isValidYmd(null)).toBe(false);
    expect(isValidYmd(20261125)).toBe(false);
  });

  it('윤년과 월 길이', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('일수 변환은 왕복해도 같다', () => {
    for (const d of ['1970-01-01', '1999-12-31', '2024-02-29', '2026-11-25', '2099-12-31']) {
      expect(fromEpochDay(toEpochDay(d))).toBe(d);
    }
    expect(toEpochDay('1970-01-01')).toBe(0);
  });

  it('요일', () => {
    expect(dayOfWeek('2026-11-25')).toBe(3); // 수
    expect(dayOfWeek('2026-03-01')).toBe(0); // 일
    expect(dayOfWeek('2026-10-03')).toBe(6); // 토
    expect(dayOfWeek('1970-01-01')).toBe(4); // 목
    expect(dayOfWeek('1969-12-31')).toBe(3); // 수
  });

  it('일 더하기·빼기', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2026-11-25', '2026-12-25')).toBe(30);
    expect(diffDays('2026-12-25', '2026-11-25')).toBe(-30);
  });

  it('현지 날짜로 오늘을 구한다', () => {
    expect(todayYmd(new Date(2026, 10, 25, 23, 59, 59))).toBe('2026-11-25');
    expect(todayYmd(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });
});

describe('달 단위 계산', () => {
  it('addMonthsClamped는 말일로 맞춘다', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsClamped('2026-07-01', 12)).toBe('2027-07-01');
    expect(addMonthsClamped('2026-03-15', -3)).toBe('2025-12-15');
    expect(addMonthsClamped('2026-12-01', 1)).toBe('2027-01-01');
  });

  it('periodCompleteDate: 해당일이 있으면 그날', () => {
    expect(periodCompleteDate('2018-08-01', 1)).toBe('2018-09-01');
    expect(periodCompleteDate('2018-08-01', 12)).toBe('2019-08-01');
    expect(periodCompleteDate('2020-03-15', 66)).toBe('2025-09-15');
    expect(periodCompleteDate('2026-01-28', 1)).toBe('2026-02-28');
  });

  it('periodCompleteDate: 해당일이 없으면 다음 달 1일(민법 제160조)', () => {
    expect(periodCompleteDate('2026-01-31', 1)).toBe('2026-03-01');
    expect(periodCompleteDate('2026-01-29', 1)).toBe('2026-03-01');
    expect(periodCompleteDate('2024-02-29', 12)).toBe('2025-03-01');
    expect(periodCompleteDate('2024-02-29', 48)).toBe('2028-02-29');
    expect(periodCompleteDate('2026-08-31', 1)).toBe('2026-10-01');
    expect(periodCompleteDate('2026-12-31', 2)).toBe('2027-03-01');
  });

  it('completedMonths: 기간 만료 다음 날부터 채운 것으로 본다', () => {
    expect(completedMonths('2018-08-01', '2018-08-31')).toBe(0);
    expect(completedMonths('2018-08-01', '2018-09-01')).toBe(1);
    expect(completedMonths('2018-08-01', '2019-07-31')).toBe(11);
    expect(completedMonths('2018-08-01', '2019-08-01')).toBe(12);
    expect(completedMonths('2026-01-31', '2026-02-28')).toBe(0);
    expect(completedMonths('2026-01-31', '2026-03-01')).toBe(1);
    expect(completedMonths('2026-11-25', '2026-11-25')).toBe(0);
    expect(completedMonths('2026-11-25', '2020-01-01')).toBe(0);
  });

  it('completedYears', () => {
    expect(completedYears('2016-03-02', '2026-03-01')).toBe(9);
    expect(completedYears('2016-03-02', '2026-03-02')).toBe(10);
    expect(completedYears('2024-02-29', '2025-02-28')).toBe(0);
    expect(completedYears('2024-02-29', '2025-03-01')).toBe(1);
  });

  it('spanBetween', () => {
    expect(spanBetween('2020-01-01', '2026-11-25')).toEqual({ years: 6, months: 10, days: 24 });
    expect(spanBetween('2026-11-25', '2026-11-25')).toEqual({ years: 0, months: 0, days: 0 });
    expect(spanBetween('2018-08-01', '2019-08-01')).toEqual({ years: 1, months: 0, days: 0 });
  });

  it('onOrNextDayOfMonth', () => {
    expect(onOrNextDayOfMonth('2026-11-01', 1)).toBe('2026-11-01');
    expect(onOrNextDayOfMonth('2026-11-02', 1)).toBe('2026-12-01');
    expect(onOrNextDayOfMonth('2026-12-15', 1)).toBe('2027-01-01');
    expect(onOrNextDayOfMonth('2026-11-10', 20)).toBe('2026-11-20');
    expect(onOrNextDayOfMonth('2026-11-25', 20)).toBe('2026-12-20');
  });

  it('endOfMonth', () => {
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(endOfMonth('2026-11-25')).toBe('2026-11-30');
  });
});

describe('표시와 시각', () => {
  it('한국어 날짜', () => {
    expect(formatKorean('2026-11-25')).toBe('2026. 11. 25. (수)');
    expect(formatKorean('2026-01-01', false)).toBe('2026. 1. 1.');
  });

  it('HH:MM 파싱', () => {
    expect(parseHm('09:00')).toBe(540);
    expect(parseHm('18:30')).toBe(1110);
    expect(parseHm('24:00')).toBe(1440);
    expect(parseHm('24:01')).toBeNull();
    expect(parseHm('9시')).toBeNull();
    expect(parseHm('12:60')).toBeNull();
  });
});
