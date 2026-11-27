/**
 * 입자 밭을 공용 루프에 얹는다.
 *
 * - runField: 밭 하나를 루프에 올려 매 프레임 나아가고, 넘겨받은 render 로 그리게 한다(무대 캔버스용).
 *   입자가 다 사라지면 한 번 더 render 를 불러 지우게 하고 루프에서 빠진다.
 * - sparkle: 효과 층(화면 전체) 캔버스에 도트 조각을 터뜨린다. 좌표는 뷰포트 CSS px.
 *   2차 C 의 누름 조각과 2차 B 의 색종이가 함께 쓴다.
 * - 움직임 줄이기면 둘 다 아무것도 그리지 않는다(밭은 비운다).
 */
import { cssColor, env, paint, sleep, wake, type Job, type Painter } from './core.ts';
import {
  clearField,
  createField,
  drawField,
  emitBurst,
  stepField,
  throttleField,
  type Field,
  type Sink,
} from './particles.ts';

const running = new WeakMap<Field, { job: Job; render: (field: Field) => void }>();

/**
 * 밭을 루프에 올린다. 이미 돌고 있으면 render 만 바꾼다(입자를 더 뿌린 뒤 다시 불러도 된다).
 * 돌려받은 함수를 부르면 밭을 비우고 내린다(화면을 떠날 때).
 */
export function runField(field: Field, render: (field: Field) => void): () => void {
  const stop = () => {
    const entry = running.get(field);
    if (entry) sleep(entry.job);
    running.delete(field);
    clearField(field);
  };
  if (env.reduced) {
    stop();
    render(field);
    return stop;
  }
  const entry = running.get(field);
  if (entry) {
    entry.render = render;
    wake(entry.job);
    return stop;
  }
  const state = {
    render,
    job: ((_now, dt) => {
      if (running.get(field) !== state) return false;
      if (env.reduced) clearField(field);
      else {
        throttleField(field, dt);
        stepField(field, dt);
      }
      state.render(field);
      if (field.particles.length > 0) return true;
      running.delete(field);
      return false;
    }) as Job,
  };
  running.set(field, state);
  wake(state.job);
  return stop;
}

/** 효과 층에서 한꺼번에 떠 있을 수 있는 조각 수(연타해도 넘지 않는다) */
export const MAX_SPARKLES = 48;

// 효과 층의 조각은 모두 한 밭에 담는다(상한을 함께 지키게)
const layerField = createField({ max: MAX_SPARKLES });
let palette: string[] = [];
let paletteTheme = '';

function themeColors(): string[] {
  const theme = document.documentElement.getAttribute('data-theme') ?? '';
  if (theme !== paletteTheme || palette.length === 0) {
    paletteTheme = theme;
    palette = [cssColor('--accent'), cssColor('--gold'), cssColor('--c5'), cssColor('--cb')];
  }
  return palette;
}

const painter: Painter = (ctx, _now, dt) => {
  if (env.reduced) clearField(layerField);
  else {
    throttleField(layerField, dt);
    stepField(layerField, dt);
  }
  const sink: Sink = {
    rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    },
    // 효과 층은 색 네모만 그린다(스프라이트 입자는 무대 캔버스에서)
    sprite() {},
  };
  drawField(layerField, sink);
  return layerField.particles.length > 0;
};

export interface SparkleOptions {
  /** 조각 수. 기본 8 */
  count?: number;
  /** CSS 색. 기본은 테마의 강조색·금색·연두·하늘 */
  colors?: readonly string[];
  /** 처음 빠르기(px/초). 기본 110~200 */
  speed?: readonly [number, number];
  /** 수명(ms). 기본 280~360 */
  ttl?: readonly [number, number];
  /** 위로 띄우는 빠르기(px/초)와 중력(px/초²) */
  lift?: number;
  gravity?: number;
}

/**
 * 뷰포트의 (x, y)에 도트 조각을 터뜨린다. 큰 것(6px) 둘과 작은 것(3px)들이 퍼지며 살짝 떠올랐다 떨어지고,
 * 흐려지지 않고 마지막에 한 단계 작아졌다 사라진다. 움직임 줄이기면 아무 일도 없다.
 */
export function sparkle(x: number, y: number, options: SparkleOptions = {}): void {
  if (env.reduced) return;
  emitBurst(layerField, {
    x,
    y,
    count: Math.max(1, Math.min(MAX_SPARKLES, Math.floor(options.count ?? 8))),
    speed: options.speed ?? [110, 200],
    lift: options.lift ?? 140,
    gravity: options.gravity ?? 900,
    ttl: options.ttl ?? [280, 360],
    look: {
      colors: options.colors ?? themeColors(),
      sizes: [
        [6, 6],
        [6, 6],
        [3, 3],
        [3, 3],
        [3, 3],
        [3, 3],
        [3, 3],
        [3, 3],
      ],
      shrink: true,
    },
  });
  paint(painter);
}

/** 효과 층에 떠 있는 조각 수(테스트·probe 용) */
export function sparkleCount(): number {
  return layerField.particles.length;
}

/** 효과 층의 조각을 모두 치운다(앱이 내려갈 때 disposeFx 와 함께) */
export function clearSparkles(): void {
  clearField(layerField);
}
