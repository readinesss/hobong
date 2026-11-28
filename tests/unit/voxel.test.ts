/**
 * 호봉이 360°(#22) 복셀 생성기 — 브라우저 없이 확인한다.
 * - 정면 일치: 형태 5 × 대표 조합의 앞모습 실루엣이 2D 와 겹친다(IoU: 봉황 0.90, 그 밖 0.97 이상)
 * - 색: 복셀·얼굴 도장의 색 번호가 팔레트(Sweetie 16) 안
 * - 나눠 만들기: generateSteps 의 단계 수와 단계별 시간 상한(넉넉하게), modelJob 의 캐시
 * - 소품: 손 소품·호봉 소품·장식·기분 소품이 모두 복셀(또는 얼굴 도장)을 남긴다. 표에 없는 새 소품도 붙는다
 * - 꾸미기: 몸·볏·깃 색이 옆·뒤 복셀에도 먹는다. 봉황 꼬리는 어떤 깃 색에서도 2D 꼬리와 같은 계열
 */
import { describe, expect, it } from 'vitest';
import { resolveLook, type MoodId } from '../../src/lib/character/look.ts';
import { characterRules as rules } from '../../src/lib/character/rules.ts';
import { DEFAULT_LOOK } from '../../src/lib/store/defaults.ts';
import type { CharacterLook } from '../../src/lib/store/schema.ts';
import { faceFront } from '../../src/lib/character/voxel/face.ts';
import { voxelInput, voxelKey } from '../../src/lib/character/voxel/from-look.ts';
import {
  frontCheck,
  generate,
  generateSteps,
  STEP_COUNT,
  type VoxelResult,
} from '../../src/lib/character/voxel/generate.ts';
import { STRIDE, TR, W } from '../../src/lib/character/voxel/kit.ts';
import { buildMesh } from '../../src/lib/character/voxel/mesh.ts';
import {
  buildModel,
  cachedModel,
  clearModels,
  modelJob,
} from '../../src/lib/character/voxel/model.ts';
import { grooveOf } from '../../src/lib/character/voxel/forms/phoenix.ts';
import { SHAPES } from '../../src/lib/character/voxel/props.ts';
import { RAMP } from '../../src/lib/character/voxel/kit.ts';
import type { VoxelInput } from '../../src/lib/character/voxel/input.ts';

const FORMS = ['egg', 'chick', 'fledgling', 'bird', 'phoenix'] as const;
type Form = (typeof FORMS)[number];
interface Spec {
  form: Form;
  step?: number;
  mood?: MoodId;
  look?: Partial<Omit<CharacterLook, 'deco'>> & { deco?: Partial<CharacterLook['deco']> };
}

function lookOf(s: Spec) {
  const look: CharacterLook = {
    ...DEFAULT_LOOK,
    ...s.look,
    deco: { ...DEFAULT_LOOK.deco, ...s.look?.deco },
  };
  return resolveLook(rules, s.form, s.step ?? 0, s.mood ?? 'work', look);
}
function inputOf(s: Spec): VoxelInput {
  const input = voxelInput(lookOf(s));
  if (!input) throw new Error(`입력 없음: ${JSON.stringify(s)}`);
  return input;
}
const made = new Map<string, { input: VoxelInput; res: VoxelResult }>();
function make(s: Spec) {
  const key = JSON.stringify(s);
  let m = made.get(key);
  if (!m) {
    const input = inputOf(s);
    m = { input, res: generate(input) };
    made.set(key, m);
  }
  return m;
}
/** 겉 복셀을 하나씩 */
function* voxels(res: VoxelResult) {
  const b = res.bytes;
  for (let n = 0; n < b.length; n += STRIDE)
    yield {
      i: b[n] as number,
      j: b[n + 1] as number,
      k: b[n + 2] as number,
      color: b[n + 3] as number,
      group: b[n + 4] as number,
      nz: ((b[n + 7] as number) - 128) / 127,
      flag: b[n + 9] as number,
    };
}
const colorsOf = (res: VoxelResult, keep: (v: { group: number; nz: number }) => boolean) => {
  const h = new Map<number, number>();
  for (const v of voxels(res)) if (keep(v)) h.set(v.color, (h.get(v.color) ?? 0) + 1);
  return h;
};
const top = (h: Map<number, number>) => [...h].sort((a, b) => b[1] - a[1])[0]?.[0];

