/**
 * 꾸미기 화면(#17)이 쓰는 순수 함수: 낭독용 이름, '아무거나', 어느 형태부터 색이 보이는지.
 * 그림 규칙은 look.ts·regions.ts 에 있고, 여기서는 그 결과를 사람이 읽을 말로 바꾸기만 한다.
 */
import { josa, withRo } from '../app/format.ts';
import { defaultLook } from '../store/defaults.ts';
import type { CharacterLook } from '../store/schema.ts';
import {
  HAND_SLOT,
  type CharacterRules,
  type FormRule,
  type Look,
  type PaintRule,
  type ResolvedCustom,
} from './look.ts';
import { PLAIN_PAINT, recolorBody, REGION, regionsOf, type BodyPaint } from './regions.ts';
import { getSprite } from './sprites.ts';

/** 깃 이름: '오색' → '오색 깃', '숲 깃' → '숲 깃' */
export function plumeName(plume: Pick<PaintRule, 'name'>): string {
  return plume.name.endsWith('깃') ? plume.name : `${plume.name} 깃`;
}

/** 볏 이름: '파랑' → '파랑 볏' */
export function crestName(crest: Pick<PaintRule, 'name'>): string {
  return `${crest.name} 볏`;
}

function numeric(remap: Record<string, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(remap)) out[Number(k)] = v;
  return out;
}

/** 이 칠이 그 형태의 몸통 그림을 한 칸이라도 바꾸는지 */
function paints(form: FormRule, paint: BodyPaint): boolean {
  const body = getSprite(form.body);
  if (!body) return false;
  const out = recolorBody(body, paint);
  return out.frames.some((frame, f) => frame.some((v, i) => v !== body.frames[f]?.[i]));
}

let shownCache: { rules: CharacterRules; value: PaintShownFrom } | null = null;

export interface PaintShownFrom {
  /** 볏 색이 처음 보이는 형태(깃봉이). 어느 형태에도 안 보이면 null */
  crest: FormRule | null;
  /** 깃 색이 처음 보이는 형태(날봉이) */
  plume: FormRule | null;
}

/**
 * 볏·깃 색이 어느 형태부터 그림에 드러나는지. 그림(영역 판정)에서 직접 센다 — 몸통 그림이 바뀌어도
 * 화면 설명('볏은 깃봉이부터 보여요')이 그림과 어긋나지 않게.
 */
export function paintShownFrom(rules: CharacterRules): PaintShownFrom {
  if (shownCache?.rules === rules) return shownCache.value;
  const firstWith = (key: 'crest' | 'plume', list: PaintRule[]) =>
    rules.forms.find((form) =>
      list.some(
        (p) =>
          Object.keys(p.remap).length > 0 &&
          paints(form, { ...PLAIN_PAINT, [key]: numeric(p.remap) }),
      ),
    ) ?? null;
  const value = {
    crest: firstWith('crest', rules.custom.crests),
    plume: firstWith(
      'plume',
      rules.custom.plumes.filter((p) => p.id !== 'auto'),
    ),
  };
  shownCache = { rules, value };
  return value;
}

function formAtOrAfter(rules: CharacterRules, form: FormRule, from: FormRule | null): boolean {
  if (!from) return false;
  const i = rules.forms.findIndex((f) => f.id === form.id);
  const j = rules.forms.findIndex((f) => f.id === from.id);
  return i >= 0 && j >= 0 && i >= j;
}

/** 단 장식 이름들: '꽃핀·별 배지·볼 터치' */
export function decoNames(custom: Pick<ResolvedCustom, 'pin' | 'chest' | 'cheek'>): string[] {
  return [custom.pin, custom.chest, custom.cheek].flatMap((d) => (d ? [d.name] : []));
}

/**
 * 미리보기 낭독 이름(설계 a11y): '하늘 몸, 파랑 볏, 꽃핀을 단 깃봉이'.
 * 그 형태에서 보이지 않는 볏·깃 색은 말하지 않는다(보이는 그림과 낭독이 같게).
 * 손 소품은 직렬 이름이 아니라 소품 이름만 말한다. 호봉 소품(결재판)을 들고 있으면 그것도 말한다.
 * 장식·소품이 없으면 마지막 꾸밈말에 '을/를 한'을 붙여 형태 이름과 잇는다('…, 오색 깃을 한 날봉이').
 */
export function lookName(
  rules: CharacterRules,
  look: Pick<Look, 'custom' | 'form'> & Partial<Pick<Look, 'wearing'>>,
): string {
  const { custom, form } = look;
  const shown = paintShownFrom(rules);
  const parts = [`${custom.body.name} 몸`];
  if (formAtOrAfter(rules, form, shown.crest)) parts.push(crestName(custom.crest));
  if (formAtOrAfter(rules, form, shown.plume)) parts.push(plumeName(custom.plume));
  const decos = decoNames(custom);
  const tail: string[] = [];
  if (decos.length > 0) tail.push(`${josa(decos.join('·'), '을', '를')} 단`);
  const held =
    custom.prop?.name ??
    look.wearing?.find((w) => rules.items.some((i) => i.id === w.id && i.slot === HAND_SLOT))?.name;
  if (held) tail.push(`${josa(held, '을', '를')} 든`);
  if (tail.length === 0 && parts.length > 1) {
    const last = parts.pop() as string;
    return `${[...parts, `${josa(last, '을', '를')} 한`].join(', ')} ${form.name}`;
  }
  return `${parts.join(', ')}${tail.length > 0 ? `, ${tail.join(', ')}` : ''} ${form.name}`;
}

