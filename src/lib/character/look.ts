/**
 * 형태(직급·계급 또는 재직 연수)·호봉·기분 → 어떤 부품을 겹쳐 그릴지 정한다(순수 함수).
 * 규칙은 data/character.json 에 있다.
 */
import { completedYears, type Ymd } from '../calc/date.ts';
import type { Ladder, LadderId, RankKey, TrackId } from '../rules/types.ts';
import { DEFAULT_LOOK } from '../store/defaults.ts';
import type { CharacterLook } from '../store/schema.ts';
import { chainRemap, PLAIN_PAINT, type BodyPaint } from './regions.ts';

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

/** 몸 색(custom.bodies). remap 은 몸 영역의 4·3 치환 */
export interface BodyRule {
  id: string;
  name: string;
  remap: Record<string, number>;
  /** '알아서' 깃의 id(custom.plumes) */
  autoPlume: string;
  /** 부리·볼 색(없으면 그림 그대로 3) */
  face?: { beak?: number; cheek?: number };
  /** 날봉이·봉황 흰 가슴털(c) 색(없으면 그대로). 흰 몸에서 가슴털이 묻히지 않게 */
  chest?: number;
  /** 이 몸 색에서만 소품 색을 한 번 더 바꾼다(스프라이트 이름 → 치환). 틴트 다음에 적용 */
  itemRemap?: Record<string, Record<string, number>>;
  /** 이 몸 색에서만 장식 색을 바꾼다(스프라이트 이름 → 치환) */
  decoRemap?: Record<string, Record<string, number>>;
  /** 개발용 메모(화면에 쓰지 않는다) */
  note?: string;
}

/** 볏 색·깃 색(custom.crests·plumes) */
export interface PaintRule {
  id: string;
  name: string;
  remap: Record<string, number>;
}

export type DecoSlot = 'pin' | 'chest' | 'cheek';

export interface DecoRule {
  id: string;
  slot: DecoSlot;
  name: string;
  sprite: string;
}

/** 왼손 소품(custom.props). kind 'series' 는 일반직 직렬 테마(data/series.json), 'track' 은 특정직 */
export interface PropRule {
  id: string;
  name: string;
  sprite: string;
  kind: 'series' | 'track';
  /** 'auto' 일 때 이 소품을 드는 직종 */
  tracks?: TrackId[];
}

export interface CustomRules {
  notes?: string[];
  bodies: BodyRule[];
  crests: PaintRule[];
  plumes: PaintRule[];
  decos: DecoRule[];
  props: PropRule[];
  /** 기분이 이 슬롯(moods[].hide)을 숨기면 그 장식·소품도 숨긴다 */
  hide: Record<DecoSlot | 'prop', string[]>;
  /** 손 소품 테두리 빛(팔레트 인덱스). 날개·꼬리 위에 겹친 칸에만 칠한다(compose.ts Layer.halo) */
  propHalo?: number;
}

export interface CharacterRules {
  schema: 2;
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
  custom: CustomRules;
}

export interface LookPart {
  sprite: string;
  remap?: Record<number, number>;
  /** 애니메이션 프레임이 있는 효과인지 */
  animated?: boolean;
  /** 테두리 빛 색(compose.ts Layer.halo). 손 소품이 날개·꼬리에 묻히지 않게 */
  halo?: number;
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
  /**
   * 지금 걸치고 있는 호봉 소품과 손에 든 소품(이름 표시용). 직렬 이름은 넣지 않는다
   * (직렬 이름은 사용자가 켠 곳에서만 보인다).
   */
  wearing: { id: string; name: string; tint: string | null }[];
  /** 몸통에 칠할 색(regions.ts recolorBody). 기본 모습은 아무것도 바꾸지 않는다 */
  paint: BodyPaint;
  /** 실제로 그린 꾸미기(모르는 id 는 기본값으로 바뀐 뒤). 미리보기 이름·낭독에 쓴다 */
  custom: ResolvedCustom;
}

