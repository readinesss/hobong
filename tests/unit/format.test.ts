import { describe, expect, it } from 'vitest';
import {
  busiestMonthText,
  formatMonthBarValue,
  formatMonthDayMaybeYear,
  josa,
  leaveBalance,
  withRo,
} from '../../src/lib/app/format.ts';

describe('화면 서식', () => {
  it('가장 많이 쓴 달이 여럿이면 모두 말한다', () => {
    const months = [8, 0, 0, 0, 8, 0, 0, 8, 0, 2, 0, 0];
    expect(busiestMonthText(months)).toBe('단위: 일. 1월·5월·8월이 가장 많아요(각 1일).');
    expect(busiestMonthText([0, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(
      '단위: 일. 가장 많이 쓴 달은 2월이에요(1일 4시간).',
    );
    expect(busiestMonthText(Array(12).fill(0))).toContain('아직 쓴 연가가 없어요');
  });
  it('월별 막대 값: 1일 미만은 시간으로, 그 밖은 내림 소수 한 자리', () => {
    expect(formatMonthBarValue(2)).toBe('2시간');
    expect(formatMonthBarValue(8)).toBe('1');
    expect(formatMonthBarValue(14)).toBe('1.7');
    expect(formatMonthBarValue(0)).toBe('');
  });
  it('받침에 따라 조사를 고른다', () => {
    expect(josa('넥타이', '은', '는')).toBe('넥타이는');
    expect(josa('반짝이', '은', '는')).toBe('반짝이는');
    expect(josa('금빛 깃', '은', '는')).toBe('금빛 깃은');
    expect(withRo('20일')).toBe('20일로');
    expect(withRo('12일 4시간')).toBe('12일 4시간으로');
  });
  it('올해가 아닌 날짜에는 연도를 붙인다', () => {
    expect(formatMonthDayMaybeYear('2026-12-01', '2026-11-26')).not.toContain('2026년');
    expect(formatMonthDayMaybeYear('2027-05-01', '2026-11-26')).toMatch(/^2027년 5월 1일/);
  });
  it('연가를 부여보다 많이 쓰면 음수 대신 초과 사용으로 쓴다', () => {
    expect(leaveBalance(-18, 120, 1.15)).toMatchObject({
      label: '초과 사용',
      value: '2일 2시간',
      over: true,
    });
    expect(leaveBalance(40, 120, 0.67)).toMatchObject({ label: '남은 연가', value: '5일' });
    expect(leaveBalance(-8, 0, 0).rateText).toBe('–');
    expect(leaveBalance(0, 120, 1).value).toBe('0일');
  });
});
