<script lang="ts">
  interface Props {
    /** 0~1 */
    value: number;
    label: string;
    /** 칸 수(칸 단위로 끊어서 채운다) */
    cells?: number;
    tone?: 'good' | 'accent' | 'gold' | 'warn';
    /** 낭독기에 읽어 줄 값 설명(없으면 백분율) */
    valueText?: string;
    thin?: boolean;
  }

  let { value, label, cells = 20, tone = 'good', valueText, thin = false }: Props = $props();
  const clamped = $derived(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)));
  // 조금이라도 진행했으면 한 칸은 채우고, 끝나기 전에는 마지막 칸을 비워 둔다.
  const filled = $derived(
    clamped <= 0
      ? 0
      : clamped >= 1
        ? cells
        : Math.min(cells - 1, Math.max(1, Math.round(clamped * cells))),
  );
</script>

<div
  class="bar {tone}"
  class:thin
  role="progressbar"
  aria-label={label}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(clamped * 100)}
  aria-valuetext={valueText ?? `${Math.round(clamped * 100)}%`}
  style="--cells:{cells}"
>
  <i style="width:{(filled / cells) * 100}%"></i>
</div>

<style>
  .bar {
    position: relative;
    height: 18px;
    margin: var(--u);
    background: var(--panel-2);
    box-shadow: var(--frame);
    overflow: hidden;
  }
  .bar.thin {
    height: 12px;
  }
  .bar > i {
    display: block;
    height: 100%;
    background: var(--good-fill);
    box-shadow:
      inset 0 3px 0 0 rgba(255, 255, 255, 0.28),
      inset 0 -3px 0 0 rgba(26, 28, 44, 0.22);
  }
  .bar.accent > i {
    background: var(--accent);
  }
  .bar.gold > i {
    background: var(--gold);
  }
  .bar.warn > i {
    background: var(--warn-fill);
  }
  /* 칸 사이 눈금 */
  .bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
      90deg,
      transparent calc(100% - 3px),
      var(--panel) calc(100% - 3px)
    );
    background-size: calc(100% / var(--cells)) 100%;
    opacity: 0.55;
    pointer-events: none;
  }
  /* 고대비: 배경·그림자가 지워지므로 실제 선과 시스템 색으로 */
  @media (forced-colors: active) {
    .bar {
      border: 2px solid CanvasText;
    }
    .bar > i {
      forced-color-adjust: none;
      background: Highlight;
    }
    .bar::after {
      display: none;
    }
  }
</style>
