/**
 * 이름 붙은 신호(cue) 발신기.
 *
 * 화면은 "무슨 일이 일어났는지"만 emitCue 로 알린다. 그 신호에 무엇을 얹을지는 듣는 쪽이 정한다:
 * 진동은 src/lib/app/haptics.ts 의 linkHaptics 가, 효과음은 2차 C 의 소리 모듈이 onCue 로 듣는다.
 * 그래서 화면에는 소리·진동 코드가 섞이지 않고, 소리가 꺼져 있거나 아직 없어도 화면은 그대로다.
 *
 * - 신호는 그 자리에서 바로(동기) 전해진다. 사용자가 누른 동작 안에서 내면 듣는 쪽도 그 동작 안에서 돈다
 *   (진동·소리는 사용자 동작이 있어야 브라우저가 허락한다).
 * - 듣는 쪽이 던진 오류는 삼킨다(소리가 고장 나도 화면이 멈추지 않게).
 * - 신호는 꾸밈이다. 뜻(금이 감·승급함)은 늘 화면의 글로도 전한다.
 */

export const CUE_NAMES = [
  // 첫 입력: 알
  /** 칸 하나를 채워 알이 반응했다 */
  'egg-react',
  /** 알의 금 단계가 올랐다 */
  'egg-crack',
  /** 필요한 칸을 다 채워 알이 반짝이기 시작했다 */
  'egg-ready',
  /** 값을 고쳐야 해서 알이 움찔했다(혼내는 느낌이 나지 않게: 진동 없음) */
  'egg-flinch',
  // 부화
  /** '알 깨우기'를 눌러 부화가 시작됐다 */
  'hatch-start',
  /** 안에서 두드린다(똑) */
  'egg-knock',
  /** 껍데기가 열렸다(팡) */
  'hatch',
  /** 깨어나 인사한다 */
  'greet',
  // 승급·승진
  /** 호봉이 올랐다(숫자 굴림이 끝남) */
  'step-up',
  /** 새 소품이 생겼다 */
  'unlock',
  /** 승진: 빛이 모인다 */
  'promotion',
  /** 모습이 바뀐다(진화) */
  'evolve',
  /** 색종이·깃이 터진다 */
  'confetti',
  // 임용정보 패키지·공유
  /** 임용정보 패키지를 내려받았다 */
  'package-saved',
  /** 임용정보 패키지를 불러왔다 */
  'package-loaded',
  /** 사이트 주소를 공유하거나 복사했다 */
  'share',
] as const;

export type CueName = (typeof CUE_NAMES)[number];

/** 신호에 딸린 값(숫자·짧은 표시만. 입력값·이름 같은 개인정보는 싣지 않는다) */
export type CueDetail = Readonly<Record<string, number | boolean>>;

export interface Cue {
  name: CueName;
  detail: CueDetail;
}

export type CueListener = (cue: Cue) => void;

const listeners = new Set<CueListener>();
const NO_DETAIL: CueDetail = Object.freeze({});

/** 신호를 낸다. 듣는 쪽이 없으면 아무 일도 없다 */
export function emitCue(name: CueName, detail: CueDetail = NO_DETAIL): void {
  if (listeners.size === 0) return;
  const cue: Cue = { name, detail };
  for (const listener of [...listeners]) {
    try {
      listener(cue);
    } catch (error) {
      console.error(error);
    }
  }
}

/** 모든 신호를 듣는다. 돌려받은 함수를 부르면 그만 듣는다 */
export function onCue(listener: CueListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 듣는 쪽 수(테스트·probe 용) */
export function cueListeners(): number {
  return listeners.size;
}
