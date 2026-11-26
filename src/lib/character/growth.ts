/**
 * 승급·성장 연출을 띄울지 정한다(순수 함수, #20 설계 §5.8).
 *
 * - 같은 계급에서 호봉만 오름 → 승급 연출('step').
 * - 같은 사다리에서 계급 순서가 오르거나, 형태(forms)의 순서가 오름 → 성장 연출('grow').
 *   교원·사다리 없는 직종은 재직 연수로 형태가 바뀐다.
 * - 형태 순서가 내려감(character.json 의 문턱·매핑을 다음 판에서 고친 경우 등) → 호봉·계급이 올랐어도
 *   연출 없이 지금 값으로 기록.
 * - 마지막 형태를 모름(null: 막 변환된 v3 데이터·새 사용자, 또는 모르는 id) → 형태·계급 연출 없이 기록.
 *   같은 계급에서 호봉만 오른 승급 연출은 한다(형태 변화는 그리지 않는다).
 * - 호봉이 내려감, 계급이 바뀜(순서가 오르지 않음) → 연출 없이 지금 값으로 기록.
 */
import { formIndex, type CharacterRules } from './look.ts';
import type { LadderRank, RankKey } from '../rules/types.ts';

export interface GrowthMark {
  rank: RankKey | null;
  step: number;
  form: string | null;
}

export type GrowthDecision =
  | { kind: 'step' | 'grow' }
  /** 연출 없이 지금 값으로 기록한다 */
  | { kind: 'record' }
  /** 바뀐 것이 없다 */
  | { kind: 'none' };

export function decideGrowth(
  rules: CharacterRules,
  last: GrowthMark,
  now: GrowthMark & { form: string },
  /** 지금 계급의 사다리(낮은 계급부터). 없으면 계급 순서는 보지 않는다 */
  ladder: readonly LadderRank[] | null,
): GrowthDecision {
  if (last.rank === now.rank && last.step === now.step && last.form === now.form) {
    return { kind: 'none' };
  }
  const lastFormIndex = formIndex(rules, last.form);
  const nowFormIndex = formIndex(rules, now.form);
  const stepUp = last.rank === now.rank && now.step > last.step;
  // 마지막 형태를 모르면(null: 막 변환된 v3 데이터, 또는 모르는 id) 형태·계급 연출은 하지 않는다.
  // 같은 계급에서 호봉이 오른 승급 연출만 한다(출발 형태를 지금 형태로 그려 형태 변화를 그리지 않는다) —
  // v3 에서 넘어온 사용자가 변환 직후에 받을 승급 연출을 잃지 않게(설계 §5.8).
  if (lastFormIndex < 0 || nowFormIndex < 0) return { kind: stepUp ? 'step' : 'record' };
  // 형태 순서가 내려가면 호봉·계급이 올랐어도 연출 없이 기록만(승급 연출에서 '작아지는' 모습을 그리지 않는다).
  if (nowFormIndex < lastFormIndex) return { kind: 'record' };
  const formUp = nowFormIndex > lastFormIndex;
  if (stepUp) return { kind: formUp ? 'grow' : 'step' };
  if (formUp) return { kind: 'grow' };
  if (ladder && last.rank !== null && now.rank !== null && last.rank !== now.rank) {
    const from = ladder.findIndex((r) => r.key === last.rank);
    const to = ladder.findIndex((r) => r.key === now.rank);
    if (from >= 0 && to > from) return { kind: 'grow' };
  }
  return { kind: 'record' };
}
