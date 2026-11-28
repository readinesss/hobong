/**
 * Look(look.ts resolveLook 결과) → 복셀 생성기 입력. 저장소의 캐릭터 모듈(compose·regions·sprites·rules)에 기대는 것은 이 파일뿐이다.
 * 생성기(generate.ts 이하)는 여기서 만든 값(input.ts)만 본다.
 *
 * 2D 합성은 draw.ts poseOf(plain, tick 0)와 같다: 꾸미기 색을 칠한 몸통 + 눈 + 소품(효과·그림자 제외).
 */
import { compose, type Layer } from '../compose.ts';
import type { CharacterRules, Look } from '../look.ts';
import { recolorBody, skinSprite, regionsOf, isSkinPixel, REGION } from '../regions.ts';
import { characterRules } from '../rules.ts';
import { TRANSPARENT, type Sprite } from '../sprite-format.ts';
import { getSprite } from '../sprites.ts';
import type { BodyAnchors, Point, VoxelInput, VoxelItem } from './input.ts';

const W = 48,
  H = 48;

function stamp(sprite: Sprite, body: Sprite, remap?: Readonly<Record<number, number>>) {
  const px = new Uint8Array(W * H).fill(TRANSPARENT);
  const [ax, ay] = sprite.attach ? (body.anchors[sprite.attach] ?? [0, 0]) : [0, 0];
  const x0 = ax - sprite.origin[0],
    y0 = ay - sprite.origin[1];
  const f = sprite.frames[0] as Uint8Array;
  for (let y = 0; y < sprite.h; y++)
    for (let x = 0; x < sprite.w; x++) {
      const v = f[y * sprite.w + x] as number;
      const tx = x0 + x,
        ty = y0 + y;
      if (v === TRANSPARENT || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      px[ty * W + tx] = remap?.[v] ?? v;
    }
  return { px, x0, y0 };
}

export interface VoxelSource {
  rules: CharacterRules;
  getSprite: (name: string) => Sprite | null;
}
const APP: VoxelSource = { rules: characterRules, getSprite };

/**
 * 모습 → 생성기 입력. 몸통 그림이 없거나 앵커(head·eyes·ground)가 모자라면 null.
 * opts.eyes: 눈을 바꿔 그린다(연출용). src: 규칙·스프라이트(테스트가 바꿔 끼운다)
 */
export function voxelInput(
  look: Look,
  opts: { eyes?: string } = {},
  src: VoxelSource = APP,
): VoxelInput | null {
  const { rules } = src;
  const base = src.getSprite(look.form.body);
  if (!base) return null;
  const { head, eyes, ground } = base.anchors;
  if (!head || !eyes || !ground) return null;
  const anchors = base.anchors as BodyAnchors;
  const body = recolorBody(base, look.paint);
  const shadow = look.form.shadow ?? rules.shadow;
  const eyesSprite = src.getSprite(opts.eyes ?? look.eyes);
  const layers: Layer[] = [{ sprite: body }];
  if (eyesSprite) layers.push({ sprite: eyesSprite });
  const items: VoxelItem[] = [];
  for (const part of look.parts) {
    if (part.animated || part.sprite === shadow) continue;
    const raw = src.getSprite(part.sprite);
    if (!raw) continue;
    const sprite = skinSprite(raw, look.paint.body);
    layers.push({ sprite, remap: part.remap, halo: part.halo });
    const st = stamp(sprite, base, part.remap);
    // 쥔 날개 끝(@skin) 칸: 몸 묶음으로 그린다
    let skin: Uint8Array | null = null;
    if (raw.skin) {
      skin = new Uint8Array(W * H);
      const f = raw.frames[0] as Uint8Array;
      for (let y = 0; y < raw.h; y++)
        for (let x = 0; x < raw.w; x++) {
          const tx = st.x0 + x,
            ty = st.y0 + y;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          if (isSkinPixel(raw, x, y, f[y * raw.w + x] as number)) skin[ty * W + tx] = 1;
        }
    }
    const anchor: Point = raw.attach ? (base.anchors[raw.attach] ?? [0, 0]) : [0, 0];
    items.push({
      name: raw.name,
      attach: raw.attach,
      layer: raw.layer,
      w: raw.w,
      h: raw.h,
      x0: st.x0,
      y0: st.y0,
      anchor,
      px: st.px,
      skin,
    });
  }
  const ref = compose(layers, { w: W, h: H, body }).pixels;
  const eyesPx = eyesSprite ? stamp(eyesSprite, base).px : new Uint8Array(W * H).fill(TRANSPARENT);
  return {
    form: look.form.id,
    float: shadow !== rules.shadow,
    anchors,
    body: body.frames[0] as Uint8Array,
    bodyRaw: base.frames[0] as Uint8Array,
    regions: regionsOf(base),
    REGION,
    colors: {
      base: look.paint.body[4] ?? 4,
      shade: look.paint.body[3] ?? 3,
      plume: look.paint.plume,
      crest: look.paint.crest,
    },
    eyes: eyesPx,
    eyesName: eyesSprite?.name ?? null,
    items,
    ref,
  };
}

/**
 * 같은 복셀이 나오는 모습끼리 같은 문자열(캐시 키). 형태·눈·칠·그림 부품(효과·그림자 제외)과 그 치환으로 정한다 —
 * 기분·호봉이 달라도 그려지는 것이 같으면 같은 키다.
 */
export function voxelKey(look: Look, opts: { eyes?: string } = {}, src: VoxelSource = APP): string {
  const shadow = look.form.shadow ?? src.rules.shadow;
  const r = (m: Readonly<Record<number, number>> | undefined) =>
    m
      ? Object.entries(m)
          .map(([k, v]) => `${k}:${v}`)
          .join(',')
      : '';
  const parts = look.parts
    .filter((p) => !p.animated && p.sprite !== shadow)
    .map((p) => `${p.sprite}(${r(p.remap)})${p.halo ?? ''}`)
    .join('+');
  const pt = look.paint;
  return [
    look.form.id,
    opts.eyes ?? look.eyes,
    r(pt.body),
    r(pt.crest),
    r(pt.plume),
    pt.beak,
    pt.cheek,
    pt.chest,
    parts,
  ].join('|');
}