/** 꾸미기 해석 결과 */
export interface ResolvedCustom {
  body: BodyRule;
  crest: PaintRule;
  /** 실제로 칠한 깃(고른 것이 '알아서'면 몸 색이 정한 깃) */
  plume: PaintRule;
  /** 고른 값이 '알아서'였는지 */
  plumeAuto: boolean;
  pin: DecoRule | null;
  chest: DecoRule | null;
  cheek: DecoRule | null;
  /** 손에 든 소품. 호봉 소품(결재판)을 들거나 아무것도 안 들면 null */
  prop: PropRule | null;
}

/** 'auto' 소품을 고를 때 쓰는 사용자 정보. 직렬 이름이 아니라 그 테마 id 만 받는다(series.ts propOwnerOf) */
export interface PropOwner {
  track?: TrackId | null;
  /** 일반직이 고른 직렬의 소품 테마(custom.props 의 id). 고르지 않았으면 null */
  theme?: string | null;
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

function byId<T extends { id: string }>(list: readonly T[], id: string | null): T | undefined {
  return id === null ? undefined : list.find((x) => x.id === id);
}

function first<T>(list: readonly T[], what: string): T {
  const x = list[0];
  if (!x) throw new Error(`character.json custom.${what} 이 비어 있습니다`);
  return x;
}

function numericRemap(remap: Record<string, number> | undefined): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [from, to] of Object.entries(remap ?? {})) out[Number(from)] = to;
  return out;
}

/**
 * 손에 들 소품. 'step' = 호봉 소품 규칙 그대로(9호봉부터 결재판), null = 들지 않음.
 * - 'none': 들지 않는다
 * - 목록의 id: 그 소품
 * - 'auto': 일반직이 직렬을 골랐으면 그 테마 소품, 그 밖(직렬을 고르지 않음·특정직)은 호봉 소품.
 *   특정직의 직종 소품(손전등 등)은 사용자가 직접 고를 때만 든다 — 직종은 계산에 꼭 고르는 값이라
 *   기본 모습이 직종을 드러내지 않게 하고(카드 '계급 이름 넣기'가 기본으로 꺼진 것과 같은 까닭),
 *   v4 저장본을 옮겨도 모습이 그대로이게 한다(부록 F).
 * - 모르는 id(새 버전에서 고름): 호봉 소품. 직렬 정보를 쓰지 않는다 — 새 버전에서 직렬이 드러나지 않게
 *   일부러 고른 소품이 예전 사본에서 직렬 소품으로 바뀌지 않게.
 */
export function resolveProp(
  rules: CharacterRules,
  prop: string,
  owner: PropOwner = {},
): PropRule | 'step' | null {
  const { props } = rules.custom;
  if (prop === 'none') return null;
  if (prop !== 'auto') return byId(props, prop) ?? 'step';
  if ((owner.track ?? 'general') !== 'general') return 'step';
  return (owner.theme ? byId(props, owner.theme) : undefined) ?? 'step';
}

/** 그 직종의 소품(custom.props 의 tracks). 고르는 칸에서 알려 주기만 하고 'auto' 로는 들지 않는다 */
export function trackPropOf(
  rules: CharacterRules,
  track: TrackId | null | undefined,
): PropRule | null {
  if (!track || track === 'general') return null;
  return (
    rules.custom.props.find((p) => p.kind === 'track' && (p.tracks ?? []).includes(track)) ?? null
  );
}

/** 손 소품을 들고 있어 호봉 소품(왼손, 9호봉부터 결재판)을 들지 않는지 */
export function holdsOwnProp(
  rules: CharacterRules,
  look: Pick<CharacterLook, 'prop'>,
  owner: PropOwner = {},
): boolean {
  return resolveProp(rules, look.prop, owner) !== 'step';
}

