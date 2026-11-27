/**
 * 모습이 바뀌는 연출(진화)의 그림 계산. DOM 을 만지지 않는다.
 *
 * 차례(시간표는 scenes.ts 의 promoteScene·hatchScene): 지금 모습 → 밝은 실루엣으로 서서히 → 녹아 바뀜 → 색 드러남 → 새 모습.
 * - 실루엣: 몸 전체가 한 색으로 서서히 바뀐다(한 번만, 되돌아가지 않는다). 어두운 무대에서는 흰색 대신 밝은 회청(d)을 써
 *   넓은 흰 면이 눈부시지 않게 한다.
 * - 녹아 바뀜: 옛 실루엣 칸이 사라지고 새 실루엣 칸이 생긴다. 칸마다 미리 섞어 둔 순서(8단계)를 따르므로 한 방향으로만 나아간다.
 * - 색 드러남: 새 모습의 색이 위에서 아래로 두 줄씩 돌아온다.
 * 어느 단계도 같은 칸을 번갈아 깜빡이지 않는다(번쩍임 없음).
 */
import { TRANSPARENT } from '../character/sprite-format.ts';
import { mulberry32 } from './particles.ts';
import { blit, type Stage } from './stage.ts';

export type Pose = { w: number; h: number; pixels: Uint8Array };

/** 녹아 바뀜의 단계 수 */
export const DISSOLVE_STEPS = 8;
/** 색 드러남이 한 번에 내려오는 줄 수 */
export const REVEAL_ROWS = 2;

/** 실루엣 색(팔레트 인덱스): 밝은 무대 흰색 c, 어두운 무대 밝은 회청 d */
export function silhouetteColor(dark: boolean): number {
  return dark ? 13 : 12;
}

/** 칸마다 0~7 의 순서를 고르게 섞어 매긴다(시드가 같으면 같은 순서) */
export function dissolveOrder(count: number, seed = 20): Uint8Array {
  const order = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) order[i] = i % DISSOLVE_STEPS;
  const rand = mulberry32(seed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = order[i] as number;
    order[i] = order[j] as number;
    order[j] = a;
  }
  return order;
}

export type EvolvePhase = 'silhouette' | 'dissolve' | 'reveal';

/** 0~1 의 진행을 계단(steps 칸)으로 끊는다 */
export function stepped(t: number, steps: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return Math.min(steps, Math.floor(clamped * steps + 1e-9));
}

export interface EvolveOptions {
  /**
   * 실루엣 색(팔레트 인덱스). 음수면 실루엣 없이 제 색 그대로 섞는다
   * (부화 직후의 짧은 판: 알봉이 칸이 사라지고 새 모습 칸이 제 색으로 생긴다. 'dissolve' 에서만 쓴다)
   */
  color: number;
  /** dissolveOrder(before.pixels.length) */
  order: Uint8Array;
}

/**
 * 진화의 한 장면을 무대에 그린다. t 는 그 단계 안의 진행(0~1).
 * before·after 는 같은 크기의 합성 결과(그림자·효과를 뺀 몸과 소품).
 */
export function drawEvolve(
  stage: Stage,
  before: Pose,
  after: Pose,
  dx: number,
  dy: number,
  phase: EvolvePhase,
  t: number,
  options: EvolveOptions,
): void {
  const { color, order } = options;
  if (phase === 'silhouette') {
    blit(stage, before, dx, dy, { mix: { color, t } });
    return;
  }
  if (phase === 'dissolve') {
    const step = stepped(t, DISSOLVE_STEPS);
    const w = before.w;
    blit(stage, mergePose(before, after), dx, dy, {
      map: (_v, x, y) => {
        const i = y * w + x;
        const from = (order[i] as number) < step ? after : before;
        const own = from.pixels[i] as number;
        if (own === TRANSPARENT) return -1;
        return color < 0 ? own : color;
      },
    });
    return;
  }
  // reveal: 위에서부터 두 줄씩 새 색이 돌아온다
  const rows = stepped(t, Math.ceil(after.h / REVEAL_ROWS)) * REVEAL_ROWS;
  blit(stage, after, dx, dy, { map: (v, _x, y) => (y < rows ? v : color) });
}

/** 두 그림 가운데 하나라도 칠해진 칸을 모두 가진 그림(녹아 바뀜이 훑을 칸) */
function mergePose(a: Pose, b: Pose): Pose {
  const pixels = new Uint8Array(a.pixels);
  for (let i = 0; i < pixels.length; i += 1) {
    if (pixels[i] === TRANSPARENT) pixels[i] = b.pixels[i] as number;
  }
  return { w: a.w, h: a.h, pixels };
}

/** 그림 둘레를 1px 두른 테두리만 담은 그림(빛 모으기 때 한 번 생기는 금빛 테) */
export function rimOf(pose: Pose, color: number): Pose {
  const { w, h } = pose;
  const pixels = new Uint8Array(pose.pixels.length).fill(TRANSPARENT);
  const at = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && pose.pixels[y * w + x] !== TRANSPARENT;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (at(x, y)) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) pixels[y * w + x] = color;
    }
  }
  return { w, h, pixels };
}
