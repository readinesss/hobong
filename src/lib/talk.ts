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
 * '{nick}님' 자리에 넣을 닉네임. 닉네임이 이미 '님'으로 끝나면 그 '님'을 떼어 넣는다
 * ('열두글자임님' → '열두글자임' + '님': '…님님'이 되지 않게).
 */
export function nickStem(nickname: string): string {
  const name = nickname.trim();
  return name.endsWith('님') ? name.slice(0, -1) : name;
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

/** 문장 첫머리에서 떼고 견주는 말('이제 다 됐어요!'와 '다 됐어요!'는 같은 말로 시작한다) */
const LEADING_FILLER = /^(이제|자|음)\s+/;

/**
 * 글의 문장마다 견줄 꼴로 바꾼다: 앞의 군말('이제')·띄어쓰기·문장부호를 뗀다.
 * '좋아요! 깃 하나하나 세어 뒀어요. 이제 다 됐어요!' → ['좋아요', '깃하나하나세어뒀어요', '다됐어요']
 */
export function sentenceOpenings(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) =>
      s
        .trim()
        .replace(LEADING_FILLER, '')
        .replace(/[\s.!?…,~]/g, ''),
    )
    .filter((s) => s.length > 0);
}

/**
 * 이어 붙는 두 토막(before 뒤에 after)이 같은 말을 되풀이하는지: after 의 첫 문장이 before 의 어느 문장과 같다
 * ('… 이제 다 됐어요! 알이 빛으로 둘러싸였어요.' 다음의 '다 됐어요! 틀린 곳이 없는지 …', 부록 P5).
 */
export function repeatsOpening(before: string, after: string): boolean {
  const first = sentenceOpenings(after)[0];
  if (!first) return false;
  return sentenceOpenings(before).includes(first);
}

/**
 * pickLine 처럼 씨앗으로 고르되, 바로 앞 토막(before)과 같은 말로 시작하는 변형은 건너뛴다(다음 차례의 변형으로).
 * 모든 변형이 겹치면 씨앗의 것을 그대로 쓴다(단위 테스트가 그런 묶음이 없음을 지킨다).
 */
export function pickLineAfter(lines: readonly string[], seed: number, before: string): string {
  if (lines.length === 0) return '';
  const start = ((Math.floor(seed) % lines.length) + lines.length) % lines.length;
  for (let k = 0; k < lines.length; k += 1) {
    const line = lines[(start + k) % lines.length] as string;
    if (!repeatsOpening(before, line)) return line;
  }
  return lines[start] as string;
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
