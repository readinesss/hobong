import { describe, expect, it } from 'vitest';
import { parsePrefs } from '../../src/lib/app/prefs.svelte.ts';
import { poseOf } from '../../src/lib/character/draw.ts';
import { resolveLook } from '../../src/lib/character/look.ts';
import { characterRules } from '../../src/lib/character/rules.ts';
import { defaultLook } from '../../src/lib/store/defaults.ts';
import {
  degreeOf,
  directionOf,
  isFront,
  nextStop,
  normYaw,
  signedYaw,
} from '../../src/lib/character/voxel/turn.ts';

describe('돌려 보기 각도(#22)', () => {
  it('각도를 0~360, -180~180 으로 정리한다', () => {
    expect(normYaw(-45)).toBe(315);
    expect(normYaw(720 + 30)).toBe(30);
    expect(signedYaw(270)).toBe(-90);
    expect(signedYaw(180)).toBe(180);
    expect(degreeOf(359.7)).toBe(0);
  });

  it('45° 칸마다 방향 이름(오른쪽으로 돌수록 오른쪽 옆구리가 보인다)', () => {
    expect(directionOf(0)).toBe('정면');
    expect(directionOf(20)).toBe('정면');
    expect(directionOf(30)).toBe('오른쪽 앞모습');
    expect(directionOf(90)).toBe('오른쪽 옆모습');
    expect(directionOf(180)).toBe('뒷모습');
    expect(directionOf(-90)).toBe('왼쪽 옆모습');
    expect(directionOf(-45)).toBe('왼쪽 앞모습');
    expect(directionOf(350)).toBe('정면');
  });

  it('키 한 번: 다음 45° 칸. 칸 사이면 가는 쪽의 가까운 칸', () => {
    expect(nextStop(0, 1)).toBe(45);
    expect(nextStop(0, -1)).toBe(-45);
    expect(nextStop(45, 1)).toBe(90);
    expect(nextStop(30, 1)).toBe(45);
    expect(nextStop(30, -1)).toBe(0);
    expect(nextStop(44.8, 1)).toBe(90);
  });

  it('정면 판정은 ±0.5°', () => {
    expect(isFront(0)).toBe(true);
    expect(isFront(359.8)).toBe(true);
    expect(isFront(1)).toBe(false);
  });
});

describe('돌려 보기의 2D 장면', () => {
  it('still 은 효과(움직이는 부품)만 빼고 그림자는 남긴다', () => {
    const look = resolveLook(characterRules, 'chick', 5, 'payday', defaultLook(), {
      track: 'general',
    });
    const full = poseOf(look);
    const still = poseOf(look, { still: true });
    const plain = poseOf(look, { plain: true });
    if (!full || !still || !plain) throw new Error('그림이 없다');
    const count = (px: Uint8Array | number[]) => Array.from(px).filter((v) => v !== 255).length;
    // 월급날 동전 효과가 빠진다
    expect(count(still.pixels)).toBeLessThan(count(full.pixels));
    // 그림자는 남는다
    expect(count(still.pixels)).toBeGreaterThan(count(plain.pixels));
  });
});

describe('이 기기 편의 값: 자동 회전', () => {
  it('turnAuto 는 참·거짓만 받는다', () => {
    expect(parsePrefs('{"turnAuto":false}')).toEqual({ turnAuto: false });
    expect(parsePrefs('{"turnAuto":"no"}')).toEqual({});
  });
});
