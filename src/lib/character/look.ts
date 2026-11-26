/**
 * 형태(직급·계급 또는 재직 연수)·호봉·기분 → 어떤 부품을 겹쳐 그릴지 정한다(순수 함수).
 * 규칙은 data/character.json 에 있다.
 */
import { completedYears, type Ymd } from '../calc/date.ts';
import type { Ladder, LadderId, RankKey } from '../rules/types.ts';

export type MoodId =
  'work' | 'lunch' | 'off' | 'sleep' | 'vacation' | 'tired' | 'payday' | 'celebrate';

export interface FormRule {
  id: string;
  name: string;
  grades: number[];
  body: string;
  /** 이 형태만 쓰는 그림자(떠 있는 봉황 등). 없으면 규칙의 shadow */
  shadow?: string;
  blurb: string;
}

export interface TintRule {
  minStep: number;
  name: string;
  /** 팔레트 인덱스 치환(문자열 키) */
  remap: Record<string, number>;
}

export interface ItemRule {
  id: string;
  name: string;
  sprite: string;
  slot: string;
  minStep: number;
  blurb: string;
  tints?: TintRule[];
}

export interface EffectRule {
  id: string;
  name: string;
  sprite: string;
  minStep: number;
  blurb: string;
}

export interface MoodRule {
  label: string;
  eyes: string;
  items: string[];
  fx: string[];
  /** 이 기분일 때 숨길 소품 슬롯 */
  hide: string[];
}

/** 직종별 진화 규칙(#20). 일반직 사다리는 forms[].grades 를 그대로 쓴다 */
export interface EvolutionRules {
  /** 화면에 쓸 수 있는 설명. 법적 표현('상당'·조문 번호)을 넣지 않는다(#20 설계 §3.7) */
  note: string;
  /** 매핑 근거(개발용). 화면에 쓰지 않는다 */
  basis: string;
  /** 사다리(일반직 제외) → 계급 키 → 형태 id */
  byRank: Partial<Record<string, Record<string, string>>>;
  /** 사다리가 없거나(교원·준비 중 직종) byRank 에 없는 사다리: 재직 연수(fromYears 이상)로 */
  byTenure: { fromYears: number; form: string; label: string }[];
}

export interface CharacterRules {
  schema: 1;
  canvas: { w: number; h: number };
  palette: string[];
  paletteName: string;
  notes?: string[];
  forms: FormRule[];
  evolution: EvolutionRules;
  items: ItemRule[];
  effects: EffectRule[];
  shadow: string;
  eyes: { default: string; blink: string };
  moods: Record<MoodId, MoodRule>;
  tiredAfterDays: number;
  sleepHours: { from: number; to: number };
  egg: string;
}

export interface LookPart {
  sprite: string;
  remap?: Record<number, number>;
  /** 애니메이션 프레임이 있는 효과인지 */
  animated?: boolean;
}

export interface Look {
  form: FormRule;
  mood: MoodId;
  moodLabel: string;
  /** 몸통을 뺀 부품(그리는 순서는 스프라이트의 layer가 정한다) */
  parts: LookPart[];
  eyes: string;
  /** 깜빡임을 넣어도 되는 눈인지 */
  canBlink: boolean;
  /** 지금 걸치고 있는 호봉 소품(이름 표시용) */
  wearing: { id: string; name: string; tint: string | null }[];
}

/** 일반직 계급 키('1'~'9')의 형태(character.json forms 의 grades 는 직급 수) */
export function formFor(rules: CharacterRules, rank: RankKey | null): FormRule {
  const level = Number(rank);
  const form = rules.forms.find((f) => f.grades.includes(level));
  if (!form)
    throw new Error(`계급 키 '${String(rank)}'에 해당하는 형태가 character.json에 없습니다`);
  return form;
}

/** 형태 id 의 형태. 모르는 id(손상된 저장본·옛 데이터)면 첫 형태(알)로 그린다 */
export function formById(rules: CharacterRules, id: string): FormRule {
  const form = rules.forms.find((f) => f.id === id) ?? rules.forms[0];
  if (!form) throw new Error('character.json 에 형태가 없습니다');
  return form;
}

/** 형태 고르기의 입력: 계급 사다리와 계급, 재직 연수를 셀 임용일·오늘 */
export interface FormInput {
  ladderId: LadderId | null;
  rank: RankKey | null;
  hireDate: Ymd;
  today: Ymd;
}