/** 꾸미기 값을 규칙에 맞춰 푼다. 모르는 id 는 기본값(DEFAULT_LOOK, 없으면 목록의 첫 항목)으로 */
export function resolveCustom(
  rules: CharacterRules,
  look: CharacterLook,
  owner: PropOwner = {},
): { custom: ResolvedCustom; propMode: PropRule | 'step' | null; paint: BodyPaint } {
  const c = rules.custom;
  const body =
    byId(c.bodies, look.body) ?? byId(c.bodies, DEFAULT_LOOK.body) ?? first(c.bodies, 'bodies');
  const crest =
    byId(c.crests, look.crest) ?? byId(c.crests, DEFAULT_LOOK.crest) ?? first(c.crests, 'crests');
  const chosenPlume = byId(c.plumes, look.plume);
  const plumeAuto = !chosenPlume || chosenPlume.id === 'auto';
  const plume =
    (plumeAuto ? byId(c.plumes, body.autoPlume) : chosenPlume) ??
    first(
      c.plumes.filter((p) => p.id !== 'auto'),
      'plumes',
    );
  const deco = (slot: DecoSlot, id: string | null) =>
    c.decos.find((d) => d.slot === slot && d.id === id) ?? null;
  const cheek = look.deco.cheek ? (c.decos.find((d) => d.slot === 'cheek') ?? null) : null;
  const propMode = resolveProp(rules, look.prop, owner);
  const paint: BodyPaint =
    Object.keys(body.remap).length === 0 &&
    Object.keys(crest.remap).length === 0 &&
    Object.keys(plume.remap).length === 0 &&
    body.face === undefined &&
    body.chest === undefined
      ? PLAIN_PAINT
      : {
          body: numericRemap(body.remap),
          crest: numericRemap(crest.remap),
          plume: numericRemap(plume.remap),
          beak: body.face?.beak ?? null,
          cheek: body.face?.cheek ?? null,
          chest: body.chest ?? null,
        };
  return {
    custom: {
      body,
      crest,
      plume,
      plumeAuto,
      pin: deco('pin', look.deco.pin),
      chest: deco('chest', look.deco.chest),
      cheek,
      prop: propMode === 'step' ? null : propMode,
    },
    propMode,
    paint,
  };
}

/**
 * 형태·호봉·기분·꾸미기 → 겹쳐 그릴 부품.
 *
 * 슬롯 규칙(설계 rendering §5, 위가 먼저)
 * - 기분이 숨기는 슬롯(moods[].hide)이 가장 세다. custom.hide 가 장식·소품을 어느 슬롯과 함께 숨길지 정한다
 *   (가슴 배지는 'neck' — 꽃목걸이와 겹쳐 지저분하다, 머리핀은 'head' — 모자 챙 아래로 삐져나온다, 소품은 'handL').
 *   볼 터치는 늘 보인다(안경이 위 층이라 겹쳐도 안경이 이긴다).
 * - 왼손(handL)에는 하나만 든다. 소품이 정해지면 호봉 소품(결재판)은 들지 않는다(홈의 다음 소품·'새로 생김'에서도 빼고, 도감에는 조건을 단다).
 * - 금빛 깃(20호봉)은 볏 상자를 덮는다. 볏 색은 금빛 깃이 없을 때만 보인다.
 * - 몸 색마다 itemRemap(소품)·decoRemap(장식)을 소품 틴트 다음에 한 번 더 적용한다.
 */