/** 외곽선 묶음(kit.ts·parts.ts G) */
const GROUP = { body: 1 | 128, crest: 5, wingL: 10, wingR: 11, tail: 15 | 128 };

describe('정면 일치(0° 는 2D 와 거의 같다)', () => {
  const cases: Spec[] = [];
  for (const form of FORMS) {
    cases.push({ form });
    cases.push({ form, step: 30 }); // 호봉 소품 전부
    cases.push({
      form,
      step: 9,
      look: {
        body: 'sea',
        crest: 'blue',
        plume: 'sunset',
        deco: { pin: 'flower', chest: 'star', cheek: true },
        prop: 'calculator',
      },
    });
    cases.push({ form, step: 14, mood: 'vacation' });
  }
  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('%s', (_name, spec) => {
    const { input, res } = make(spec);
    const fc = frontCheck(res, input.ref);
    expect(fc.iou).toBeGreaterThanOrEqual(spec.form === 'phoenix' ? 0.9 : 0.97);
  });
});

describe('색은 팔레트 안', () => {
  it.each(FORMS.map((f) => [f]))('%s', (form) => {
    for (const spec of [
      { form },
      {
        form,
        step: 40,
        look: {
          body: 'snow',
          crest: 'purple',
          plume: 'moon',
          deco: { pin: 'star', chest: 'tiger', cheek: true },
        },
      },
    ] as Spec[]) {
      const { res } = make(spec);
      expect(res.surface).toBeGreaterThan(500);
      for (const v of voxels(res)) expect(v.color).toBeLessThan(rules.palette.length);
      for (const s of res.meta.face.stamps)
        for (const tile of [s.full, s.narrow, s.sideTile])
          for (const c of tile) expect(c === TR || c < rules.palette.length).toBe(true);
      expect(res.meta.base).toBeLessThan(16);
      expect(res.meta.shade).toBeLessThan(16);
    }
    expect(rules.palette).toHaveLength(16);
    for (const c of RAMP) expect(c).toBeLessThan(16);
  });
});