/** 재직 연수로 고르는 단계(교원·사다리 없는 직종). 문턱(fromYears) 이상인 마지막 단계 */
export function tenureStage(
  rules: CharacterRules,
  hireDate: Ymd,
  today: Ymd,
): CharacterRules['evolution']['byTenure'][number] | null {
  const years = today < hireDate ? 0 : completedYears(hireDate, today);
  let stage: CharacterRules['evolution']['byTenure'][number] | null = null;
  for (const s of rules.evolution.byTenure) if (s.fromYears <= years) stage = s;
  return stage;
}

/**
 * 지금 형태의 id(#20 설계 §5.7).
 * 일반직 사다리는 forms[].grades, 그 밖의 사다리는 evolution.byRank, 거기에 없으면(교원·사다리 없는 직종·
 * 계급을 모름) 재직 연수(evolution.byTenure)로 고른다.
 */
export function formIdFor(rules: CharacterRules, input: FormInput): string {
  const { ladderId, rank } = input;
  if (ladderId === 'general' && rank !== null) {
    const form = rules.forms.find((f) => f.grades.includes(Number(rank)));
    if (form) return form.id;
  } else if (ladderId && rank !== null) {
    const id = rules.evolution.byRank[ladderId]?.[rank];
    if (id) return id;
  }
  const stage = tenureStage(rules, input.hireDate, input.today);
  return stage?.form ?? formById(rules, '').id;
}

/**
 * 도감에 적는 형태별 단계 이름(#20 설계 §5.7). 사용자의 사다리 기준이다.
 * - 사다리(일반직·우정·경찰·소방·외무): 그 형태가 되는 계급들 — '9급', '경위·경감', '우정6급~우정3급',
 *   마지막 형태는 '5급 이상'·'경정 이상'
 * - 사다리가 없거나 계급으로 자라지 않으면(교원·준비 중 직종): 재직 연수 — '교직 2년'·'재직 첫해'
 */
export function stageLabels(
  rules: CharacterRules,
  ladder: { id: LadderId | null; ladder: Pick<Ladder, 'ranks'> | null },
  tenureWord = '재직',
): Record<string, string> {
  const out: Record<string, string> = {};
  const { id, ladder: l } = ladder;
  const byRank = id && id !== 'general' ? rules.evolution.byRank[id] : undefined;
  if (l && id && (id === 'general' || byRank)) {
    const formOf = (key: RankKey) =>
      id === 'general'
        ? rules.forms.find((f) => f.grades.includes(Number(key)))?.id
        : byRank?.[key];
    const last = rules.forms[rules.forms.length - 1]?.id;
    for (const form of rules.forms) {
      const ranks = l.ranks.filter((r) => formOf(r.key) === form.id).map((r) => r.label);
      const first = ranks[0];
      if (first === undefined) out[form.id] = '';
      else if (ranks.length === 1) out[form.id] = first;
      else if (form.id === last) out[form.id] = `${first} 이상`;
      else if (ranks.length === 2) out[form.id] = ranks.join('·');
      else out[form.id] = `${first}~${ranks[ranks.length - 1] ?? ''}`;
    }
    return out;
  }
  for (const form of rules.forms) {
    const stage = rules.evolution.byTenure.find((s) => s.form === form.id);
    out[form.id] = stage ? `${tenureWord} ${stage.label}` : '';
  }
  return out;
}

/** 형태의 순서(forms 안의 위치). 모르는 id 면 -1 */
export function formIndex(rules: CharacterRules, id: string | null): number {
  return id === null ? -1 : rules.forms.findIndex((f) => f.id === id);
}

