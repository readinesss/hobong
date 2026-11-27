/**
 * 장면 시간표(부화·호봉 오름·승진)와 장면 재생.
 *
 * - 시간표는 데이터다: 언제(at) 어떤 단계(step)가 시작해 얼마 동안(ms) 움직이는지, 그때 어떤 신호(cue)를 내는지.
 *   화면은 단계 이름을 보고 그림을 바꾸기만 한다. 소리·진동은 신호를 듣는 쪽이 얹는다(cues.ts).
 * - 모든 장면의 마지막 단계는 'end'(끝 장면: 결과 그림과 글, 버튼)다. 건너뛰기와 움직임 줄이기는 'end' 만 실행한다.
 * - 번쩍임 안전: 뚝 바뀌는 속성은 flips 에, 넓은 면의 밝기 페이드는 fades 에 적는다.
 *   tests/unit/fx.test.ts 가 SCENE_SAMPLES 의 모든 시간표를 flashProblems 로 검사한다.
 *   녹아 바뀜(8단계)·스캔라인처럼 한 방향으로만 나아가는 변화는 한 번의 페이드로 친다(되돌아가지 않는다).
 * - 진동은 그림과 맞게 단계마다 따로 울린다(부화: 두드림 두 번과 팡. haptics.ts 의 CUE_HAPTICS).
 * - 예전 연출의 무대 배경 깜빡임과 실루엣 번갈아 보이기는 쓰지 않는다.
 */
import { emitCue, type CueName } from './cues.ts';
import { play, type Playback, type PlayOptions, type SafeStep } from './timeline.ts';

export interface SceneStep extends SafeStep {
  /** 단계 이름(화면이 이것을 보고 그림을 바꾼다) */
  step: string;
  /** 이 단계의 움직임이 걸리는 시간(ms). 0 이면 그 순간 바뀐다 */
  ms: number;
  /** 이 단계에서 내는 신호 */
  cue?: CueName;
}

export interface Scene {
  name: string;
  steps: readonly SceneStep[];
  /**
   * 장면의 대표 신호. 건너뛰거나 움직임 줄이기여서 그 단계를 지나치면 끝 장면에서 대신 한 번 낸다
   * (연출을 건너뛰어도 '깨어났다'·'올랐다'는 소리는 한 번 들리게).
   */
  keyCue?: CueName;
}

/** 부화 끝 장면에 머문 뒤 홈으로 넘어가기까지(ms). 움직임 줄이기면 저절로 넘어가지 않고 버튼만 둔다 */
export const HATCH_LINGER_MS = 1200;

export interface HatchSceneOptions {
  /** 깨어난 모습이 알봉이가 아니면(8급 이상) 이어서 그 모습으로 자란다 */
  evolves: boolean;
}

/** 알 깨어남(첫 입력 화면 안에서, 대화상자 없이). 9급 약 2초 + 머묾, 그 밖은 약 2.9초 + 머묾 */
export function hatchScene(options: HatchSceneOptions): Scene {
  const steps: SceneStep[] = [
    // 말풍선·입력 칸이 물러나고 알이 화면 가운데로 온다
    { at: 0, step: 'clear', ms: 150, cue: 'hatch-start' },
    // 똑: 좌우로 1px 두 번(MOVES.knock)
    { at: 150, step: 'knock', ms: 450, cue: 'egg-knock' },
    // 껍데기 가루 4개가 떨어진다
    { at: 600, step: 'dust', ms: 400 },
    // 똑똑: 2px(MOVES.knockHard)
    { at: 1000, step: 'knock-hard', ms: 400, cue: 'egg-knock' },
    // 웅크림: 1px 내려앉는다
    { at: 1400, step: 'crouch', ms: 100 },
    // 팡: 넷째 프레임으로 바뀌고 껍데기 조각 8·반짝이 6, 알 뒤 둥근 빛이 한 번 퍼지며 사라진다
    {
      at: 1500,
      step: 'pop',
      ms: 500,
      cue: 'hatch',
      flips: ['egg-frame'],
      fades: { 'stage-glow': 600 },
    },
  ];
  let at = 2000;
  if (options.evolves) {
    // 녹아 바뀜(8단계) → 색이 위에서 아래로 돌아온다. 흰 실루엣 없이 가는 짧은 판
    steps.push({ at, step: 'dissolve', ms: 500, cue: 'evolve', fades: { 'body-shape': 500 } });
    steps.push({ at: at + 500, step: 'reveal', ms: 300, fades: { 'body-fill': 300 } });
    at += 800;
  }
  // 끝 장면: 이름판이 통 튀고 '반가워요' 말풍선
  steps.push({ at, step: 'end', ms: 0, cue: 'greet' });
  return { name: options.evolves ? 'hatch-evolve' : 'hatch', steps, keyCue: 'hatch' };
}

export interface StepUpSceneOptions {
  /** 한 번에 오른 호봉 수(오래 열지 않았다가 오면 여럿) */
  steps: number;
  /** 새 소품이 생겼는지 */
  unlock: boolean;
}

/** 숫자판 한 칸이 구르는 시간(ms). 6호봉 넘게 건너뛰면 빨리 넘긴다 */
export function rollMs(steps: number): number {
  const n = Math.max(1, Math.floor(steps));
  return n > 6 ? n * 60 : n * 120;
}

