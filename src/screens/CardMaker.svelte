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
  import { formatDday, formatSpan, formatWon, josa, MASKED_WON } from '../lib/app/format.ts';
  import { session, type CardKind } from '../lib/app/session.svelte.ts';
  import { app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { formatKorean } from '../lib/calc/date.ts';
  import { recapRevealsService } from '../lib/calc/recap.ts';
  import {
    CARD_SIZES,
    cardRankStep,
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
  import { resolveLook, resolveProp } from '../lib/character/look.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { SITE_NAME, SITE_TAGLINE, SITE_URL } from '../lib/config.ts';
  import type { CardRatio, CardSettings } from '../lib/store/schema.ts';
  import { TALK } from '../lib/talk.ts';
  import ChipRadio from '../lib/ui/ChipRadio.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Win from '../lib/ui/Win.svelte';
  import RecapOptions from './card/RecapOptions.svelte';
  import ShareNote from './share/ShareNote.svelte';

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

  /** 카드의 호봉이가 손에 든 소품(호봉 소품·들지 않기면 null). 직렬·직종을 짐작하게 할 수 있어 알린다 */
  const heldProp = $derived.by(() => {
    const p = resolveProp(characterRules, view.characterLook.prop, view.propOwner);
    return p === null || p === 'step' ? null : p;
  });
  /** 카드에 넣는 계급 이름: '계급 이름 넣기'를 켰을 때만(경찰·소방·우정 계급 이름은 직종을 드러낸다) */
  const cardRank = $derived(card.showRank ? view.rankLabel : '');
  /** 다음 승급: 정기승급을 계산하지 않는 직종은 입력한 날까지의 D-day 만(진행 막대 없음) */
  const cardRaise = $derived.by<CardModel['raise']>(() => {
    if (view.raiseProgress && view.nextRaise)
      return { ratio: view.raiseProgress.ratio, dday: formatDday(view.today, view.nextRaise.date) };
    if (view.noRaiseReason === 'manual' && view.profile.nextStepDate > view.today)
      return { ratio: null, dday: formatDday(view.today, view.profile.nextStepDate) };
    return null;
  });
  const model = $derived<CardModel>({
    nickname: view.profile.nickname,
    rankLabel: cardRank,
    step: view.step,
    // 최고호봉(깃 n/m 의 m, 게이지 칸 수)도 봉급표를 드러낸다(교원 40·우정1급 24 등). 계급 이름을 넣을 때만
    maxStep: cardRank ? view.maxStep : null,
    formName: view.look.form.name,
    // 카드에는 언제 찍어도 같은 근무 중 모습을 담는다(기분·시간대에 따라 달라지지 않게).
    look: resolveLook(
      characterRules,
      view.formId,
      view.step,
      'work',
      view.characterLook,
      view.propOwner,
    ),
    line: view.line,
    dateText: formatKorean(view.today, false),
    raise: cardRaise,
    maxReached: view.noRaiseReason === 'max' || view.noRaiseReason === 'retire',
    facts: [
      // 직렬은 소속을 짐작하게 할 수 있어 '직렬 이름 넣기'(기본 끔)를 켰을 때만
      // 직접 적은 이름(#38)은 '직렬'을 붙이지 않고 그대로(view.seriesCardText)
      ...(card.showSeries && view.seriesCardText ? [view.seriesCardText] : []),
      // 일수까지 적으면 카드 날짜에서 임용일이 하루 단위로 역산되므로 연·월까지만 쓴다.
      ...(card.showTenure ? [`재직 ${formatSpan({ ...view.tenure, days: 0 })}`] : []),
      ...(card.showRetirement && view.retireDate !== null && view.career
        ? [
            `정년 ${formatDday(view.today, view.retireDate)} (${(view.career.ratio * 100).toFixed(1)}% 왔어요)`,
          ]
        : []),
      // 카드는 앱 밖으로 나가므로 금액이 봉급표 기준(수당·공제 전)임을 카드 안에도 적는다.
      ...(card.showSalary && view.salary ? [salaryFact(formatWon(view.salary.amount))] : []),
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
            view.salary && f === salaryFact(formatWon(view.salary.amount))
              ? salaryFact(MASKED_WON)
              : f,
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
    look: resolveLook(
      characterRules,
      view.formId,
      view.step,
      'work',
      view.characterLook,
      view.propOwner,
    ),
    formName: view.look.form.name,
    rankLabel: cardRank,
    step: view.step,
    stepText: recapStepText(recap),
    facts: recapFacts(recap, { workdays: recapWorkdaysOn }),
    badges: recap.badges.map((b) => ({ icon: b.icon, tier: b.tier })),
    salary: session.recapSalary && recap.earned !== null ? formatWon(recap.earned) : null,
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
    hideAmounts &&
      (kind === 'recap'
        ? session.recapSalary && recap.earned !== null
        : card.showSalary && view.salary !== null),
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
  type CardSwitch = Exclude<keyof CardSettings, 'ratio'>;
  /**
   * 카드 스위치를 바꾼다. 다른 탭이 바꾼 저장본을 따라가느라 버렸으면(app 이 알린다) 스위치를 지금 저장값으로
   * 되돌린다 — checked 는 한쪽으로만 묶여 있어 따라간 값이 누르기 전과 같으면 다시 그려지지 않는다(부록 J13)
   */
  function toggleCard(key: CardSwitch, el: HTMLInputElement) {
    if (app.updateSettings({ card: { ...card, [key]: el.checked } }, false) || !app.data) return;
    el.checked = app.data.settings.card[key];
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
          cardRankStep(recapPreviewModel),
          ...(recapPreviewModel.stepText ? [`승급 ${recapPreviewModel.stepText}`] : []),
          ...recapPreviewModel.facts.map((f) => `${f.label} ${f.value}`),
          ...(recapPreviewModel.salary !== null && !recapOmitted.salary
            ? [`${RECAP_SALARY_LABEL} ${recapPreviewModel.salary}`]
            : []),
          ...(recapPreviewModel.grid !== null && !recapOmitted.calendar ? ['1년 달력'] : []),
        ].join(', ')}`
      : `호봉이 카드 미리보기. ${[model.nickname, cardRankStep(model), model.formName, ...drawnFacts].join(', ')}`
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

      {#if heldProp}
        <p class="cap muted" id="card-prop-hint">
          카드의 호봉이는 {josa(heldProp.name, '을', '를')} 들고 있어요. 이름을 넣지 않아도 소품으로 직렬·직종이
          짐작될 수 있어요(설정 '호봉이 꾸미기'에서 바꾸거나 '들지 않기'를 골라요).
        </p>
      {/if}

      {#if view.rankLabel}
        <div class="stack">
          <label class="switch" id="card-show-rank">
            <input
              type="checkbox"
              checked={card.showRank}
              aria-describedby="card-show-rank-hint"
              onchange={(e) => toggleCard('showRank', e.currentTarget)}
            />
            <span class="box" aria-hidden="true"></span>
            <span>계급 이름 넣기</span>
          </label>
          <p class="cap muted" id="card-show-rank-hint">
            경찰·소방·우정 같은 계급 이름은 직종을 드러낼 수 있어요. 끄면 최고호봉(깃 칸 수)도 넣지
            않아요. 홈 화면에 보일지는 설정 '내 정보'에서 정해요.
          </p>
        </div>
      {/if}

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
          {#if view.seriesName}
            <label class="switch" id="card-show-series">
              <input
                type="checkbox"
                checked={card.showSeries}
                aria-describedby="card-show-series-hint"
                onchange={(e) => toggleCard('showSeries', e.currentTarget)}
              />
              <span class="box" aria-hidden="true"></span>
              <span>직렬 이름 넣기</span>
            </label>
            <p class="cap muted" id="card-show-series-hint">
              직렬은 소속을 짐작하게 할 수 있어 기본으로 넣지 않아요.
              <!-- 직접 적은 이름(#38)에는 정해진 소품이 없어 소품으로 짐작된다는 말이 맞지 않는다 -->
              {#if !view.seriesOwn}
                넣지 않아도 호봉이가 든 소품으로 짐작될 수 있어요(소품은 설정 '호봉이 꾸미기'에서
                바꿔요).
              {/if}
            </p>
          {/if}
          <label class="switch">
            <input
              type="checkbox"
              checked={card.showBadges}
              onchange={(e) => toggleCard('showBadges', e.currentTarget)}
            />
            <span class="box" aria-hidden="true"></span>
            <span>배지</span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={card.showTenure}
              onchange={(e) => toggleCard('showTenure', e.currentTarget)}
            />
            <span class="box" aria-hidden="true"></span>
            <span>재직기간 <span class="cap muted">임용 시기를 짐작할 수 있어요</span></span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={card.showRetirement}
              onchange={(e) => toggleCard('showRetirement', e.currentTarget)}
            />
            <span class="box" aria-hidden="true"></span>
            <span>정년 D-day <span class="cap muted">나이를 짐작할 수 있어요</span></span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={card.showSalary}
              onchange={(e) => toggleCard('showSalary', e.currentTarget)}
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
      <hr class="rule" />
      <!-- 카드(내 정보가 담긴다)와 달리 사이트 주소만 전하는 알리기 -->
      <div id="card-tell">
        <ShareNote wit={false} lead={TALK.share.card} />
      </div>
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
          금액 가리기가 켜져 있어요. 내보내는 이미지에는 올해 번 봉급({formatWon(
            recap.earned ?? 0,
          )}, 봉급표 기준 추정치)이 그대로 들어가요.
        </p>
        <p class="cap muted">금액을 빼려면 '올해 번 봉급'을 끄고 저장해 주세요.</p>
      {:else}
        <p>
          금액 가리기가 켜져 있어요. 내보내는 이미지에는 월 봉급 금액({formatWon(
            view.salary?.amount ?? 0,
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