describe('나눠 만들기', () => {
  it('generateSteps 는 env → body → items 에서 양보하고 넷째에 끝난다. 단계마다 시간 상한 안', () => {
    // 데우기(격자 할당·JIT): 첫 생성은 느릴 수 있다
    generate(inputOf({ form: 'phoenix', step: 30 }));
    const worst: number[] = [];
    for (const form of FORMS) {
      const input = inputOf({ form, step: 30, mood: 'celebrate' });
      const it = generateSteps(input);
      const names: string[] = [];
      const times: number[] = [];
      for (;;) {
        const t0 = performance.now();
        const r = it.next();
        times.push(performance.now() - t0);
        if (r.done) {
          expect(r.value.surface).toBeGreaterThan(0);
          break;
        }
        names.push(r.value);
      }
      expect(names).toEqual(['env', 'body', 'items']);
      expect(times).toHaveLength(STEP_COUNT);
      worst.push(Math.max(...times));
    }
    // 데워진 뒤 한 단계는 보통 25ms 안. CI·느린 기기를 생각해 넉넉히 잡는다
    expect(Math.max(...worst)).toBeLessThan(250);
  });

  it('modelJob 은 STEP_COUNT 번 불러 끝나고, 같은 그림은 캐시에서 바로 나온다', () => {
    clearModels();
    const look = lookOf({ form: 'bird', step: 14 });
    let got: unknown = undefined;
    const job = modelJob(look, (m) => {
      got = m;
    });
    let calls = 0;
    while (job()) calls += 1;
    expect(calls + 1).toBe(STEP_COUNT);
    expect(got).not.toBeNull();
    const key = voxelKey(look);
    expect(cachedModel(key)).toBe(got);
    // 호봉·기분이 달라도 그려지는 것이 같으면 같은 키(1·2호봉은 같은 목걸이, 점심·퇴근은 같은 눈)
    expect(voxelKey(lookOf({ form: 'bird', step: 2 }))).toBe(
      voxelKey(lookOf({ form: 'bird', step: 1 })),
    );
    expect(voxelKey(lookOf({ form: 'bird', step: 1, mood: 'off' }))).toBe(
      voxelKey(lookOf({ form: 'bird', step: 1, mood: 'lunch' })),
    );
    expect(voxelKey(lookOf({ form: 'bird', step: 14, mood: 'lunch' }))).not.toBe(key);
    expect(voxelKey(lookOf({ form: 'bird', step: 14, mood: 'sleep' }))).not.toBe(key);
    expect(voxelKey(lookOf({ form: 'bird', step: 14, look: { body: 'sea' } }))).not.toBe(key);
    let again = 0;
    const job2 = modelJob(look, () => {
      again += 1;
    });
    expect(job2()).toBe(false);
    expect(again).toBe(1);
    // 멈춘 일은 다시 불러도 아무것도 하지 않는다
    clearModels();
    let stopped = 0;
    const job3 = modelJob(look, () => {
      stopped += 1;
    });
    job3();
    job3.cancel();
    expect(job3()).toBe(false);
    expect(stopped).toBe(0);
  });

  it('buildModel·메시: 삼각형 수는 드러난 면 × 2', () => {
    clearModels();
    const m = buildModel(lookOf({ form: 'egg' }));
    expect(m).not.toBeNull();
    if (!m) return;
    const mesh = buildMesh(m.res.bytes, m.res.meta.zoff);
    expect(mesh.count).toBe(m.res.faces * 6);
    expect(mesh.voxels).toBe(m.res.surface);
  });
});

/** 소품 하나가 남긴 것: 복셀 부품(이름이 소품 이름으로 시작) 또는 칠(paint)·얼굴 도장 */
function leaves(spec: Spec, sprite: string) {
  const { input, res } = make(spec);
  const it = input.items.find((x) => x.name === sprite);
  if (!it) return 'missing';
  if (it.attach === 'eyes') {
    // 얼굴 도장: 정면 도장 그림에 그 소품의 칸이 그대로 찍힌다(맨 위 층이 아닌 칸은 덮일 수 있어 절반 이상이면 된다)
    const fp = faceFront(res.meta.face);
    let n = 0,
      hit = 0;
    for (let i = 0; i < W * 48; i++) {
      if (it.px[i] === TR) continue;
      n += 1;
      if (fp[i] === it.px[i]) hit += 1;
    }
    return n > 0 && hit / n >= 0.5 ? 'face' : `face ${hit}/${n}`;
  }
  const part = res.meta.parts.find((p) => p.name === sprite || p.name.startsWith(sprite + ':'));
  if (part && part.count > 0) return 'voxels';
  // 칠(넥타이·가슴 배지): 그 칸의 맨 앞 복셀 색이 소품 색
  const front = new Int16Array(W * 48).fill(-1),
    color = new Uint8Array(W * 48);
  for (const v of voxels(res)) {
    const id = v.j * W + v.i;
    if (v.k > (front[id] as number)) {
      front[id] = v.k;
      color[id] = v.color;
    }
  }
  let n = 0,
    hit = 0;
  for (let i = 0; i < W * 48; i++) {
    if (it.px[i] === TR) continue;
    n += 1;
    if (color[i] === it.px[i]) hit += 1;
  }
  return n > 0 && hit / n >= 0.5 ? 'paint' : `none ${hit}/${n}`;
}

