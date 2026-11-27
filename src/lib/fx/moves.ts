/**
 * 작은 몸짓(알·호봉이가 정수 픽셀만큼 움찔·들썩이는 동작)의 낱말집.
 *
 * - 값은 스프라이트 픽셀 단위의 정수 (dx, dy)와 머무는 시간(ms)뿐이다. compose 의 bodyDx·bodyDy 에 그대로 넣는다.
 * - 몸짓은 위치만 바꾼다(밝기·색은 그대로라 번쩍임과 무관하다).
 * - 움직임 줄이기면 몸짓을 틀지 않는다(알은 단계 그림만 바뀐다). 뜻은 늘 글로도 전한다.
 */

export interface MoveFrame {
  dx: number;
  dy: number;
  /** 이 자리에 머무는 시간(ms) */
  ms: number;
}

export type Move = readonly MoveFrame[];

const f = (dx: number, dy: number, ms: number): MoveFrame => ({ dx, dy, ms });

export const MOVES = {
  /** 톡: 살짝 떴다 내려온다(칸을 채웠을 때의 기본 반응) */
  tap: [f(0, -2, 60), f(0, 0, 60)],
  /** 흔들: 좌우로 세 번(금이 갈 때) */
  shake: [f(1, 0, 70), f(-1, 0, 70), f(1, 0, 70), f(0, 0, 70)],
  /** 갸웃: 한쪽으로 기울였다 돌아온다 */
  tilt: [f(-1, 0, 300), f(0, 0, 60)],
  /** 콩콩: 두 번 뛴다 */
  hop: [f(0, -2, 120), f(0, 0, 120), f(0, -2, 120), f(0, 0, 120)],
  /** 까딱: 좌우로 한 번(꾸미기 견본을 고를 때) */
  nudge: [f(1, 0, 70), f(-1, 0, 70), f(0, 0, 70)],
  /** 움찔: 값을 고쳐야 할 때. 혼내는 느낌이 나지 않게 작고 짧다 */
  flinch: [f(-1, 0, 60), f(1, 0, 60), f(0, 0, 60)],
  /** 들썩: 다 채운 알이 기다리며(1.6초마다 한 번) */
  wiggle: [f(0, -2, 80), f(0, -3, 80), f(0, -2, 80), f(0, 0, 80)],
  /** 똑: 안에서 두드린다(부화 첫 두드림) */
  knock: [f(1, 0, 100), f(-1, 0, 100), f(1, 0, 100), f(-1, 0, 100), f(0, 0, 50)],
  /** 똑똑: 더 세게 */
  knockHard: [f(2, 0, 90), f(-2, 0, 90), f(2, 0, 90), f(-2, 0, 90), f(0, 0, 40)],
  /** 웅크림: 터지기 직전 */
  crouch: [f(0, 1, 100)],
  /** 통: 닿거나 내려앉을 때 한 번 */
  bump: [f(0, -1, 80), f(0, 0, 80)],
} as const satisfies Record<string, Move>;

export type MoveName = keyof typeof MOVES;

/** 다 채운 알이 들썩이는 간격(ms) */
export const WIGGLE_EVERY_MS = 1600;

export function moveDuration(move: Move): number {
  let total = 0;
  for (const frame of move) total += frame.ms;
  return total;
}

/** 몸짓을 시작한 지 elapsed(ms)일 때의 자리. 시작 전이거나 끝났으면 제자리(0, 0) */
export function moveAt(move: Move, elapsedMs: number): { dx: number; dy: number } {
  if (elapsedMs >= 0) {
    let t = elapsedMs;
    for (const frame of move) {
      if (t < frame.ms) return { dx: frame.dx, dy: frame.dy };
      t -= frame.ms;
    }
  }
  return { dx: 0, dy: 0 };
}
