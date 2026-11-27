/**
 * 연출 공통 바탕(2차 B 연출·2차 C 손맛이 함께 쓴다).
 *
 * - 루프는 하나: 일이 있는 효과만 `wake(job)` 로 등록하고, job 이 false 를 돌려주면 빠진다.
 *   등록된 일이 없으면 다음 프레임을 청하지 않는다(가만히 있을 때 CPU 0).
 *   탭이 가려지면 브라우저가 프레임을 멈추고, 돌아온 첫 프레임의 dt 는 50ms 로 묶는다(연출이 건너뛰지 않게).
 * - 효과 층(.fx-layer)은 화면 위에 고정된 한 장. pointer-events: none, aria-hidden.
 *   조각·전환은 그 안의 캔버스 한 장에, 커서·툴팁은 그 안의 DOM 조각으로 그린다.
 *   무대 안에서만 보이는 연출(알·승급)은 무대의 캔버스에 그리고, 이 층은 화면 전체에 걸치는 것만 쓴다.
 * - 움직임 줄이기: html[data-motion='reduced'](App 이 앱 설정·기기 설정을 합쳐 붙인다) 또는 prefers-reduced-motion.
 * - 마우스 전용 효과(올림·눈 따라오기·시차)는 pointerType === 'mouse' 일 때만.
 * - 수명: startFx() 로 공용 리스너를 걸고 disposeFx() 로 한 번에 거둔다(모듈을 불러오기만 해서는 아무것도 걸지 않는다).
 * - 이 파일은 DOM 이 없는 곳(단위 테스트)에서도 불러올 수 있다. DOM 은 함수가 불릴 때만 만진다.
 */

/** 한 프레임에 할 일. 계속 돌려면 true, 끝났으면 false */
export type Job = (now: number, dt: number) => boolean;

/** 한 프레임에 흐른 것으로 치는 가장 긴 시간(ms). 탭 복귀·끊김 뒤에 연출이 순간이동하지 않게 */
export const MAX_DT = 50;

const jobs = new Set<Job>();
let frame: number | ReturnType<typeof setTimeout> | null = null;
let last = 0;

/** 계측(probe·테스트용): record 를 켜면 프레임 간격과 루프가 쓴 시간(ms)을 모은다 */
export const stats = { frames: [] as number[], work: [] as number[], record: false };

function request(run: (now: number) => void): number | ReturnType<typeof setTimeout> {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(run);
  return setTimeout(() => run(performance.now()), 16);
}

function cancel(id: number | ReturnType<typeof setTimeout>): void {
  if (typeof id === 'number' && typeof cancelAnimationFrame === 'function')
    cancelAnimationFrame(id);
  else clearTimeout(id);
}

function loop(now: number): void {
  frame = null;
  const dt = last ? Math.max(0, Math.min(MAX_DT, now - last)) : 1000 / 60;
  last = now;
  const t0 = stats.record ? performance.now() : 0;
  for (const job of [...jobs]) {
    // 같은 프레임 안에서 sleep() 으로 빠진 일은 부르지 않는다
    if (!jobs.has(job)) continue;
    let keep = false;
    try {
      keep = job(now, dt);
    } catch (error) {
      console.error(error);
    }
    if (!keep) jobs.delete(job);
  }
  if (stats.record) {
    stats.frames.push(dt);
    stats.work.push(performance.now() - t0);
  }
  if (jobs.size > 0) frame = request(loop);
  else last = 0;
}

/** 일을 루프에 올린다(이미 올라 있으면 그대로). 첫 호출은 다음 프레임에 온다 */
export function wake(job: Job): void {
  jobs.add(job);
  if (frame === null) frame = request(loop);
}

/** 일을 루프에서 내린다 */
export function sleep(job: Job): void {
  jobs.delete(job);
}

export function activeJobs(): number {
  return jobs.size;
}

/** 다음 프레임이 예약돼 있는지(가만히 있을 때 false 여야 한다) */
export function running(): boolean {
  return frame !== null;
}

let reduceQuery: MediaQueryList | null = null;

function systemReduced(): boolean {
  if (typeof matchMedia !== 'function') return false;
  reduceQuery ??= matchMedia('(prefers-reduced-motion: reduce)');
  return reduceQuery.matches;
}