function toRemap(remap: Record<string, number>): Record<number, number> | undefined {
  const entries = Object.entries(remap).map(([from, to]) => [Number(from), to] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** 그 호봉에서 슬롯마다 붙는 소품(슬롯별로 minStep이 가장 큰 것) */
export function itemsAt(rules: CharacterRules, step: number): ItemRule[] {
  const bySlot = new Map<string, ItemRule>();
  for (const item of rules.items) {
    if (item.minStep > step) continue;
    const current = bySlot.get(item.slot);
    if (!current || item.minStep > current.minStep) bySlot.set(item.slot, item);
  }
  return [...bySlot.values()];
}

export function tintAt(item: ItemRule, step: number): TintRule | null {
  let best: TintRule | null = null;
  for (const tint of item.tints ?? []) {
    if (tint.minStep <= step && (!best || tint.minStep > best.minStep)) best = tint;
  }
  return best;
}

export function resolveLook(
  rules: CharacterRules,
  formId: string,
  step: number,
  mood: MoodId,
): Look {
  const form = formById(rules, formId);
  const moodRule = rules.moods[mood];
  const hidden = new Set(moodRule.hide);
  const parts: LookPart[] = [{ sprite: form.shadow ?? rules.shadow }];
  const wearing: Look['wearing'] = [];

  for (const item of itemsAt(rules, step)) {
    if (hidden.has(item.slot)) continue;
    const tint = tintAt(item, step);
    parts.push({ sprite: item.sprite, remap: tint ? toRemap(tint.remap) : undefined });
    wearing.push({ id: item.id, name: item.name, tint: tint?.name ?? null });
  }
  for (const sprite of moodRule.items) parts.push({ sprite });
  for (const effect of rules.effects) {
    if (effect.minStep <= step) parts.push({ sprite: effect.sprite, animated: true });
  }
  for (const sprite of moodRule.fx) parts.push({ sprite, animated: true });

  return {
    form,
    mood,
    moodLabel: moodRule.label,
    parts,
    eyes: moodRule.eyes,
    canBlink: moodRule.eyes === rules.eyes.default,
    wearing,
  };
}

export interface Unlock {
  step: number;
  /** '머그컵', '초록 줄' 등 */
  name: string;
  kind: 'item' | 'tint' | 'effect';
  blurb: string;
}

/** 호봉이 오르면서 열리는 것들(호봉순) */
export function unlockList(rules: CharacterRules): Unlock[] {
  const out: Unlock[] = [];
  for (const item of rules.items) {
    out.push({ step: item.minStep, name: item.name, kind: 'item', blurb: item.blurb });
    for (const tint of item.tints ?? []) {
      if (tint.minStep > item.minStep) {
        out.push({
          step: tint.minStep,
          name: tint.name,
          kind: 'tint',
          blurb: `${item.name}의 색이 바뀐다.`,
        });
      }
    }
  }
  for (const effect of rules.effects) {
    out.push({ step: effect.minStep, name: effect.name, kind: 'effect', blurb: effect.blurb });
  }
  return out.sort((a, b) => a.step - b.step);
}

/** 지금 호봉보다 뒤에 처음 열리는 것 */
export function nextUnlock(rules: CharacterRules, step: number): Unlock | null {
  return unlockList(rules).find((u) => u.step > step) ?? null;
}

export interface MoodInput {
  /** 오늘이 승급일이거나 임용 N주년 */
  celebrating: boolean;
  /** 오늘 쓴 연가 시간 */
  leaveHoursToday: number;
  /**
   * 지금 시각이 연가 구간인지(오전 반차는 오전에만, 오후 반차는 오후에만).
   * 주면 이것으로 판단하고, 없으면 오늘 연가가 반일 이상인지로 본다.
   */
  onLeaveNow?: boolean;
  halfDayHours: number;
  isPayday: boolean;
  /** 현지 시각의 시(0~23) */
  hour: number;
  phase: 'off' | 'before' | 'working' | 'lunch' | 'after';
  /** 마지막으로 연가를 쓴 뒤 지난 일수(기록이 없으면 null → 지친 모습을 하지 않는다) */
  daysSinceLeave: number | null;
  /** 남은 연가가 있는지(없으면 지친 모습을 하지 않는다) */
  hasLeaveLeft: boolean;
}

/** 무벌칙 원칙: 기분은 모습만 바꾸고 불이익을 주지 않는다 */
export function decideMood(rules: CharacterRules, input: MoodInput): MoodId {
  if (input.celebrating) return 'celebrate';
  if (input.onLeaveNow ?? input.leaveHoursToday >= input.halfDayHours) return 'vacation';
  const { from, to } = rules.sleepHours;
  const sleeping =
    from > to ? input.hour >= from || input.hour < to : input.hour >= from && input.hour < to;
  if (sleeping) return 'sleep';
  if (input.isPayday) return 'payday';
  if (input.phase === 'off' || input.phase === 'after' || input.phase === 'before') return 'off';
  if (input.phase === 'lunch') return 'lunch';
  if (
    input.hasLeaveLeft &&
    input.daysSinceLeave !== null &&
    input.daysSinceLeave >= rules.tiredAfterDays
  )
    return 'tired';
  return 'work';
}
