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
  import { formatDday, formatSpan, formatWon, MASKED_WON } from '../lib/app/format.ts';
  import { session, type CardKind } from '../lib/app/session.svelte.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { formatKorean } from '../lib/calc/date.ts';
  import { recapRevealsService } from '../lib/calc/recap.ts';
  import {
    CARD_SIZES,
    drawCard,
    ensureCardFonts,
    EXPORT_SCALE,
    textCard,
    type CardModel,
    type CardOmitted,
  } from '../lib/card/render.ts';
  import {
    drawRecapCard,
    RECAP_SALARY_LABEL,
    recapFacts,
    recapPeriodText,
    recapStepText,
    recapTextCard,
    type RecapCardModel,
    type RecapOmitted,
  } from '../lib/card/recap.ts';
  import { resolveLook } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '../lib/config.ts';
  import type { CardRatio, CardSettings } from '../lib/store/schema.ts';
  import ChipRadio from '../lib/ui/ChipRadio.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Win from '../lib/ui/Win.svelte';
  import RecapOptions from './card/RecapOptions.svelte';

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

  /** 금액 가리기가 켜져 있으면 미리보기에서는 금액을 가린다(저장할 때만 확인을 받고 넣는다) */
  const hideAmounts = $derived(view.data.settings.hideAmounts);
  const salaryFact = (amount: string) => `월 봉급 ${amount}(봉급표 기준)`;

  const model = $derived<CardModel>({
    nickname: view.profile.nickname,
    rank: view.profile.rank ?? '',
    step: view.step,
    maxStep: view.maxStep,
    formName: view.look.form.name,
    // 카드에는 언제 찍어도 같은 근무 중 모습을 담는다(기분·시간대에 따라 달라지지 않게).
    look: resolveLook(characterRules, view.profile.rank, view.step, 'work'),
    line: view.line,
    dateText: formatKorean(view.today, false),
    raise:
      view.raiseProgress && view.nextRaise
        ? { ratio: view.raiseProgress.ratio, dday: formatDday(view.today, view.nextRaise.date) }
        : null,
    facts: [
      // 일수까지 적으면 카드 날짜에서 임용일이 하루 단위로 역산되므로 연·월까지만 쓴다.
      ...(card.showTenure ? [`재직 ${formatSpan({ ...view.tenure, days: 0 })}`] : []),
      ...(card.showRetirement
        ? [
            `정년 ${formatDday(view.today, view.retire.retireDate)} (${(view.career.ratio * 100).toFixed(1)}% 왔어요)`,
          ]
        : []),
      // 카드는 앱 밖으로 나가므로 금액이 봉급표 기준(수당·공제 전)임을 카드 안에도 적는다.
      ...(card.showSalary ? [salaryFact(formatWon(view.salary.amount))] : []),
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
  /** 화면에 보이는 미리보기용: 금액 가리기가 켜져 있으면 금액을 가린다 */
  const previewModel = $derived<CardModel>(
    hideAmounts && card.showSalary
      ? {
          ...model,
          facts: model.facts.map((f) =>
            f === salaryFact(formatWon(view.salary.amount)) ? salaryFact(MASKED_WON) : f,
          ),
        }
      : model,
  );
  // ── 올해 결산 카드 ────────────────────────────────────────────────
  const kind = $derived(session.cardKind);
  const recap = $derived(view.recap);
  /** 올해 재직한 날이 없으면(지난해 이전 정년퇴직 등) 결산 카드를 만들지 않는다 */
  const recapReady = $derived(recap.status === 'active');
  /** 올해 임용·정년퇴직: 근무일·1년 달력을 기본으로 빼 둔다(재직 시작·끝을 짐작할 수 있다) */
  const recapEdge = $derived(recapRevealsService(recap));
  const recapCalendarOn = $derived(session.recapShows('recapCalendar', recapEdge));
  const recapWorkdaysOn = $derived(session.recapShows('recapWorkdays', recapEdge));
  const recapModel = $derived<RecapCardModel>({
    nickname: view.profile.nickname,
    year: recap.year,
    periodText: recapPeriodText(recap),
    look: resolveLook(characterRules, view.profile.rank, view.step, 'work'),
    formName: view.look.form.name,
    rank: view.profile.rank ?? '',
    step: view.step,
    stepText: recapStepText(recap),
    facts: recapFacts(recap, { workdays: recapWorkdaysOn }),
    badges: recap.badges.map((b) => ({ icon: b.icon, tier: b.tier })),
    salary: session.recapSalary ? formatWon(recap.earned) : null,
    grid: recapCalendarOn ? view.yearGrid : null,
    siteName: SITE_NAME,
    siteTagline: SITE_TAGLINE,
    siteUrl: SITE_URL,
  });
  const recapPreviewModel = $derived<RecapCardModel>(
    hideAmounts && recapModel.salary !== null ? { ...recapModel, salary: MASKED_WON } : recapModel,
  );
  let recapOmitted = $state<RecapOmitted>({ calendar: false, salary: false });

  /** 저장·복사 전에 금액이 들어간다고 확인받아야 하는지 */
  const needsAmountConfirm = $derived(
    hideAmounts && (kind === 'recap' ? session.recapSalary : card.showSalary),
  );
  /** 내보낼 수 있는지(결산이 없는 해에는 막는다) */
  const exportable = $derived(kind === 'character' || recapReady);
  const text = $derived(kind === 'recap' ? recapTextCard(recapModel) : textCard(model));
  /** 화면용: '(D-217)'·'D-10,810' 같은 덩어리는 줄바꿈 없이 붙여 보이게 나눈다(복사되는 글자는 같다) */
  const textParts = $derived(
    text.split(/(\(?D[-+](?:DAY|[\d,]+)\)?)/).map((part, i) => ({ part, keep: i % 2 === 1 })),
  );
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
    if (kind === 'recap') {
      if (ctx) recapOmitted = drawRecapCard(ctx, recapPreviewModel, card.ratio, previewScale);
      return;
    }
    if (ctx) omitted = drawCard(ctx, previewModel, card.ratio, previewScale);
    // 정사각형에서 빠진 것이 세로형에는 다 들어가는지 재 둔다(안내 문구를 사실대로 고른다)
    if (card.ratio === 'square') {
      const probe = document.createElement('canvas');
      probe.width = CARD_SIZES.portrait.w;
      probe.height = CARD_SIZES.portrait.h;
      const pctx = probe.getContext('2d');
      portraitFits = pctx ? drawCard(pctx, previewModel, 'portrait', 1).facts.length === 0 : false;
    }
  });
  let portraitFits = $state(true);

  /** 자리가 모자라 카드에 들어가지 못한 것(미리보기를 그릴 때 정해진다) */
  let omitted = $state<CardOmitted>({ facts: [], badges: false });
  const FACT_NAMES: [string, string][] = [
    ['재직', '재직기간'],
    ['정년', '정년 D-day'],
    ['월 봉급', '월 봉급'],
  ];
  const factName = (fact: string) =>
    FACT_NAMES.find(([prefix]) => fact.startsWith(prefix))?.[1] ?? fact;
  const omittedNames = $derived([
    ...omitted.facts.map(factName),
    ...(omitted.badges ? ['배지'] : []),
  ]);
  const drawnFacts = $derived(previewModel.facts.filter((fact) => !omitted.facts.includes(fact)));

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
    if (kind === 'recap') drawRecapCard(ctx, recapModel, card.ratio, EXPORT_SCALE);
    else drawCard(ctx, model, card.ratio, EXPORT_SCALE);
    return canvasToBlob(out);
  }

  /** 미리보기의 낭독 문구: 카드에 실제로 들어간 항목까지 그대로 읽는다 */
  const previewLabel = $derived(
    (kind === 'recap'
      ? `올해 결산 카드 미리보기. ${[
          recapPreviewModel.nickname,
          `${recapPreviewModel.year}년 ${recapPreviewModel.periodText}`,
          `${recapPreviewModel.rank}급 ${recapPreviewModel.step}호봉`,
          ...(recapPreviewModel.stepText ? [`승급 ${recapPreviewModel.stepText}`] : []),
          ...recapPreviewModel.facts.map((f) => `${f.label} ${f.value}`),
          ...(recapPreviewModel.salary !== null && !recapOmitted.salary
            ? [`${RECAP_SALARY_LABEL} ${recapPreviewModel.salary}`]
            : []),
          ...(recapPreviewModel.grid !== null && !recapOmitted.calendar ? ['1년 달력'] : []),
        ].join(', ')}`
      : `호봉이 카드 미리보기. ${[model.nickname, `${model.rank}급 ${model.step}호봉`, model.formName, ...drawnFacts].join(', ')}`
    ).replaceAll(MASKED_WON, '금액 가림'),
  );
  const fileName = $derived(
    kind === 'recap'
      ? // 결산 카드 파일 이름에는 날짜를 넣지 않는다(근무일과 함께 임용일을 거꾸로 셀 수 있다)
        `hobong-recap-${recap.year}.png`
      : `hobong-card-${view.today.replaceAll('-', '')}.png`,
  );

  function done() {
    if (app.grantEvent('evt-card')) app.toast('새 배지: 첫 카드', 'good', 'icon-camera', 4500);
  }

  function showFallback(blob: Blob) {
    if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
    fallbackUrl = URL.createObjectURL(blob);
  }

  /** 금액 가리기가 켜져 있는데 금액을 넣어 내보내려 할 때, 한 번 확인받고 이어서 할 일 */
  let pendingExport = $state<(() => Promise<void>) | null>(null);
  function guarded(action: () => Promise<void>): () => void {
    return () => {
      if (needsAmountConfirm) pendingExport = action;
      else void action();
    };
  }
  function confirmExport() {
    const action = pendingExport;
    pendingExport = null;
    if (action) void action();
  }

  async function save() {
    busy = true;
    try {
      const blob = await render();
      if (!blob) {
        app.toast('이미지를 만들지 못했어요. 다시 눌러 보세요.', 'warn', 'icon-warn');
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
      const result = await shareFile(
        blob,
        fileName,
        kind === 'recap' ? `${SITE_NAME}이 ${recap.year} 결산` : `${SITE_NAME}이 카드`,
      );
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

  const KINDS: { value: CardKind; label: string }[] = [
    { value: 'character', label: '캐릭터 카드' },
    { value: 'recap', label: '올해 결산' },
  ];
  const RATIOS: { id: CardRatio; label: string }[] = [
    { id: 'square', label: '정사각형' },
    { id: 'portrait', label: '세로형' },
  ];
</script>

<div class="page">
  <Win
    title={kind === 'recap' ? '결산 미리보기' : '카드 미리보기'}
    icon="icon-image"
    id="card-preview"
    area="preview"
  >
    {#snippet aside()}{size.w * EXPORT_SCALE}×{size.h * EXPORT_SCALE}px{/snippet}
    <div class="holder" bind:this={holder}>
      {#if exportable}
        <div role="img" aria-label={previewLabel}>
          <canvas
            bind:this={canvas}
            class="preview"
            style="width:{(size.w * previewScale) / dpr}px;height:{(size.h * previewScale) / dpr}px"
            aria-hidden="true"
          ></canvas>
        </div>
      {:else}
        <p class="muted" id="recap-none">올해는 재직한 날이 없어 결산이 없어요.</p>
      {/if}
    </div>
    {#if kind === 'recap'}
      {#if exportable && recapOmitted.calendar}
        <p class="cap muted" role="status" id="card-omitted">
          이 모양에는 달력이 들어가지 않아요. 세로형을 골라 보세요.
        </p>
      {:else if exportable && recapOmitted.salary}
        <p class="cap muted" role="status" id="card-omitted">
          자리가 모자라 이 모양에는 올해 번 봉급을 넣지 못했어요. 1년 달력을 끄면 들어갈 수 있어요.
        </p>
      {/if}
    {:else if omitted.facts.length > 0}
      <!-- 직접 켠 글(재직·정년·금액)이 빠질 때만 알린다 -->
      <p class="cap muted" role="status" id="card-omitted">
        자리가 모자라 이 모양에는 넣지 못했어요: {omittedNames.join(', ')}. {card.ratio === 'square'
          ? portraitFits
            ? '세로형에는 더 들어가요.'
            : '다른 항목을 끄면 들어갈 수 있어요.'
          : '다른 항목을 끄면 들어갈 수 있어요.'}
      </p>
    {:else if omitted.badges}
      <!-- 배지만 빠질 때는 경고가 아니라 이 모양의 생김새를 설명한다(기본 설정에서도 보이므로) -->
      <p class="cap muted" id="card-badge-note">
        {card.ratio === 'square'
          ? '정사각형에는 켠 항목이 있으면 배지 줄이 들어가지 않아요. 배지는 세로형에서 보여요.'
          : '켠 항목이 많으면 배지 줄은 빠져요. 항목을 하나 끄면 배지가 들어가요.'}
      </p>
    {/if}
  </Win>

  <Win title="카드 만들기" icon="icon-camera" id="card-options" area="options">
    <div class="stack wide">
      <div class="stack">
        <span class="muted" id="kind-label">카드 종류</span>
        <ChipRadio
          labelledby="kind-label"
          options={KINDS}
          value={kind}
          onchange={(value) => (session.cardKind = value)}
        />
      </div>
      <div class="stack">
        <span class="muted" id="ratio-label">모양</span>
        <ChipRadio
          labelledby="ratio-label"
          options={RATIOS.map((r) => ({ value: r.id, label: r.label }))}
          value={card.ratio}
          onchange={(ratio) => setCard({ ratio })}
        />
      </div>

      {#if kind === 'recap'}
        <RecapOptions
          {hideAmounts}
          holidaysKnown={recap.holidaysKnown}
          {recap}
          edge={recapEdge}
          calendarOn={recapCalendarOn}
          workdaysOn={recapWorkdaysOn}
        />
      {:else}
        <fieldset class="stack">
          <legend class="muted">카드에 담을 것</legend>
          <label class="switch">
            <input
              type="checkbox"
              checked={card.showBadges}
              onchange={(e) => setCard({ showBadges: e.currentTarget.checked })}
            />
            <span class="box" aria-hidden="true"></span>
            <span>배지</span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={card.showTenure}
              onchange={(e) => setCard({ showTenure: e.currentTarget.checked })}
            />
            <span class="box" aria-hidden="true"></span>
            <span>재직기간 <span class="cap muted">임용 시기를 짐작할 수 있어요</span></span>
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
            <span>
              월 봉급 <span class="cap muted">봉급표 금액이 그대로 보여요(수당·공제 전)</span>
            </span>
          </label>
          {#if hideAmounts && card.showSalary}
            <p class="cap muted" id="card-amount-masked">
              금액 가리기가 켜져 있어 미리보기에서는 금액을 가려요. 저장·복사할 때 한 번 더
              물어봐요.
            </p>
          {/if}
          <p class="cap muted">금액과 정년은 기본으로 꺼져 있어요. 켠 것만 카드에 들어가요.</p>
        </fieldset>
      {/if}

      <div class="btn-row stretch">
        <button
          type="button"
          class="btn primary"
          onclick={guarded(save)}
          disabled={busy || !exportable}
        >
          <Icon name="icon-download" /> PNG로 저장
        </button>
        {#if caps.copyImage}
          <button type="button" class="btn" onclick={guarded(copy)} disabled={busy || !exportable}>
            <Icon name="icon-copy" /> 이미지 복사
          </button>
        {/if}
        {#if caps.shareFiles}
          <button type="button" class="btn" onclick={guarded(share)} disabled={busy || !exportable}>
            <Icon name="icon-share" /> 공유
          </button>
        {/if}
      </div>
      <button
        type="button"
        class="btn small ghost link"
        onclick={guarded(openImage)}
        disabled={!exportable}
      >
        저장이 안 되나요? 이미지로 열기
      </button>
      {#if !caps.copyImage}
        <p class="cap muted">이 브라우저에서는 이미지 복사를 쓸 수 없어 저장만 제공해요.</p>
      {/if}
    </div>
  </Win>

  <Win title="글자 카드" icon="icon-text" id="card-text" area="text">
    <div class="stack wide">
      <pre class="well textcard">{#each textParts as { part, keep }, i (i)}{#if keep}<span
              class="nobr">{part}</span
            >{:else}{part}{/if}{/each}</pre>
      <div class="btn-row">
        <button type="button" class="btn" onclick={copyTextCard} disabled={!exportable}>
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
      <img
        class="fallback"
        src={fallbackUrl}
        alt={kind === 'recap' ? '호봉이 결산 카드' : '호봉이 카드'}
      />
    </div>
  </Modal>
{/if}

{#if pendingExport}
  <Modal title="금액을 넣을까요?" icon="icon-warn" onclose={() => (pendingExport = null)}>
    <div class="stack wide">
      {#if kind === 'recap'}
        <p>
          금액 가리기가 켜져 있어요. 내보내는 이미지에는 올해 번 봉급({formatWon(recap.earned)},
          봉급표 기준 추정치)이 그대로 들어가요.
        </p>
        <p class="cap muted">금액을 빼려면 '올해 번 봉급'을 끄고 저장해 주세요.</p>
      {:else}
        <p>
          금액 가리기가 켜져 있어요. 내보내는 이미지에는 월 봉급 금액({formatWon(
            view.salary.amount,
          )}, 봉급표 기준)이 그대로 들어가요.
        </p>
        <p class="cap muted">금액을 빼려면 '월 봉급'을 끄고 저장해 주세요.</p>
      {/if}
    </div>
    {#snippet actions()}
      <button type="button" class="btn" data-autofocus onclick={() => (pendingExport = null)}>
        취소
      </button>
      <button type="button" class="btn primary" onclick={confirmExport}>금액 넣어 내보내기</button>
    {/snippet}
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
    /* 'D-217' 같은 덩어리가 중간에서 끊기지 않게 낱말 단위로 넘긴다 */
    overflow-wrap: break-word;
    word-break: keep-all;
    user-select: all;
    -webkit-user-select: all;
  }
  /* word-break: keep-all 은 'D-' 뒤에서 끊기는 것을 막지 못하므로 덩어리째 붙인다 */
  .nobr {
    white-space: nowrap;
  }
  .link {
    justify-content: flex-start;
    width: fit-content;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* 1080px 이미지를 화면 폭에 맞춰 줄여 보이므로(정수배가 아니다) 부드럽게 줄인다 */
  .fallback {
    width: 100%;
    height: auto;
    image-rendering: auto;
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
