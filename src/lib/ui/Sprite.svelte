<script lang="ts">
  import { onMount } from 'svelte';
  import { anim } from '../app/anim.svelte.ts';
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
  }

  let { look, sprite, frame = 0, scale = 4, animate = true, pose, label }: Props = $props();

  let canvas = $state<HTMLCanvasElement>();
  let dpr = $state(1);

  // 기기 픽셀 기준으로도 정수 배율이 되게 한다(125%·150% 배율 화면에서 픽셀이 들쭉날쭉해지지 않게).
  const devicePixels = $derived(Math.max(1, Math.round(scale * dpr)));
  const cssSize = $derived((SPRITE_SIZE * devicePixels) / dpr);
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
    const size = SPRITE_SIZE * devicePixels;
    if (el.width !== size) el.width = size;
    if (el.height !== size) el.height = size;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const comp = sprite
      ? poseOfSprite(sprite, frame)
      : look
        ? poseOf(look, { ...pose, tick })
        : null;
    ctx.clearRect(0, 0, size, size);
    if (comp) paintPose(ctx, comp, 0, 0, devicePixels);
  });
</script>

{#if label}
  <span class="wrap" role="img" aria-label={label} style="width:{cssSize}px;height:{cssSize}px">
    <canvas
      bind:this={canvas}
      class="sprite"
      style="width:{cssSize}px;height:{cssSize}px"
      aria-hidden="true"
    ></canvas>
  </span>
{:else}
  <canvas
    bind:this={canvas}
    class="sprite"
    style="width:{cssSize}px;height:{cssSize}px"
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
