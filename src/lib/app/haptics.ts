/**
 * 진동(Vibration API). 화면 연출에 보태는 장치일 뿐, 뜻을 전하는 유일한 수단이 아니다.
 *
 * 울리지 않는 때(하나라도 해당하면 navigator.vibrate 를 부르지 않는다)
 * - 설정에서 진동을 껐다(settings.haptics). 첫 입력처럼 아직 설정이 없으면 켬으로 본다.
 * - 움직임 줄이기(앱 설정 또는 기기 설정).
 * - 기기가 진동을 지원하지 않는다(아이폰 Safari·데스크톱). 같은 정보는 화면 그림과 글로 전한다.
 *   데스크톱 Chrome·Edge 처럼 vibrate 함수만 있고 울리지 않는 곳에서는 진동 버튼·스위치를 보이지 않는다(hapticsSupported).
 * - 화면이 가려져 있다(document.hidden).
 * - 아직 사용자가 화면을 누른 적이 없다(브라우저가 막고 경고를 남긴다).
 *
 * 화면은 보통 진동을 직접 부르지 않고 신호(emitCue)만 낸다. linkHaptics 가 신호를 듣고 CUE_HAPTICS 에 따라 울린다.
 * 값을 고쳐야 할 때('egg-flinch')는 울리지 않는다(진동은 경고처럼 느껴진다).
 */
import { env } from '../fx/core.ts';
import { onCue, type CueName } from '../fx/cues.ts';

/**
 * 진동 무늬(ms: 울림, 쉼, 울림, …).
 * 일부 안드로이드 기기는 20ms 보다 짧은 진동을 무시해서, 가장 짧은 울림을 20ms 로 잡았다.
 */
export const HAPTIC_PATTERNS = {
  /** 칸 하나 완료·호봉 오름·임용정보 패키지를 받음: 짧게 한 번 */
  tick: [20],
  /** 알의 금 단계가 오름: 두 번 */
  crack: [20, 40, 20],
  /** 다 채움 */
  ready: [20, 60, 20, 60, 30],
  /** 부화: 안에서 두드림(똑똑). 장면의 두드림마다 한 번씩 울려 그림과 맞춘다 */
  knock: [30, 100, 30],
  /** 부화: 껍데기가 열림(팡) */
  pop: [80],
  /** 승진: 빛 모으기 */
  gather: [20],
  /** 승진: 모습이 바뀜 */
  evolve: [20, 80, 20, 80, 40],
} as const satisfies Record<string, readonly number[]>;

export type HapticName = keyof typeof HAPTIC_PATTERNS;

/** 신호 → 진동 무늬. 여기에 없는 신호는 울리지 않는다 */
export const CUE_HAPTICS: Readonly<Partial<Record<CueName, HapticName>>> = {
  'egg-react': 'tick',
  'egg-crack': 'crack',
  'egg-ready': 'ready',
  'egg-knock': 'knock',
  hatch: 'pop',
  'step-up': 'tick',
  promotion: 'gather',
  evolve: 'evolve',
  // 임용정보 패키지를 받았다: 보따리가 통 튀는 그림과 함께 짧게 한 번
  'package-saved': 'tick',
};

/** 한 번에 울릴 수 있는 가장 긴 무늬(ms)와 마디 수. 잘못 만든 무늬가 오래 울리지 않게 */
const MAX_TOTAL_MS = 2000;
const MAX_PARTS = 16;

let enabled = true;
/** 우리가 울린 진동이 있을 때만 멈춤을 청한다(누른 적 없는 화면에서 vibrate 를 부르면 브라우저가 경고를 남긴다) */
let buzzed = false;

/** 설정의 진동 스위치를 알려 준다(App 이 저장된 설정을, 첫 입력 화면이 그 자리의 토글 값을 넣는다) */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopHaptics();
}

export function hapticsEnabled(): boolean {
  return enabled;
}

type VibrateNavigator = Navigator & {
  userActivation?: { hasBeenActive: boolean };
};

function nav(): VibrateNavigator | null {
  return typeof navigator === 'undefined' ? null : (navigator as VibrateNavigator);
}

/** 손으로 누르는 기기인지(터치 점이 있거나 주 입력이 손가락) */
function touchDevice(n: VibrateNavigator): boolean {
  if ((n.maxTouchPoints ?? 0) > 0) return true;
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * 이 기기·브라우저가 진동을 지원하는지(첫 입력의 진동 버튼과 설정의 스위치를 보일지 정한다).
 * 데스크톱 Chrome·Edge 는 navigator.vibrate 가 함수로 있지만 울리지 않는다. 눌러도 아무 일 없는 스위치를
 * 보이지 않도록 터치 기기일 때만 지원한다고 본다.
 */
export function hapticsSupported(): boolean {
  const n = nav();
  return n !== null && typeof n.vibrate === 'function' && touchDevice(n);
}

function clean(pattern: readonly number[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (const part of pattern.slice(0, MAX_PARTS)) {
    const ms = Number.isFinite(part) ? Math.max(0, Math.round(part)) : 0;
    if (total + ms > MAX_TOTAL_MS) break;
    total += ms;
    out.push(ms);
  }
  return out;
}

/**
 * 진동을 울린다. 이름(HAPTIC_PATTERNS)이나 무늬를 준다. 울렸으면 true.
 * 새 진동은 울리고 있던 진동을 대신한다(브라우저 동작). 사용자가 누른 동작에서 이어지는 자리에서 부른다.
 */
export function haptic(pattern: HapticName | readonly number[]): boolean {
  if (!enabled || env.reduced) return false;
  const n = nav();
  if (!n || typeof n.vibrate !== 'function') return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  if (n.userActivation && !n.userActivation.hasBeenActive) return false;
  const list = clean(typeof pattern === 'string' ? HAPTIC_PATTERNS[pattern] : pattern);
  if (list.length === 0 || list.every((ms) => ms === 0)) return false;
  try {
    const ok = n.vibrate(list);
    if (ok) buzzed = true;
    return ok;
  } catch {
    return false;
  }
}

/** 울리고 있는 진동을 멈춘다(화면을 떠나거나 진동을 껐을 때) */
export function stopHaptics(): void {
  if (!buzzed) return;
  buzzed = false;
  const n = nav();
  if (!n || typeof n.vibrate !== 'function') return;
  try {
    n.vibrate(0);
  } catch {
    // 막힌 환경에서는 할 일이 없다
  }
}

/** 신호를 듣고 진동을 울린다(앱이 뜰 때 한 번). 돌려받은 함수를 부르면 그만 듣는다 */
export function linkHaptics(): () => void {
  return onCue((cue) => {
    const name = CUE_HAPTICS[cue.name];
    if (name) haptic(name);
  });
}
