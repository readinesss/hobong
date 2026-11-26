/**
 * 직급·호봉·기분 → 어떤 부품을 겹쳐 그릴지 정한다(순수 함수).
 * 규칙은 data/character.json 에 있다.
 */
import type { Grade } from '../store/schema.ts';

export type MoodId =
  'work' | 'lunch' | 'off' | 'sleep' | 'vacation' | 'tired' | 'payday' | 'celebrate';

export interface FormRule {
  id: string;
  name: string;
  grades: number[];
  body: string;
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

export interface CharacterRules {
  schema: 1;
  canvas: { w: number; h: number };
  palette: string[];
  paletteName: string;
  notes?: string[];
  forms: FormRule[];
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

export function formFor(rules: CharacterRules, grade: Grade): FormRule {
  const form = rules.forms.find((f) => f.grades.includes(grade));
  if (!form) throw new Error(`${grade}급에 해당하는 형태가 character.json에 없습니다`);
  return form;
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

export function resolveLook(rules: CharacterRules, grade: Grade, step: number, mood: MoodId): Look {
  const form = formFor(rules, grade);
  const moodRule = rules.moods[mood];
  const hidden = new Set(moodRule.hide);
  const parts: LookPart[] = [{ sprite: rules.shadow }];
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