describe('소품·장식·기분 소품이 모두 남는다', () => {
  const props = rules.custom.props;
  it.each(props.map((p, n) => [p.id, p.sprite, FORMS[n % 5] as Form] as const))(
    '손 소품 %s (%s · %s)',
    (id, sprite, form) => {
      expect(leaves({ form, look: { prop: id } }, sprite)).toMatch(/^(voxels|paint|face)$/);
    },
  );
  const decos = rules.custom.decos;
  it.each(decos.map((d, n) => [d.id, d.slot, d.sprite, FORMS[(n + 2) % 5] as Form] as const))(
    '장식 %s(%s · %s · %s)',
    (id, slot, sprite, form) => {
      const deco = {
        pin: slot === 'pin' ? id : null,
        chest: slot === 'chest' ? id : null,
        cheek: slot === 'cheek',
      };
      expect(leaves({ form, look: { deco } }, sprite)).toMatch(/^(voxels|paint|face)$/);
    },
  );
  const moodItems = Object.entries(rules.moods).flatMap(([mood, m]) =>
    m.items.map((sprite) => [mood as MoodId, sprite] as const),
  );
  it.each(
    moodItems.map(([mood, sprite], n) => [mood, sprite, FORMS[(n + 1) % 5] as Form] as const),
  )('기분 %s: %s (%s)', (mood, sprite, form) => {
    expect(leaves({ form, mood, step: 3 }, sprite)).toMatch(/^(voxels|paint|face)$/);
  });
  const stepItems = rules.items;
  it.each(
    stepItems.map((i, n) => [i.id, i.sprite, i.minStep, FORMS[(n + 3) % 5] as Form] as const),
  )('호봉 소품 %s (%s, %i호봉 · %s)', (_id, sprite, minStep, form) => {
    expect(leaves({ form, step: Math.max(minStep, 1) }, sprite)).toMatch(/^(voxels|paint|face)$/);
  });
  it('기분·장식·소품을 겹쳐도 앞모습이 2D 와 맞는다', () => {
    const spec: Spec = {
      form: 'fledgling',
      step: 30,
      mood: 'vacation',
      look: { deco: { pin: 'ribbon', chest: 'heart', cheek: true }, prop: 'globe' },
    };
    const { input, res } = make(spec);
    expect(frontCheck(res, input.ref).iou).toBeGreaterThanOrEqual(0.95);
  });
});

