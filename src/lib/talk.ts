/**
 * 말을 거는 첫 입력·부화·임용정보 패키지 안내·공유의 문구(data/talk.json).
 * 화면은 문장을 여기서만 가져온다(말투·금지어·조사 검사를 한곳에서 하게).
 */
import raw from '../../data/talk.json';

export const TALK = raw;

export type TalkQuestionId = keyof typeof raw.questions;

/** 자리표시자({nick}·{n} 등)를 채운다. 모르는 자리표시자는 그대로 둔다 */
export function fillLine(
  line: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return line.replace(/\{([A-Za-z]+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  );
}

/**
 * 변형 가운데 하나를 고른다. seed 가 같으면 같은 문장이 나온다(다시 그려도 대사가 바뀌지 않게).
 * 빈 목록이면 ''.
 */
export function pickLine(lines: readonly string[], seed: number): string {
  if (lines.length === 0) return '';
  const index = ((Math.floor(seed) % lines.length) + lines.length) % lines.length;
  return lines[index] as string;
}

/** 이번 첫 입력에서 쓸 대사 씨앗(열 때마다 다르다). 테스트는 문장 묶음 전체를 기준으로 본다 */
export function newTalkSeed(): number {
  try {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return bytes[0] as number;
  } catch {
    return 0;
  }
}
