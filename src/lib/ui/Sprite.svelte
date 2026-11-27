<script lang="ts">
  import { onMount } from 'svelte';
  import { anim } from '../app/anim.svelte.ts';
  import { theme } from '../app/theme.svelte.ts';
  import {
    paintPose,
    poseOf,
    poseOfSprite,
    SPRITE_SIZE,
    type PoseOptions,
  } from '../character/draw.ts';
  import type { Look } from '../character/look.ts';

  interface Props {
    /** 캐릭터 모습. sprite를 주면 무시된다 */
    look?: Look;
    /** 스프라이트 하나만 그릴 때(알 등) */
    sprite?: string;
    frame?: number;
    /** CSS 픽셀 기준 확대 배율(정수) */
    scale?: number;
    /** 대기 애니메이션을 돌릴지 */
    animate?: boolean;
    pose?: PoseOptions;
    label?: string;
    /** 48×48 가운데 이 사각형(스프라이트 픽셀)만 그린다. 작은 장식 견본을 크게 보일 때 */
    crop?: { x: number; y: number; w: number; h: number };
  }

  let { look, sprite, frame = 0, scale = 4, animate = true, pose, label, crop }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let dpr = $state(1);

  // 기기 픽셀 기준으로도 정수 배율이 되게 한다(125%·150% 배율 화면에서 픽셀이 들쭉날쭉해지지 않게).
  const devicePixels = $derived(Math.max(1, Math.round(scale * dpr)));
  const area = $derived(crop ?? { x: 0, y: 0, w: SPRITE_SIZE, h: SPRITE_SIZE });
  const cssW = $derived((area.w * devicePixels) / dpr);
  const cssH = $derived((area.h * devicePixels) / dpr);
  const tick = $derived(animate ? anim.tick : 0);

  onMount(() => {
    const update = () => {
      dpr = window.devicePixelRatio || 1;
    };
    update();
    window.addEventListener('resize', update);
    const release = animate ? anim.use() : () => undefined;
    return () => {
      window.removeEventListener('resize', update);
      release();
    };
  });

  $effect(() => {
    const el = canvas;
    if (!el) return;
    const { x, y, w, h } = area;
    const width = w * devicePixels;
    const height = h * devicePixels;
    if (el.width !== width) el.width = width;
    if (el.height !== height) el.height = height;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    // 야근 모드의 어두운 바닥(#3f5068)에서는 그림자(f)가 1.3:1로 묻혀, 먹색(0, 약 2.1:1)으로 칠한다
    const comp = sprite
      ? poseOfSprite(sprite, frame)
      : look
        ? poseOf(look, { shadowInk: theme.dark ? 0 : undefined, ...pose, tick })
        : null;
    ctx.clearRect(0, 0, width, height);
    if (comp) paintPose(ctx, comp, -x * devicePixels, -y * devicePixels, devicePixels);
  });
</script>

{#if label}
  <span class="wrap" role="img" aria-label={label} style="width:{cssW}px;height:{cssH}px">
    <canvas
      bind:this={canvas}
      class="sprite"
      style="width:{cssW}px;height:{cssH}px"
      aria-hidden="true"
    ></canvas>
  </span>
{:else}
  <canvas
    bind:this={canvas}
    class="sprite"
    style="width:{cssW}px;height:{cssH}px"
    aria-hidden="true"
  ></canvas>
{/if}

<style>
  .wrap {
    flex: none;
    display: block;
  }
  .sprite {
    flex: none;
    image-rendering: crisp-edges;
    image-rendering: pixelated;
  }
</style>
