/**
 * 복셀 생성기의 입력(from-look.ts 가 만든다). 생성기(generate.ts 이하)는 저장소의 다른 모듈을 보지 않고 이 값만 본다.
 * 그림은 모두 48×48 팔레트 번호(255 = 투명), 행 우선.
 */

export type Point = readonly [number, number];

/** 몸통 영역 번호(regions.ts REGION 과 같은 값) */
export interface RegionCodes {
  readonly NONE: number;
  readonly BODY: number;
  readonly CREST: number;
  readonly PLUME: number;
  readonly FEET: number;
  readonly BELOW: number;
  readonly BEAK: number;
  readonly CHEEK: number;
  readonly SKIN: number;
  readonly OUTLINE: number;
}

/** 몸통 앵커(다섯 몸통 모두 head·eyes·ground 를 가진다) */
export type BodyAnchors = Readonly<Record<string, Point>> & {
  readonly head: Point;
  readonly eyes: Point;
  readonly ground: Point;
};

/** 소품·장식 하나(효과·그림자 제외) */
export interface VoxelItem {
  /** 스프라이트 이름(props.ts SHAPES 의 키) */
  name: string;
  /** 붙는 몸통 앵커(handL·head·chest·eyes…). 없으면 null */
  attach: string | null;
  layer: number;
  w: number;
  h: number;
  /** 48×48 위에 찍힌 왼쪽 위 칸 */
  x0: number;
  y0: number;
  /** 붙는 앵커 자리(없으면 [0,0]) */
  anchor: Point;
  /** 48×48 에 찍은 그림(꾸미기·틴트 치환 뒤) */
  px: Uint8Array;
  /** 쥔 날개 끝(@skin) 칸: 1 이면 몸 묶음으로 그린다 */
  skin: Uint8Array | null;
}

export interface VoxelInput {
  /** 형태 id(egg·chick·fledgling·bird·phoenix) */
  form: string;
  /** 떠 있는 몸(봉황: 따로 그림자를 쓴다) */
  float: boolean;
  anchors: BodyAnchors;
  /** 꾸미기 색을 칠한 몸통 */
  body: Uint8Array;
  /** 칠하기 전 몸통 */
  bodyRaw: Uint8Array;
  /** 칸마다 영역 번호 */
  regions: Uint8Array;
  REGION: RegionCodes;
  colors: {
    /** 몸 바탕·그늘 색(칠한 뒤) */
    base: number;
    shade: number;
    /** 깃·볏 색 치환(꾸미기) */
    plume: Readonly<Record<number, number>>;
    crest: Readonly<Record<number, number>>;
  };
  /** 눈 그림(48×48) */
  eyes: Uint8Array;
  eyesName: string | null;
  items: VoxelItem[];
  /** 같은 모습의 2D 합성(앞모습 점검용) */
  ref: Uint8Array;
}
