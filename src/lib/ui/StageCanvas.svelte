<script lang="ts">
  /**
   * 연출 무대 캔버스. 픽셀 판(src/lib/fx/stage.ts)을 정수 배율로 옮겨 그린다.
   *
   * - 폭은 감싼 칸을 채운다(무대 끝에서 끝까지 입자가 날고, 어둠 덮기가 무대 전체를 덮는다).
   *   캐릭터 48칸이 한가운데 오도록 칸 수의 홀짝을 맞추고, 남는 반 칸은 양옆으로 넘쳐 잘린다.
   * - render 는 판에 그리기만 한다. 그 안에서 읽은 상태가 바뀌면 다시 그리고, 루프에서 움직일 때는 redraw() 를 부른다.
   * - 기기 픽셀 기준으로도 정수 배율이라(Sprite.svelte 와 같은 계산) 125%·150% 화면에서도 픽셀이 고르다.
   */
  import { onMount } from 'svelte';
  import { characterRules } from '../character/rules.ts';
  import { clearStage, createStage, type Stage } from '../fx/stage.ts';

  interface Props {
    /** 무대 높이(스프라이트 픽셀) */
    rows?: number;
    /** CSS 픽셀 기준 확대 배율(정수) */
    scale?: number;
    render: (stage: Stage) => void;
    /** 낭독기에 읽어 줄 이름. 없으면 장식이다 */
    label?: string;
  }

  let { rows = 56, scale = 4, render, label }: Props = $props();

  const SPRITE = characterRules.canvas.w;
  let wrap = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let dpr = $state(1);
  let boxWidth = $state(0);

  const devicePixels = $derived(Math.max(1, Math.round(scale * dpr)));
  const unit = $derived(devicePixels / dpr);
  /** 칸 수: 칸을 다 덮게 올림하고, 캐릭터(짝수 폭)가 한가운데 오게 짝수로 */
  const cols = $derived.by(() => {
    const fit = Math.max(SPRITE, Math.ceil(boxWidth / unit));
    return fit % 2 === 0 ? fit : fit + 1;
  });
  const stage = $derived(createStage(cols, rows, characterRules.palette));

  let scratch: HTMLCanvasElement | null = null;

  function present(target: Stage) {
    const el = canvas;
    if (!el) return;
    const width = target.w * devicePixels;
    const height = target.h * devicePixels;
    if (el.width !== width) el.width = width;
    if (el.height !== height) el.height = height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    scratch ??= document.createElement('canvas');
    if (scratch.width !== target.w || scratch.height !== target.h) {
      scratch.width = target.w;
      scratch.height = target.h;
    }
    const sctx = scratch.getContext('2d');
    if (!sctx) return;
    sctx.putImageData(
      new ImageData(target.data as unknown as Uint8ClampedArray<ArrayBuffer>, target.w, target.h),
      0,
      0,
    );
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(scratch, 0, 0, target.w, target.h, 0, 0, width, height);
  }

  /** 지금 상태로 다시 그린다(루프의 한 프레임마다) */
  export function redraw(): void {
    const target = stage;
    clearStage(target);
    render(target);
    present(target);
  }

  onMount(() => {
    const update = () => {
      dpr = window.devicePixelRatio || 1;
      boxWidth = wrap?.clientWidth ?? 0;
    };
    update();
    window.addEventListener('resize', update);
    const observer =
      typeof ResizeObserver === 'function' && wrap ? new ResizeObserver(update) : null;
    if (wrap) observer?.observe(wrap);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  });

  $effect(() => {
    if (!canvas) return;
    redraw();
  });
</script>

<div
  bind:this={wrap}
  class="stage-canvas"
  style="height:{rows * unit}px"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <canvas bind:this={canvas} style="width:{cols * unit}px;height:{rows * unit}px" aria-hidden="true"
  ></canvas>
</div>

<style>
  .stage-canvas {
    display: flex;
    justify-content: center;
    width: 100%;
    min-width: 0;
    overflow: hidden;
  }
  canvas {
    flex: none;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
  }
</style>
