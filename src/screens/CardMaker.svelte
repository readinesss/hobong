<script lang="ts">
  import { onMount } from 'svelte';
  import {
    canvasToBlob,
    copyImage,
    copyText,
    detectCapabilities,
    downloadBlob,
    shareFile,
  } from '../lib/app/files.ts';
  import { formatDday, formatNumber, formatSpan, formatWon } from '../lib/app/format.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { formatKorean } from '../lib/calc/date.ts';
  import {
    CARD_SIZES,
    drawCard,
    ensureCardFonts,
    EXPORT_SCALE,
    textCard,
    type CardModel,
  } from '../lib/card/render.ts';
  import { resolveLook } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '../lib/config.ts';
  import type { CardRatio, CardSettings } from '../lib/store/schema.ts';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Win from '../lib/ui/Win.svelte';

  const caps = detectCapabilities();
  const card = $derived(view.data.settings.card);

  let canvas = $state<HTMLCanvasElement>();
  let holder = $state<HTMLDivElement>();
  let previewScale = $state(1);
  let dpr = $state(1);
  let fontsReady = $state(false);
  let busy = $state(false);
  let fallbackUrl = $state<string | null>(null);
  let showText = $state(false);

  const model = $derived<CardModel>({
    nickname: view.profile.nickname,
    grade: view.profile.grade,
    step: view.step,
    maxStep: view.maxStep,
    formName: view.look.form.name,
    // 카드에는 언제 찍어도 같은 근무 중 모습을 담는다(기분·시간대에 따라 달라지지 않게).
    look: resolveLook(characterRules, view.profile.grade, view.step, 'work'),
    line: view.line,
    dateText: formatKorean(view.today, false),
    raise:
      view.raiseProgress && view.nextRaise
        ? { ratio: view.raiseProgress.ratio, dday: formatDday(view.today, view.nextRaise.date) }
        : null,
    facts: [
      ...(card.showTenure
        ? [
            `재직 ${formatSpan({ ...view.tenure, days: 0 })} · ${formatNumber(view.career.daysServed)}일째`,
          ]
        : []),
      ...(card.showRetirement
        ? [
            `정년 ${formatDday(view.today, view.retire.retireDate)} (${(view.career.ratio * 100).toFixed(1)}%)`,
          ]
        : []),
      ...(card.showSalary ? [`월 봉급 ${formatWon(view.salary.amount)}`] : []),
    ],
    badges: card.showBadges
      ? view.badges
          .filter((b) => b.at !== null)
          .slice(0, 8)
          .map((b) => ({ icon: b.icon, tier: b.tier }))
      : [],
    badgeCount: card.showBadges ? view.earnedCount : 0,
    siteName: SITE_NAME,
    siteTagline: SITE_TAGLINE,
    siteUrl: SITE_URL,
  });
  const text = $derived(textCard(model));
  const size = $derived(CARD_SIZES[card.ratio]);

  onMount(() => {
    void ensureCardFonts().then(() => (fontsReady = true));
    const measure = () => {
      dpr = window.devicePixelRatio || 1;
      const room = holder?.clientWidth ?? 270;
      // 미리보기도 기기 픽셀 기준 정수 배율로만 확대한다.
      previewScale = Math.max(1, Math.min(4, Math.floor((room * dpr) / 270)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    };
  });

  // 미리보기
  $effect(() => {
    const el = canvas;
    if (!el || !fontsReady) return;
    el.width = size.w * previewScale;
    el.height = size.h * previewScale;
    const ctx = el.getContext('2d');
    if (ctx) drawCard(ctx, model, card.ratio, previewScale);
  });

  function setCard(patch: Partial<CardSettings>) {
    app.updateSettings({ card: { ...card, ...patch } }, false);
  }

  async function render(): Promise<Blob | null> {
    await ensureCardFonts();
    const out = document.createElement('canvas');
    out.width = size.w * EXPORT_SCALE;
    out.height = size.h * EXPORT_SCALE;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    drawCard(ctx, model, card.ratio, EXPORT_SCALE);
    return canvasToBlob(out);
  }

  const fileName = $derived(`hobong-card-${view.today.replaceAll('-', '')}.png`);

  function done() {
    if (app.grantEvent('evt-card')) app.toast('새 뱃지: 첫 명함', 'good', 'icon-camera', 4500);
  }

  function showFallback(blob: Blob) {
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = URL.createObjectURL(blob);
  }

  async function save() {
    busy = true;
    try {
      const blob = await render();
      if (!blob) {
        app.toast('이미지를 만들지 못했어요.', 'warn', 'icon-warn');
        return;
      }
      if (caps.download && downloadBlob(blob, fileName)) {
        app.toast('카드를 PNG로 저장했어요.', 'good', 'icon-download');
        done();
      } else {
        showFallback(blob);
      }
    } finally {
      busy = false;
    }
  }

  async function copy() {
    busy = true;
    try {
      const blob = await render();
      if (blob && (await copyImage(blob))) {
        app.toast('카드를 복사했어요. 메신저에 붙여넣어 보세요.', 'good', 'icon-copy');
        done();
      } else {
        app.toast(
          '이 브라우저에서는 이미지 복사가 막혀 있어요. 저장을 이용해 주세요.',
          'warn',
          'icon-warn',
          5000,
        );
      }
    } finally {
      busy = false;
    }
  }

  async function share() {
    busy = true;
    try {
      const blob = await render();
      if (!blob) return;
      const result = await shareFile(blob, fileName, `${SITE_NAME}이 카드`);
      if (result === 'shared') done();
      else if (result === 'failed') showFallback(blob);
    } finally {
      busy = false;
    }
  }

  async function openImage() {
    const blob = await render();
    if (blob) showFallback(blob);
  }

  async function copyTextCard() {
    if (await copyText(text)) {
      app.toast('글자 카드를 복사했어요.', 'good', 'icon-copy');
      done();
    } else {
      showText = true;
    }
  }

  const RATIOS: { id: CardRatio; label: string }[] = [
    { id: 'square', label: '정사각형' },
    { id: 'portrait', label: '세로형' },
  ];
</script>

<div class="page">
  <Win title="카드 미리보기" icon="icon-image" id="card-preview" area="preview">
    {#snippet aside()}{size.w * EXPORT_SCALE}×{size.h * EXPORT_SCALE}px{/snippet}
    <div
      class="holder"
      bind:this={holder}
      role="img"
      aria-label="호봉이 카드 미리보기. {model.nickname}, {model.grade}급 {model.step}호봉, {model.formName}"
    >
      <canvas
        bind:this={canvas}
        class="preview"
        style="width:{(size.w * previewScale) / dpr}px;height:{(size.h * previewScale) / dpr}px"
        aria-hidden="true"
      ></canvas>
    </div>
  </Win>

  <Win title="카드 만들기" icon="icon-camera" id="card-options" area="options">
    <div class="stack wide">
      <div class="stack">
        <span class="muted" id="ratio-label">모양</span>
        <div class="chips" role="radiogroup" aria-labelledby="ratio-label">
          {#each RATIOS as ratio (ratio.id)}
            <button
              type="button"
              class="chip"
              role="radio"
              aria-checked={card.ratio === ratio.id}
              onclick={() => setCard({ ratio: ratio.id })}
            >
              {ratio.label}
            </button>
          {/each}
        </div>
      </div>

      <fieldset class="stack">
        <legend class="muted">카드에 담을 것</legend>
        <label class="switch">
          <input
            type="checkbox"
            checked={card.showBadges}
            onchange={(e) => setCard({ showBadges: e.currentTarget.checked })}
          />
          <span class="box" aria-hidden="true"></span>
          <span>뱃지</span>
        </label>
        <label class="switch">
          <input
            type="checkbox"
            checked={card.showTenure}
            onchange={(e) => setCard({ showTenure: e.currentTarget.checked })}
          />
          <span class="box" aria-hidden="true"></span>
          <span>재직기간</span>
        </label>
        <label class="switch">
          <input
            type="checkbox"
            checked={card.showRetirement}
            onchange={(e) => setCard({ showRetirement: e.currentTarget.checked })}
          />
          <span class="box" aria-hidden="true"></span>
          <span>정년 D-day <span class="cap muted">나이를 짐작할 수 있어요</span></span>
        </label>
        <label class="switch">
          <input
            type="checkbox"
            checked={card.showSalary}
            onchange={(e) => setCard({ showSalary: e.currentTarget.checked })}
          />
          <span class="box" aria-hidden="true"></span>
          <span>월 봉급 <span class="cap muted">금액이 그대로 보여요</span></span>
        </label>
        <p class="cap muted">금액과 정년은 기본으로 꺼져 있어요. 켠 것만 카드에 들어가요.</p>
      </fieldset>

      <div class="btn-row stretch">
        <button type="button" class="btn primary" onclick={save} disabled={busy}>
          <Icon name="icon-download" /> PNG로 저장
        </button>
        {#if caps.copyImage}
          <button type="button" class="btn" onclick={copy} disabled={busy}>
            <Icon name="icon-copy" /> 이미지 복사
          </button>
        {/if}
        {#if caps.shareFiles}
          <button type="button" class="btn" onclick={share} disabled={busy}>
            <Icon name="icon-share" /> 공유
          </button>
        {/if}
      </div>
      <button type="button" class="btn small ghost link" onclick={openImage}>
        저장이 안 되나요? 이미지로 열기
      </button>
      {#if !caps.copyImage}
        <p class="cap muted">이 브라우저에서는 이미지 복사를 쓸 수 없어 저장만 제공해요.</p>
      {/if}
    </div>
  </Win>

  <Win title="글자 카드" icon="icon-text" id="card-text" area="text">
    <div class="stack wide">
      <pre class="well textcard">{text}</pre>
      <div class="btn-row">
        <button type="button" class="btn" onclick={copyTextCard}>
          <Icon name="icon-copy" /> 글자로 복사
        </button>
      </div>
      <p class="cap muted">이미지를 붙일 수 없는 메신저용이에요. 금액은 넣지 않아요.</p>
    </div>
  </Win>
</div>

{#if fallbackUrl}
  <Modal
    title="이미지로 열기"
    icon="icon-image"
    wide
    onclose={() => {
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
      fallbackUrl = null;
    }}
  >
    <div class="stack wide">
      <p>아래 이미지를 길게 누르거나 마우스 오른쪽 버튼으로 눌러 저장·복사해 주세요.</p>
      <img class="fallback" src={fallbackUrl} alt="호봉이 카드" />
    </div>
  </Modal>
{/if}

{#if showText}
  <Modal title="글자 카드" icon="icon-text" onclose={() => (showText = false)}>
    <div class="stack wide">
      <p>복사가 막혀 있어요. 아래 글자를 직접 골라 복사해 주세요.</p>
      <textarea class="input" readonly rows="6" onfocus={(e) => e.currentTarget.select()}
        >{text}</textarea
      >
    </div>
  </Modal>
{/if}

<style>
  .page {
    display: grid;
    gap: 9px;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'preview'
      'options'
      'text';
    align-items: start;
  }
  .holder {
    display: flex;
    justify-content: center;
    overflow: hidden;
  }
  .preview {
    image-rendering: crisp-edges;
    image-rendering: pixelated;
    max-width: 100%;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 3px;
  }
  .textcard {
    margin: 0;
    font: inherit;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: all;
    -webkit-user-select: all;
  }
  .link {
    justify-content: flex-start;
    width: fit-content;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .fallback {
    width: 100%;
    height: auto;
    image-rendering: pixelated;
    box-shadow: var(--frame);
  }
  @media (min-width: 720px) {
    .page {
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas:
        'preview options'
        'preview text';
    }
  }
</style>
