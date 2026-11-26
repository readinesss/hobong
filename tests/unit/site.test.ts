/**
 * 운영 정보(data/site.json): 제안·문의 메일 주소와 '호봉이의 꿈'.
 * 주소는 사람이 나중에 채우므로 형식을 여기서 막고, 꿈 목록은 약속처럼 읽히지 않게 문구를 점검한다.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTACT_EMAIL,
  DREAM_GROUPS,
  DREAMS,
  mailtoHref,
  normalizeEmail,
  site,
} from '../../src/lib/site.ts';

describe('제안·문의 메일 주소', () => {
  it('비어 있거나, 쓸 수 있는 주소다(틀린 주소를 넣으면 여기서 실패한다)', () => {
    const value = site.contactEmail;
    expect(typeof value).toBe('string');
    if (value.trim() === '') expect(CONTACT_EMAIL).toBeNull();
    else expect(normalizeEmail(value), `contactEmail: ${value}`).not.toBeNull();
  });

  it('흔한 주소 꼴만 받고, mailto 를 깨뜨릴 수 있는 글자는 받지 않는다', () => {
    expect(normalizeEmail('hello@example.com')).toBe('hello@example.com');
    expect(normalizeEmail('  first.last+hobong@mail.example.co.kr ')).toBe(
      'first.last+hobong@mail.example.co.kr',
    );
    for (const bad of [
      '',
      'hello',
      'hello@',
      '@example.com',
      'hello@example',
      'hello @example.com',
      'hello@exa mple.com',
      '"hi"@example.com',
      'hi<script>@example.com',
      'hi@example.com?bcc=x@example.com',
      'hi@-example.com',
      `${'a'.repeat(250)}@example.com`,
    ]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  it('메일 쓰기 링크는 제목·본문을 인코딩한다', () => {
    const href = mailtoHref(
      'hello@example.com',
      '[호봉] ',
      '\n\n---\n호봉 0.1.0 · 규정 데이터 2026년',
    );
    expect(href.startsWith('mailto:hello@example.com?subject=')).toBe(true);
    expect(href).toContain(`subject=${encodeURIComponent('[호봉] ')}`);
    expect(href).toContain(
      `body=${encodeURIComponent('\n\n---\n호봉 0.1.0 · 규정 데이터 2026년')}`,
    );
    expect(href).not.toMatch(/[\s<>"]/);
    expect(mailtoHref('hello@example.com', '제목')).toBe(
      `mailto:hello@example.com?subject=${encodeURIComponent('제목')}`,
    );
  });
});

describe('호봉이의 꿈', () => {
  const statuses = DREAM_GROUPS.map((group) => group.status);

  it('형식: id 는 겹치지 않는 영문 소문자·숫자·하이픈, 상태는 정해진 셋 중 하나', () => {
    expect(site.schema).toBe(1);
    expect(DREAMS.length).toBeGreaterThan(0);
    const ids = DREAMS.map((dream) => dream.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const dream of DREAMS) {
      expect(dream.id, dream.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(statuses, dream.id).toContain(dream.status);
      expect(dream.title.trim().length, dream.id).toBeGreaterThan(0);
      expect(dream.blurb.trim().length, dream.id).toBeGreaterThan(0);
    }
  });

  it('짧게: 이름 16자, 설명 60자 이내(좁은 화면에서 두 줄 안팎)', () => {
    for (const dream of DREAMS) {
      expect(Array.from(dream.title).length, dream.title).toBeLessThanOrEqual(16);
      expect(Array.from(dream.blurb).length, dream.blurb).toBeLessThanOrEqual(60);
    }
  });

  it('해요체로 쓴다', () => {
    for (const dream of DREAMS) expect(dream.blurb, dream.id).toMatch(/요[.!]$/);
    for (const dream of DREAMS) expect(dream.blurb, dream.id).not.toMatch(/니다[.!?\s]/);
  });

  it('약속처럼 읽히지 않는다: 날짜·기한·장담하는 말을 쓰지 않는다', () => {
    const promise =
      /\d{4}|\d+월|분기|상반기|하반기|출시|예정|약속|반드시|꼭 |곧 |곧$|드릴게요|할게요/;
    for (const dream of DREAMS.filter((d) => d.status !== 'done')) {
      expect(`${dream.title} ${dream.blurb}`, dream.id).not.toMatch(promise);
    }
  });

  it('공식 기관처럼 보이지 않는다(정부·기관 이름을 내세우지 않는다)', () => {
    const official = /인사혁신처|행정안전부|정부 공식|공식 서비스|기관 인증/;
    for (const dream of DREAMS)
      expect(`${dream.title} ${dream.blurb}`, dream.id).not.toMatch(official);
  });
});
