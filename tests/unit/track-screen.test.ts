/**
 * #20 화면 문구 도우미(src/lib/app/track.ts)와 도감 단계 이름(stageLabels).
 * 화면마다 같은 '준비 중' 말과 직종 이름·조사를 쓰는지 본다.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultShowRank,
  OFF_STATUS_LABEL,
  offFeatures,
  offSentence,
  pendingTrackText,
  trackChipLabel,
  trackNameOf,
} from '../../src/lib/app/track.ts';
import { stageLabels } from '../../src/lib/character/look.ts';
import { characterRules } from '../../src/lib/character/rules.ts';
import { resolveCareer, rulesFor, type CareerSel } from '../../src/lib/rules/index.ts';

const rules = rulesFor(2026);
const career = (sel: CareerSel) => resolveCareer(rules, sel);

describe('직종 이름과 준비 중 안내', () => {
  it('꼬리말 이름: 일반직 별표 4·8 은 봉급표를 붙인다', () => {
    expect(trackNameOf(career({ track: 'general', payTable: 'table3', rank: '7' }))).toBe('일반직');
    expect(trackNameOf(career({ track: 'general', payTable: 'table4', rank: '7' }))).toBe(
      '일반직(별표 4)',
    );
    expect(trackNameOf(career({ track: 'police', payTable: null, rank: '경위' }))).toBe('경찰');
  });
  it('직종 칩은 상태를 글자로 붙인다(색만으로 구별하지 않는다)', () => {
    expect(trackChipLabel(rules.tracks.items.police)).toBe('경찰');
    expect(trackChipLabel(rules.tracks.items.coastGuard)).toBe('해양경찰 (일부 준비 중)');
    expect(trackChipLabel(rules.tracks.items.otherSpecial)).toBe('그 밖의 특정직 (준비 중)');
  });
  it('준비 중 띠: 조사를 받침으로 고르고, 꺼진 항목을 데이터에서 만든다', () => {
    const foreign = pendingTrackText(career({ track: 'foreign', payTable: null, rank: '3' }));
    expect(foreign).toMatch(/^외무는 일부만 계산해요\. 준비 중: /);
    expect(foreign).toContain('정년');
    const cg = pendingTrackText(career({ track: 'coastGuard', payTable: null, rank: '경위' }));
    expect(cg).toMatch(/^해양경찰은 /);
    expect(cg).toContain('승진소요최저연수');
    // 확인한 직종(ready)에는 띠가 없다
    expect(pendingTrackText(career({ track: 'police', payTable: null, rank: '경위' }))).toBeNull();
    expect(pendingTrackText(career({ track: 'teacher', payTable: null, rank: '교원' }))).toBeNull();
  });
  it('봉급부터 준비 중인 직종은 열여섯 항목을 늘어놓지 않고 쓸 수 있는 것을 말한다', () => {
    for (const track of ['otherSpecial', 'militaryCivil'] as const) {
      const text = pendingTrackText(career({ track, payTable: null, rank: null }));
      expect(text).toContain('아직 계산하지 않아요');
      expect(text).toContain('재직기간·연가 장부·근무시간은 쓸 수 있어요');
      expect(text).not.toContain('일부만');
    }
    expect(pendingTrackText(career({ track: 'otherSpecial', payTable: null, rank: null }))).toMatch(
      /^그 밖의 특정직은 /,
    );
  });
  it("꺼진 항목 문장(offSentence): 입력이 모자란 것은 '준비 중'이라고 하지 않는다", () => {
    expect(offSentence('봉급', { status: 'pending', reason: '원문을 확인한 뒤 넣을게요.' })).toBe(
      '봉급 계산은 준비 중이에요. 원문을 확인한 뒤 넣을게요.',
    );
    const input = offSentence('봉급', { status: 'input', reason: '계급을 골라 주세요.' });
    expect(input).toBe('계급을 골라 주세요. 그러면 봉급을 계산해요.');
    expect(input).not.toContain('준비 중');
    expect(OFF_STATUS_LABEL.input).toBe('입력 필요');
  });
  it('일반직 값을 그대로 쓰는 항목(applies)은 적용 조항과 숫자가 나온 기본 구역 근거를 함께 준다', () => {
    const police = career({ track: 'police', payTable: null, rank: '경위' });
    const annual = police.sources.filter((s) => s.feature === 'leaveAnnual');
    expect(annual[0]).toMatchObject({ source: { law: 'policeService' } });
    expect(annual[0]?.base).toBeUndefined();
    expect(
      annual.some((s) => s.base && s.source.law === 'service' && /제15조/.test(s.source.article)),
    ).toBe(true);
    // 장기재직휴가: 제20조제18항과 '이 서비스의 해석' 단서가 따라온다
    const long = police.sources.find((s) => s.feature === 'leaveLongService' && s.base);
    expect(long?.source.article).toContain('제20조제18항');
    expect(long?.source.note).toContain('이 서비스의 해석');
    // 일반직은 기본 구역 근거만(base 표시 없음)
    const general = career({ track: 'general', payTable: 'table3', rank: '7' });
    expect(general.sources.some((s) => s.base)).toBe(false);
  });
  it('꺼진 항목은 상태 이름과 사유를 함께 준다(교원: 해당 없음·다른 기준)', () => {
    const off = offFeatures(career({ track: 'teacher', payTable: null, rank: '교원' }));
    expect(off.find((f) => f.key === 'leaveCompensation')).toMatchObject({
      statusLabel: '해당 없음',
    });
    expect(off.find((f) => f.key === 'positionAllowance')).toMatchObject({
      statusLabel: '다른 기준',
    });
    expect(off.every((f) => f.reason.length > 0)).toBe(true);
    // 일반직 별표 3 은 꺼진 항목이 없다
    expect(offFeatures(career({ track: 'general', payTable: 'table3', rank: '7' }))).toEqual([]);
  });
  it('카드 계급 이름 기본값(Q2): 일반직 사다리만 켬, 우정·경찰·외무는 끔', () => {
    expect(defaultShowRank(career({ track: 'general', payTable: 'table4', rank: '7' }))).toBe(true);
    expect(defaultShowRank(career({ track: 'general', payTable: 'table8', rank: '7' }))).toBe(
      false,
    );
    expect(defaultShowRank(career({ track: 'police', payTable: null, rank: '경위' }))).toBe(false);
    expect(defaultShowRank(career({ track: 'foreign', payTable: null, rank: '1' }))).toBe(false);
  });
});

describe('도감 단계 이름(사용자 사다리 기준)', () => {
  const labels = (sel: CareerSel, word?: string) => {
    const c = career(sel);
    return Object.values(stageLabels(characterRules, { id: c.ladderId, ladder: c.ladder }, word));
  };
  it('일반직은 지금과 같다: 9급 … 5급 이상', () => {
    expect(labels({ track: 'general', payTable: 'table3', rank: '7' })).toEqual([
      '9급',
      '8급',
      '7급',
      '6급',
      '5급 이상',
    ]);
  });
  it('경찰: 순경 / 경장 / 경사 / 경위·경감 / 경정 이상', () => {
    expect(labels({ track: 'police', payTable: null, rank: '경위' })).toEqual([
      '순경',
      '경장',
      '경사',
      '경위·경감',
      '경정 이상',
    ]);
  });
  it('우정: 세 계급 이상이 한 형태면 처음~끝으로 줄인다', () => {
    expect(labels({ track: 'general', payTable: 'table8', rank: '7' })).toContain(
      '우정6급~우정3급',
    );
  });
  it('사다리로 자라지 않으면(교원) 재직 연수', () => {
    const t = stageLabels(characterRules, { id: null, ladder: null }, '교직');
    expect(Object.values(t)).toEqual([
      '교직 첫해',
      '교직 2년',
      '교직 5년',
      '교직 10년',
      '교직 20년',
    ]);
  });
});