describe('표에 없는 새 소품도 붙는다', () => {
  const box = (x0: number, y0: number, w: number, h: number, c: number) => {
    const px = new Uint8Array(W * 48).fill(TR);
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
        px[y * W + x] = edge ? 0 : c;
      }
    return px;
  };
  it.each([
    ['handL', 'series-newthing'],
    ['head', 'deco-newpin'],
    ['chest', 'deco-newbadge'],
    ['crown', 'item-newhat'],
    [null, 'fx-unknown'],
  ] as const)('앵커 %s · %s', (attach, name) => {
    const input = inputOf({ form: 'bird' });
    expect(SHAPES[name]).toBeUndefined();
    const anchor = attach ? (input.anchors[attach] ?? ([24, 24] as const)) : ([0, 0] as const);
    const [ax, ay] = attach ? anchor : [20, 30];
    const px = box(Math.max(1, ax - 3), Math.max(1, ay - 3), 7, 6, 9);
    const before = generate(input).surface;
    const res = generate({
      ...input,
      items: [
        ...input.items,
        { name, attach, layer: 30, w: 7, h: 6, x0: ax - 3, y0: ay - 3, anchor, px, skin: null },
      ],
    });
    const part = res.meta.parts.find((p) => p.name === name);
    if (attach === 'chest') {
      // 가슴은 칠만 한다(복셀이 늘지 않는다): 맨 앞 색이 소품 색
      expect(res.surface).toBe(before);
      expect(
        [...voxels(res)].some(
          (v) => v.color === 9 && Math.abs(v.i - ax) <= 2 && Math.abs(v.j - ay) <= 2,
        ),
      ).toBe(true);
    } else {
      expect(part?.count ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('꾸미기 색이 옆·뒤에도 먹는다', () => {
  it.each(FORMS.map((f) => [f]))('몸 색 %s: 뒤를 보는 몸 복셀이 바꾼 바탕색', (form) => {
    for (const body of rules.custom.bodies) {
      const { input, res } = make({ form, look: { body: body.id } });
      const back = colorsOf(res, (v) => v.group === GROUP.body && v.nz < -0.5);
      expect(back.size).toBeGreaterThan(0);
      expect(top(back)).toBe(input.colors.base);
      expect(input.colors.base).toBe(body.remap['4'] ?? 4);
    }
  });

  it.each(['fledgling', 'bird', 'phoenix'] as const)('볏 색 %s: 옆·뒤까지 바꾼 색', (form) => {
    for (const crest of rules.custom.crests) {
      const { res } = make({ form, look: { crest: crest.id } });
      const all = colorsOf(res, (v) => v.group === GROUP.crest);
      const back = colorsOf(res, (v) => v.group === GROUP.crest && v.nz < 0);
      expect(all.size).toBeGreaterThan(0);
      expect(back.size).toBeGreaterThan(0);
      const red = crest.remap['2'] ?? 2;
      expect(back.has(red)).toBe(true);
      if (red !== 2) expect(all.has(2)).toBe(false);
    }
  });

  const plumes = rules.custom.plumes.filter((p) => p.id !== 'auto');
  it.each(['bird', 'phoenix'] as const)('깃 색 %s: 날개 뒷면이 바꾼 색', (form) => {
    for (const plume of plumes) {
      const { input, res } = make({ form, look: { plume: plume.id } });
      const wing = colorsOf(
        res,
        (v) => (v.group === GROUP.wingL || v.group === GROUP.wingR) && v.nz < 0,
      );
      expect(wing.size).toBeGreaterThan(0);
      // 2D 날개(깃 영역)에 있는 색이 뒷면에도 가장 많다
      const plume2d = new Set<number>();
      for (let i = 0; i < W * 48; i++)
        if (input.regions[i] === input.REGION.PLUME) plume2d.add(input.body[i] as number);
      expect(plume2d.has(top(wing) as number)).toBe(true);
    }
  });

  it('봉황 꼬리: 어떤 깃 색에서도 2D 꼬리 색 + 그 그늘색(골)만 쓴다', () => {
    for (const plume of plumes) {
      const { input, res } = make({ form: 'phoenix', look: { plume: plume.id } });
      const tail2d = new Set<number>([0]);
      for (let i = 0; i < W * 48; i++)
        if (input.regions[i] === input.REGION.BELOW) tail2d.add(input.body[i] as number);
      const feather = input.colors.plume[9] ?? 9;
      const groove = grooveOf(feather, RAMP);
      const tail = colorsOf(res, (v) => v.group === GROUP.tail);
      expect(tail.size).toBeGreaterThan(2);
      for (const c of tail.keys())
        expect(tail2d.has(c) || c === groove, `${plume.id}: 색 ${c}`).toBe(true);
      // 파랑 계열이 아닌 깃에서 남색·파랑 줄이 남지 않는다
      if (!tail2d.has(9)) {
        expect(tail.has(8)).toBe(false);
        expect(tail.has(9)).toBe(false);
      }
    }
    // 골은 깃의 그늘: 오색·푸른 9→8, 노을 2→1, 달빛 14→15, 숲 7→15(남색 대신 먹회색)
    expect([9, 2, 14, 7].map((c) => grooveOf(c, RAMP))).toEqual([8, 1, 15, 15]);
  });
});