export function resolveLook(
  rules: CharacterRules,
  formId: string,
  step: number,
  mood: MoodId,
  look: CharacterLook = DEFAULT_LOOK,
  owner: PropOwner = {},
): Look {
  const form = formById(rules, formId);
  const moodRule = rules.moods[mood];
  const hidden = new Set(moodRule.hide);
  const { custom, propMode, paint } = resolveCustom(rules, look, owner);
  const hiddenWith = (slot: DecoSlot | 'prop') =>
    (rules.custom.hide[slot] ?? []).some((s) => hidden.has(s));
  const itemFix = (sprite: string) => custom.body.itemRemap?.[sprite];
  const decoFix = (sprite: string) => custom.body.decoRemap?.[sprite];
  const parts: LookPart[] = [{ sprite: form.shadow ?? rules.shadow }];
  const wearing: Look['wearing'] = [];

  for (const item of itemsAt(rules, step)) {
    if (hidden.has(item.slot)) continue;
    // 소품을 정했으면(또는 들지 않기면) 왼손의 호봉 소품은 들지 않는다
    if (item.slot === 'handL' && propMode !== 'step') continue;
    const tint = tintAt(item, step);
    const fix = itemFix(item.sprite);
    const remap = chainRemap(tint ? toRemap(tint.remap) : undefined, fix && numericRemap(fix));
    parts.push({ sprite: item.sprite, remap });
    wearing.push({ id: item.id, name: item.name, tint: tint?.name ?? null });
  }
  const prop = custom.prop;
  if (prop && !hiddenWith('prop')) {
    const fix = itemFix(prop.sprite);
    parts.push({
      sprite: prop.sprite,
      remap: chainRemap(undefined, fix && numericRemap(fix)),
      // 호봉 소품과 같은 그림(결재판을 직접 고름)은 기본 모습과 같게 그린다
      halo: rules.items.some((i) => i.sprite === prop.sprite) ? undefined : rules.custom.propHalo,
    });
    wearing.push({ id: prop.id, name: prop.name, tint: null });
  }
  for (const [slot, deco] of [
    ['pin', custom.pin],
    ['chest', custom.chest],
    ['cheek', custom.cheek],
  ] as const) {
    if (!deco || hiddenWith(slot)) continue;
    const fix = decoFix(deco.sprite);
    parts.push({ sprite: deco.sprite, remap: chainRemap(undefined, fix && numericRemap(fix)) });
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
    paint,
    custom,
  };
}

export interface Unlock {
  step: number;
  /** '머그컵', '초록 줄' 등 */
  name: string;
  kind: 'item' | 'tint' | 'effect';
  blurb: string;
  /** 소품·색이 붙는 자리(효과는 null). 왼손('handL')은 손 소품을 들면 비어 있지 않다 */
  slot: string | null;
}

/** 손 소품을 들고 있으면 열려도 보이지 않는 자리 */
export const HAND_SLOT = 'handL';

/**
 * 호봉이 오르면서 열리는 것들(호봉순).
 * handHeld(손 소품을 듦)이면 왼손 호봉 소품(결재판)을 뺀다 — 들지 않을 것을 '새 소품'으로 약속하지 않게.
 */
export function unlockList(rules: CharacterRules, handHeld = false): Unlock[] {
  const out: Unlock[] = [];
  for (const item of rules.items) {
    if (handHeld && item.slot === HAND_SLOT) continue;
    out.push({
      step: item.minStep,
      name: item.name,
      kind: 'item',
      blurb: item.blurb,
      slot: item.slot,
    });
    for (const tint of item.tints ?? []) {
      if (tint.minStep > item.minStep) {
        out.push({
          step: tint.minStep,
          name: tint.name,
          kind: 'tint',
          blurb: `${item.name}의 색이 바뀐다.`,
          slot: item.slot,
        });
      }
    }
  }
  for (const effect of rules.effects) {
    out.push({
      step: effect.minStep,
      name: effect.name,
      kind: 'effect',
      blurb: effect.blurb,
      slot: null,
    });
  }
  return out.sort((a, b) => a.step - b.step);
}

/** 지금 호봉보다 뒤에 처음 열리는 것(handHeld 는 unlockList 와 같다) */
export function nextUnlock(rules: CharacterRules, step: number, handHeld = false): Unlock | null {
  return unlockList(rules, handHeld).find((u) => u.step > step) ?? null;
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