/** 호봉 오름. 한 호봉이면 약 1.9초, 새 소품이 있으면 약 2.9초 */
export function stepUpScene(options: StepUpSceneOptions): Scene {
  const roll = rollMs(options.steps);
  const steps: SceneStep[] = [
    // 대화상자가 열린다. 무대에는 오르기 전 모습과 숫자판
    { at: 0, step: 'open', ms: 200 },
    // 앞을 본다(반짝 눈), 작은 반짝이 2개
    { at: 200, step: 'look', ms: 500 },
    // 숫자판이 위로 구른다
    { at: 700, step: 'roll', ms: roll },
  ];
  let at = 700 + roll;
  // 깃 하나가 아래에서 떠올라 몸에 닿는다
  steps.push({ at, step: 'feather', ms: 400, cue: 'step-up' });
  at += 400;
  // 닿는 순간 몸이 1px 들썩이고 '깃 +N' 꼬리표
  steps.push({ at, step: 'land', ms: 200 });
  at += 200;
  if (options.unlock) {
    // 무대를 어둡게 덮고 새 소품 둘레만 밝힌다. 소품이 떨어져 두 번 통통 튄다
    steps.push({ at, step: 'spot', ms: 1000, cue: 'unlock', fades: { 'stage-dim': 300 } });
    at += 1000;
  }
  // 색종이 24조각
  steps.push({ at, step: 'confetti', ms: 500, cue: 'confetti' });
  at += 500;
  steps.push({ at, step: 'end', ms: 0 });
  return { name: options.unlock ? 'step-up-unlock' : 'step-up', steps, keyCue: 'step-up' };
}

export interface PromoteSceneOptions {
  /** 승진으로 모습이 바뀌는지(9→8·8→7·7→6·6→5 에 해당하는 형태 변화) */
  evolves: boolean;
}

/** 승진. 모습이 바뀌면 약 3.3초, 그대로면 약 1.7초 */
export function promoteScene(options: PromoteSceneOptions): Scene {
  if (!options.evolves) {
    return {
      name: 'promote',
      keyCue: 'promotion',
      steps: [
        { at: 0, step: 'open', ms: 300 },
        // 빛 모으기: 반짝이 20개가 몸으로 모인다
        { at: 300, step: 'gather', ms: 600, cue: 'promotion' },
        // 이름판이 새 표시로 바뀌며 통 튄다
        { at: 900, step: 'plate', ms: 200 },
        { at: 1100, step: 'confetti', ms: 600, cue: 'confetti' },
        { at: 1700, step: 'end', ms: 0 },
      ],
    };
  }
  return {
    name: 'promote-evolve',
    keyCue: 'evolve',
    steps: [
      // 대화상자가 열린다. 무대에는 옛 모습과 이름판
      { at: 0, step: 'open', ms: 300 },
      // 빛 모으기: 반짝이 20개, 외곽선이 금색으로 한 번만 바뀐다, 빛줄기가 천천히 돈다
      { at: 300, step: 'gather', ms: 600, cue: 'promotion', flips: ['outline-color'] },
      // 몸이 밝은 실루엣으로(한 번만, 되돌아가지 않는다). 300ms 넘게 서서히
      { at: 900, step: 'silhouette', ms: 400, fades: { 'body-fill': 400 } },
      // 녹아 바뀜: 옛 실루엣 픽셀이 사라지고 새 실루엣이 생긴다(섞은 순서로 8단계)
      { at: 1300, step: 'dissolve', ms: 800, cue: 'evolve', fades: { 'body-shape': 800 } },
      // 새 모습의 색이 위에서 아래로 돌아온다
      { at: 2100, step: 'reveal', ms: 400, fades: { 'body-fill': 400 } },
      // 깃 12·별 8이 퍼지고 이름판이 '옛 이름 → 새 이름'으로 바뀌며 통 튄다
      { at: 2500, step: 'burst', ms: 300, cue: 'confetti' },
      // 바뀐 곳 둘러보기: 화살표가 바뀐 부위를 차례로 가리킨다(많아야 두 곳)
      { at: 2800, step: 'tour', ms: 500 },
      { at: 3300, step: 'end', ms: 0 },
    ],
  };
}

/** 장면 종류마다의 시간표 견본(테스트가 번쩍임·짜임을 검사한다. 새 장면을 만들면 여기에도 더한다) */
export const SCENE_SAMPLES: readonly Scene[] = [
  hatchScene({ evolves: false }),
  hatchScene({ evolves: true }),
  stepUpScene({ steps: 1, unlock: false }),
  stepUpScene({ steps: 1, unlock: true }),
  stepUpScene({ steps: 12, unlock: true }),
  promoteScene({ evolves: false }),
  promoteScene({ evolves: true }),
];

/**
 * 장면을 재생한다. 단계마다 onStep 을 부르고 그 단계의 신호를 낸다.
 * 건너뛰기(Playback.skip)·움직임 줄이기면 'end' 만 실행하고, 지나친 대표 신호(keyCue)를 그때 낸다.
 * play 와 마찬가지로 첫 단계(와 줄이기일 때의 'end')는 부른 자리에서 바로 실행된다.
 */
export function playScene(
  scene: Scene,
  onStep: (step: SceneStep) => void,
  options: PlayOptions = {},
): Playback {
  let keySent = scene.keyCue === undefined;
  return play(
    scene.steps,
    (step) => {
      onStep(step);
      if (step.step === 'end' && !keySent && scene.keyCue && step.cue !== scene.keyCue) {
        keySent = true;
        emitCue(scene.keyCue);
      }
      if (step.cue) {
        if (step.cue === scene.keyCue) keySent = true;
        emitCue(step.cue);
      }
    },
    options,
  );
}
