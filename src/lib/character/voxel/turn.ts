/**
 * 돌려 보기(#22) 화면이 쓰는 셈(DOM 없음): 각도 정리, 지금 보는 방향의 이름, 키로 돌릴 때의 다음 각도.
 *
 * 각도(yaw)는 렌더러와 같다: 0° 정면, 늘수록 호봉이의 앞이 화면 오른쪽으로 돈다
 * (90° 에서는 호봉이의 오른쪽 옆구리가 보이고, 180° 는 뒷모습).
 */

/** 키 한 번에 도는 각도 */
export const TURN_STEP = 45;

/** 0 이상 360 미만으로 */
export function normYaw(yaw: number): number {
  return ((yaw % 360) + 360) % 360;
}

/** -180 초과 180 이하로(정면으로 돌아갈 때 짧은 쪽으로 돌게) */
export function signedYaw(yaw: number): number {
  const y = normYaw(yaw);
  return y > 180 ? y - 360 : y;
}

/** 45° 칸마다의 이름(0° 정면부터 오른쪽으로) */
export const DIRECTIONS = [
  '정면',
  '오른쪽 앞모습',
  '오른쪽 옆모습',
  '오른쪽 뒷모습',
  '뒷모습',
  '왼쪽 뒷모습',
  '왼쪽 옆모습',
  '왼쪽 앞모습',
] as const;

/** 지금 보는 방향의 이름(가장 가까운 45° 칸) */
export function directionOf(yaw: number): (typeof DIRECTIONS)[number] {
  return DIRECTIONS[Math.round(normYaw(yaw) / TURN_STEP) % DIRECTIONS.length] ?? '정면';
}

/** 화면에 보일 각도(0~359, 정수) */
export function degreeOf(yaw: number): number {
  return Math.round(normYaw(yaw)) % 360;
}

/** ←(−1)·→(+1) 한 번: 지금(또는 돌아가던 곳)에서 다음 45° 칸으로. 칸 사이에 있으면 가까운 칸에 맞춘다 */
export function nextStop(from: number, dir: -1 | 1): number {
  const at = Math.round(from / TURN_STEP);
  const exact = Math.abs(from - at * TURN_STEP) < 0.5;
  const base = exact ? at : dir > 0 ? Math.floor(from / TURN_STEP) : Math.ceil(from / TURN_STEP);
  return (base + dir) * TURN_STEP;
}

/** 정면(0°)인지(돌다가 멈춘 각도를 정면으로 칠 너비 ±0.5°) */
export function isFront(yaw: number): boolean {
  return Math.abs(signedYaw(yaw)) < 0.5;
}