/** '아무거나' 결과 알림: '노을 몸, 보라 볏, 숲 깃, 별핀으로 바꿨어요.' */
export function lookChangeText(custom: ResolvedCustom): string {
  const words = [
    `${custom.body.name} 몸`,
    crestName(custom.crest),
    custom.plumeAuto ? `알아서 고른 ${plumeName(custom.plume)}` : plumeName(custom.plume),
    ...decoNames(custom),
  ];
  const last = words.pop() as string;
  return `${[...words, withRo(last)].join(', ')} 바꿨어요.`;
}

/** 두 꾸미기가 같은지(저장본 비교·'아무거나' 다시 뽑기) */
export function sameLook(a: CharacterLook, b: CharacterLook): boolean {
  return (
    a.body === b.body &&
    a.crest === b.crest &&
    a.plume === b.plume &&
    a.prop === b.prop &&
    a.deco.pin === b.deco.pin &&
    a.deco.chest === b.deco.chest &&
    a.deco.cheek === b.deco.cheek
  );
}

/** 0 이상 n 미만의 고른 정수. crypto.getRandomValues 로 뽑고, 치우침이 없게 남는 값은 다시 뽑는다 */
export function cryptoInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0) return 0;
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] as number;
    if (v < limit) return v % n;
  }
}

const clashCache = new WeakMap<CharacterRules, Map<string, boolean>>();

/**
 * 이 깃 색이 이 몸 색과 겹치는지: 깃 색이 보이는 형태(날봉이·봉황)의 깃 영역에 몸 바탕·그늘과 같은 색이 남으면
 * 날개가 몸에 묻혀 실루엣이 뭉개진다('알아서' 깃이 피하는 짝과 같은 기준, character-custom.test.ts).
 * '알아서'는 늘 겹치지 않는다. 모르는 id 는 겹치지 않는다고 본다.
 */
export function plumeClashes(rules: CharacterRules, bodyId: string, plumeId: string): boolean {
  if (plumeId === 'auto') return false;
  let byKey = clashCache.get(rules);
  if (!byKey) {
    byKey = new Map();
    clashCache.set(rules, byKey);
  }
  const key = `${bodyId}/${plumeId}`;
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const body = rules.custom.bodies.find((b) => b.id === bodyId);
  const plume = rules.custom.plumes.find((p) => p.id === plumeId);
  let clash = false;
  if (body && plume) {
    const own = new Set([body.remap['4'] ?? 4, body.remap['3'] ?? 3]);
    const paint: BodyPaint = {
      ...PLAIN_PAINT,
      body: numeric(body.remap),
      plume: numeric(plume.remap),
    };
    const from = paintShownFrom(rules).plume;
    for (const form of rules.forms) {
      if (!formAtOrAfter(rules, form, from)) continue;
      const sprite = getSprite(form.body);
      if (!sprite) continue;
      const out = recolorBody(sprite, paint).frames[0] as Uint8Array;
      const reg = regionsOf(sprite);
      if (reg.some((r, i) => r === REGION.PLUME && own.has(out[i] as number))) clash = true;
    }
  }
  byKey.set(key, clash);
  return clash;
}

/**
 * '아무거나'(설계 options): 몸 색·볏·깃·장식만 무작위로 바꾸고 손 소품은 그대로 둔다(소품은 일과 이어진 선택).
 * 깃은 뽑은 몸 색과 겹치지 않는 것('알아서' 포함) 가운데서 뽑는다(plumeClashes).
 * 지금과 같은 조합이 나오면 다시 뽑는다. random(n) 은 0 이상 n 미만의 정수를 준다(시험에서 바꿔 끼운다).
 */
export function randomLook(
  rules: CharacterRules,
  current: CharacterLook,
  random: (n: number) => number = cryptoInt,
): CharacterLook {
  const c = rules.custom;
  const pick = <T>(list: readonly T[]): T => list[random(list.length)] as T;
  const pins = [null, ...c.decos.filter((d) => d.slot === 'pin').map((d) => d.id)];
  const chests = [null, ...c.decos.filter((d) => d.slot === 'chest').map((d) => d.id)];
  const hasCheek = c.decos.some((d) => d.slot === 'cheek');
  for (let i = 0; i < 32; i += 1) {
    const body = pick(c.bodies).id;
    const plumes = c.plumes.filter((p) => !plumeClashes(rules, body, p.id));
    const next: CharacterLook = {
      body,
      crest: pick(c.crests).id,
      plume: pick(plumes.length > 0 ? plumes : c.plumes).id,
      deco: {
        pin: pick(pins),
        chest: pick(chests),
        cheek: hasCheek ? pick([false, true]) : false,
      },
      prop: current.prop,
    };
    if (!sameLook(next, current)) return next;
  }
  // 고를 것이 하나뿐인 규칙(시험용)에서 끝없이 돌지 않게
  return { ...defaultLook(), prop: current.prop };
}