export const env = {
  /** 움직임 줄이기(기기 설정 또는 앱 설정) */
  get reduced(): boolean {
    if (typeof document === 'undefined') return false;
    return document.documentElement.getAttribute('data-motion') === 'reduced' || systemReduced();
  },
  /** 마지막 포인터가 마우스였는지(터치·펜이면 누를 때 반응만) */
  mouse: false,
  /** 마우스가 창 안에 있는지(창 밖으로 나가면 false. 눈·시차가 정면으로 돌아온다) */
  inside: false,
  /** 마지막 포인터 위치(뷰포트 CSS px) */
  x: -1,
  y: -1,
  lastMove: 0,
};

/*
 * 수명: 모든 공용 리스너·층은 core 가 가진 AbortController 하나에 묶인다.
 * 효과 모듈은 init/attach 때 startFx() 를 부르고, 앱이 내려갈 때(App.svelte cleanup·HMR) disposeFx() 한 번으로 거둔다.
 */
let ctl: AbortController | null = null;

export function startFx(): AbortSignal {
  if (ctl) return ctl.signal;
  ctl = new AbortController();
  const { signal } = ctl;
  const track = (e: PointerEvent) => {
    env.mouse = e.pointerType === 'mouse';
    env.inside = true;
    env.x = e.clientX;
    env.y = e.clientY;
    env.lastMove = performance.now();
  };
  const out = (e: PointerEvent) => {
    if (e.relatedTarget === null && e.pointerType === 'mouse') {
      env.inside = false;
      env.lastMove = performance.now();
    }
  };
  window.addEventListener('pointermove', track, { passive: true, capture: true, signal });
  window.addEventListener('pointerdown', track, { passive: true, capture: true, signal });
  document.addEventListener('pointerout', out, { passive: true, signal });
  return signal;
}

/** 층·캔버스·공용 리스너·남은 job 을 모두 거둔다(다시 startFx 하면 새로 만든다) */
export function disposeFx(): void {
  ctl?.abort();
  ctl = null;
  if (frame !== null) cancel(frame);
  frame = null;
  last = 0;
  jobs.clear();
  painters.clear();
  dirty = false;
  layer?.remove();
  layer = null;
  canvas = null;
  ctx = null;
  reduceQuery = null;
  env.mouse = false;
  env.inside = false;
  env.x = env.y = -1;
  env.lastMove = 0;
}

/** 효과 층과 캔버스(한 번만 만든다) */
let layer: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let dpr = 1;

export function fxLayer(): HTMLDivElement {
  if (layer) return layer;
  const signal = startFx();
  layer = document.createElement('div');
  layer.className = 'fx-layer no-print';
  layer.setAttribute('aria-hidden', 'true');
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  layer.append(canvas);
  document.body.append(layer);
  const resize = () => {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx = canvas.getContext('2d');
    if (ctx) ctx.imageSmoothingEnabled = false;
    // 크기를 바꾸면 캔버스가 비워진다. 그리던 것이 있으면 다음 프레임에 다시 그린다
    dirty = false;
  };
  resize();
  window.addEventListener('resize', resize, { passive: true, signal });
  return layer;
}

/**
 * 층의 캔버스는 여러 효과(조각·전환)가 함께 쓴다. 매 프레임 한 번만 지우도록
 * 그리는 쪽을 등록해 두고 공용 job 이 지운 뒤 차례로 부른다. 좌표는 뷰포트 CSS px.
 */
export type Painter = (ctx: CanvasRenderingContext2D, now: number, dt: number) => boolean;
const painters = new Set<Painter>();
let dirty = false;

const paintJob: Job = (now, dt) => {
  fxLayer();
  if (!ctx || !canvas) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (dirty) ctx.clearRect(0, 0, canvas.width, canvas.height);
  dirty = false;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const painter of [...painters]) {
    if (!painter(ctx, now, dt)) painters.delete(painter);
    dirty = true;
  }
  // 그리는 쪽이 모두 빠지면 한 프레임 더 돌아 남은 그림을 지운다
  return painters.size > 0 || dirty;
};

export function paint(painter: Painter): void {
  painters.add(painter);
  fxLayer();
  wake(paintJob);
}

/** CSS 변수 색(테마가 바뀌면 다시 읽는다) */
export function cssColor(name: string, fallback = '#ffcd75'): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** 누를 수 있는 것(조각이 튀는 기본 대상) */
export const PRESSABLE =
  'a[href], button, summary, label, [role="button"], [role="tab"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], input[type="checkbox"], input[type="radio"], .btn, .chip, .tab, [data-fx-burst]';

/** 효과를 받지 않을 곳: 글자를 치는 칸·끌기 중인 곳·data-fx-off */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest('[data-fx-off]')) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement)
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(
      el.type,
    );
  return (el as HTMLElement).isContentEditable === true;
}
