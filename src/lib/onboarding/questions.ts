/**
 * 말을 거는 첫 입력의 질문 차례(순수 계산).
 *
 * 차례: 닉네임 → 생년월일 → 임용일 → 직종 → (일반직) 봉급표 → (일반직) 직렬 → (소품이 있으면) 소품
 *      → (계급을 고르는 직종) 계급 → 호봉 → 다음 승급일 → 월급날 → 확인.
 * - 직종은 꼭 고른다(정년·봉급표·승진을 가르는 계산 값, #20 설계 §13). 직렬·소품만 건너뛸 수 있다.
 * - 진행 막대와 알의 금은 필수 칸만 센다. 직종에 따라 필수 칸 수가 달라진다(일반직 9, 경찰·소방 8, 교원 7).
 * - 소품 질문은 '직렬 공개는 개인 선택'을 첫 만남에서 바로 고르게 하는 자리다(부록 F14).
 *   특정직은 직종 소품이 있을 때, 일반직은 직렬을 골라 그 소품 테마가 있을 때만 묻는다.
 */
import type { ProfileErrors } from '../store/validate.ts';

export const QUESTION_IDS = [
  'nickname',
  'birthDate',
  'hireDate',
  'track',
  'payTable',
  'series',
  'prop',
  'rank',
  'step',
  'nextStepDate',
  'payday',
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

/** 건너뛸 수 있는(선택) 질문 */
export const OPTIONAL_QUESTIONS: readonly QuestionId[] = ['series', 'prop'];

export function isOptional(id: QuestionId): boolean {
  return OPTIONAL_QUESTIONS.includes(id);
}

/** 질문마다 맡는 검사 칸(checkProfile 의 키). 이 칸에 문제가 없어야 다음으로 넘어간다 */
export const QUESTION_KEYS: Readonly<Record<QuestionId, readonly (keyof ProfileErrors)[]>> = {
  nickname: ['nickname'],
  birthDate: ['birthDate'],
  hireDate: ['hireDate'],
  track: ['track'],
  payTable: ['payTable'],
  series: ['series'],
  prop: [],
  rank: ['rank', 'rankDate'],
  step: ['step'],
  nextStepDate: ['nextStepDate', 'longServiceDate', 'seniorDate', 'rankLimitDate'],
  payday: [],
};

/** 질문 차례를 정하는 초안의 모습(ProfileDraft 가 이 모양이다) */
export interface FlowInput {
  /** 고를 봉급표가 여럿인 직종인지(일반직 — 직종 데이터의 payTables) */
  askPayTable: boolean;
  /** 직렬을 고르는 직종인지(직종 데이터의 seriesScope — 일반직·지방 일반직) */
  askSeries: boolean;
  /** 계급을 고르는 직종인지(교원·사다리 없는 직종은 false) */
  askRank: boolean;
  /** 고른 직렬(없으면 null) */
  series: string | null;
  /** 지금 권할 소품이 있는지(특정직의 직종 소품, 직렬을 고르는 직종은 고른 직렬의 소품) */
  hasProp: boolean;
}

/** 지금 초안에서 물을 질문들(차례대로) */
export function questionsFor(input: FlowInput): QuestionId[] {
  return QUESTION_IDS.filter((id) => {
    if (id === 'payTable') return input.askPayTable;
    if (id === 'series') return input.askSeries;
    if (id === 'prop') return input.hasProp;
    if (id === 'rank') return input.askRank;
    return true;
  });
}

/** 필수 질문만 */
export function requiredOf(list: readonly QuestionId[]): QuestionId[] {
  return list.filter((id) => !isOptional(id));
}

export interface Progress {
  /** 필수 칸 수 */
  total: number;
  /** 답한 필수 칸 수 */
  done: number;
  /** 남은 필수 칸 수 */
  left: number;
}

/** 답한 질문 묶음에서 진행을 센다(지금 차례에 없는 질문의 답은 세지 않는다) */
export function progressOf(
  list: readonly QuestionId[],
  answered: ReadonlySet<QuestionId>,
): Progress {
  const required = requiredOf(list);
  const done = required.filter((id) => answered.has(id)).length;
  return { total: required.length, done, left: required.length - done };
}

/** 그 질문이 맡은 칸에 문제가 있으면 그 문구들(차례대로) */
export function problemsOf(id: QuestionId, errors: ProfileErrors): string[] {
  return QUESTION_KEYS[id].flatMap((key) => {
    const text = errors[key];
    return text ? [text] : [];
  });
}

/** 문제가 있는 첫 질문(확인 단계에서 '알 깨우기'를 눌렀을 때 데려갈 곳). 없으면 null */
export function firstProblem(
  list: readonly QuestionId[],
  errors: ProfileErrors,
): QuestionId | null {
  return list.find((id) => problemsOf(id, errors).length > 0) ?? null;
}

/** checkProfile 의 키 가운데 질문이 맡지 않는 것(화면에 칸이 없는 값) */
export function uncoveredKeys(errors: ProfileErrors): string[] {
  const covered = new Set<string>(Object.values(QUESTION_KEYS).flat());
  return Object.keys(errors).filter((key) => !covered.has(key));
}
