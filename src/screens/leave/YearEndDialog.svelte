<script lang="ts">
  /**
   * 연말 정리 도우미(#33 묶음 2) — 그 해 12월 31일에 남는 연가를 소멸·보상·저축으로 나눠 보고, 저축을 통장에 넣는다.
   * 국가공무원 복무규정 제16조제5항·제16조의2·제16조의3제1항, 복무·징계 예규 (2)(나)·(다)·(6)가·(9)(라).
   * 기관이 정하는 값(보상하지 않는 일수·보상 한도)은 사용자가 넣는다. 저장하는 것은 그 해 정리 값(leave.years)과
   * 그 해 말 저축 한 칸(leave.savings 의 carry)뿐이다(파생 값은 저장하지 않는다).
   */
  import { untrack } from 'svelte';
  import { cite as citeOf } from '../../lib/app/cite.ts';
  import { MASKED_WON } from '../../lib/app/format.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { yearOf } from '../../lib/calc/date.ts';
  import {
    bonusLeaveHint,
    leftoverDays,
    overCapUnsavedDays,
    prorateDays,
    yearEndSplit,
  } from '../../lib/calc/leave-bank.ts';
  import { formatLeaveHours, serviceMonthsInYear } from '../../lib/calc/leave.ts';
  import { isAvailable } from '../../lib/rules/index.ts';
  import type { Unavailable } from '../../lib/rules/types.ts';
  import { LIMITS } from '../../lib/store/schema.ts';
  import Modal from '../../lib/ui/Modal.svelte';
  import Money from '../../lib/ui/Money.svelte';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Stepper from '../../lib/ui/Stepper.svelte';

  interface Props {
    year: number;
    onclose: () => void;
  }
  let { year, onclose }: Props = $props();

  const saving = $derived(
    isAvailable(view.careerRules.leave.saving) ? view.careerRules.leave.saving : null,
  );
  const hpd = $derived(view.leave.hoursPerDay);
  const laws = $derived(view.rules.laws);
  const hidden = $derived(view.data.settings.hideAmounts);
  const stored = untrack(() => view.data.leave.years[String(year)] ?? null);
  const carries = untrack(() =>
    view.data.leave.savings.filter((s) => s.kind === 'carry' && s.year === year),
  );
  const base = untrack(() => app.dataGeneration);

  /** 비워 두면 null(모름). 정수 0~60 만 받는다 */
  let unpaidText = $state(stored?.unpaidDays != null ? String(stored.unpaidDays) : '');
  let capText = $state(stored?.capDays != null ? String(stored.capDays) : '');
  const parse = (text: string): number | null | 'bad' => {
    const t = text.trim();
    if (t === '') return null;
    if (!/^\d{1,2}$/.test(t)) return 'bad';
    const n = Number(t);
    return n > LIMITS.maxLeaveYearDays ? 'bad' : n;
  };
  const unpaidParsed = $derived(parse(unpaidText));
  const capParsed = $derived(parse(capText));
  const unpaid = $derived(unpaidParsed === 'bad' ? null : unpaidParsed);
  const cap = $derived(capParsed === 'bad' ? null : capParsed);

  /** 정리 값(보상 일수 없이)으로 본 그 해 장부와 한도 */
  // 이 대화상자는 그 해 말 저축을 다시 정하므로, 넣어 둔 저축(carry)을 보상 상한에서 빼지 않고 본다
  const comp0 = $derived(
    view.leaveCompFor({ unpaidDays: unpaid, capDays: cap }, year, { excludeCarry: true }),
  );
  const rule = $derived(comp0 && comp0.kind !== 'needsGrant' ? comp0.rule : null);
  const book = $derived(
    !comp0 || comp0.kind === 'needsGrant' ? null : comp0.kind === 'year' ? comp0.end : comp0,
  );
  const retiring = $derived(view.retireDate !== null && yearOf(view.retireDate) === year);
  const split = $derived(
    book && rule
      ? yearEndSplit({
          grantedHours: book.grantedHours,
          usedAnnualHours: book.usedHours,
          hoursPerDay: hpd,
          unpaidDays: unpaid,
          capDays: cap,
          maxDays: rule.maxDays,
          retiringThisYear: retiring,
          autoCarryUnderDay: saving?.autoCarryUnderDay ?? null,
        })
      : null,
  );
  /** 보상 상한: 정리 표의 상한과 어림의 상한(퇴직하는 해 10일 등) 중 작은 것 */
  const maxComp = $derived(split && book ? Math.min(split.maxCompDays, book.maxDays) : 0);
  const canSave = $derived(saving !== null && !retiring);

  // 고른 값(처음에는 저장된 값, 없으면 보상 최대 · 저축은 넣어 둔 그 해 저축)
  const firstCarry = carries[0];
  let compDays = $state(0);
  let saveDays = $state(0);
  /** 사용자가 Stepper 를 바꿨는지. 건드리지 않았으면 저장할 때 넣어 둔 값(보상 일수 null·저축 시간)을 그대로 둔다 */
  let compTouched = $state(false);
  let saveTouched = $state(false);
  /** 저축을 늘려 보상을 저절로 줄였을 때 한 번 알리는 문장 */
  let autoCut = $state('');
  let seeded = false;
  $effect(() => {
    if (seeded || !split) return;
    seeded = true;
    untrack(() => {
      const auto = split.autoSaveHours;
      saveDays = canSave
        ? Math.min(split.poolDays, Math.floor(Math.max(0, (firstCarry?.hours ?? 0) - auto) / hpd))
        : 0;
      const want = stored?.compDays ?? maxComp;
      compDays = Math.max(0, Math.min(want, maxComp, split.poolDays - saveDays));
    });
  });
  /** 보상 상한: 정리 표의 상한과, 저축으로 고른 날을 뺀 나머지 중 작은 것 */
  const compMax = $derived(split ? Math.max(0, Math.min(maxComp, split.poolDays - saveDays)) : 0);
  /** 저축 상한: 보상 또는 저축할 수 있는 날 전부(저축을 늘리면 보상이 그만큼 줄어든다) */
  const saveMax = $derived(split && canSave ? split.poolDays : 0);
  // 보상 일수를 고르지 않았으면(넣어 둔 값도 없음) 늘 최대를 따라가고, 골랐으면 상한을 넘을 때만 맞춘다.
  // 저축을 늘려 보상이 줄었으면 한 번 알린다
  $effect(() => {
    if (saveDays > saveMax) saveDays = saveMax;
    const follow = !compTouched && stored?.compDays == null;
    const from = untrack(() => compDays);
    const target = follow ? compMax : Math.min(from, compMax);
    if (target !== from) {
      compDays = target;
      if (untrack(() => saveTouched) && target < from)
        autoCut = `저축을 늘려 보상을 ${days(from)}에서 ${days(target)}로 줄였어요.`;
    }
  });

  /** 저장된 보상 일수가 지금 한도보다 컸다(계산이 잘랐다) */
  const clampedFrom = $derived(
    stored?.compDays != null && stored.compDays > maxComp ? stored.compDays : null,
  );

  const leftover = $derived(split ? leftoverDays(split, compDays, saveDays) : 0);
  const over = $derived(split && rule ? overCapUnsavedDays(split, saveDays, cap, rule.maxDays) : 0);
  const bonusOff = $derived<Unavailable | null>(
    saving && saving.uncompensatedBonus === null
      ? {
          status: 'pending',
          reason:
            '연가보상비를 받지 못한 날이 남을 때 다음 해 연가가 늘어나는지 가리는 방법을 이 직종의 원문으로 확인하지 못했어요.',
        }
      : null,
  );
  const hint = $derived(
    saving?.uncompensatedBonus != null &&
      bonusLeaveHint(over, year, view.profile.hireDate, retiring),
  );
  /** 연도 중 임용·퇴직한 해: 기관 공지 일수가 한 해 기준이면 근무한 달만큼 줄어든다(예규 (5)가) */
  const months = $derived(
    serviceMonthsInYear(
      view.profile.hireDate,
      year,
      view.careerRules.leave.firstYear.minDaysForMonth,
      view.retireDate ?? undefined,
    ),
  );
  const prorated = $derived(
    unpaid !== null && months < 12 && months > 0 ? prorateDays(unpaid, months) : null,
  );

  /** 고른 보상 일수로 본 어림(금액) */
  const comp = $derived(
    view.leaveCompFor({ ...stored, unpaidDays: unpaid, capDays: cap, compDays: compDays }, year, {
      excludeCarry: true,
    }),
  );
  const autoSave = $derived(split && canSave ? split.autoSaveHours : 0);
  /** 통장에 넣을 그 해 말 저축. 저축 Stepper 를 건드리지 않았으면 넣어 둔 값(일·시간)을 그대로 둔다 */
  const carryHours = $derived(
    !saveTouched && firstCarry ? firstCarry.hours : saveDays * hpd + autoSave,
  );
  /** 보상 일수를 직접 고른 값으로 볼지('(넣은 값)') — 건드리지 않았고 넣어 둔 값도 없으면 '최대로 보면' */
  const compChosen = $derived(compTouched || stored?.compDays != null);
  /** 이 해가 지금 해인지(1월에 지난해를 정리하면 '올해'라고 하지 않고, 예정 기록도 없다) */
  const isThisYear = $derived(year === view.leave.year);
  const days = (n: number) => `${n}일`;
  const hours = (h: number) => formatLeaveHours(h, hpd);
  const inputError = $derived(
    unpaidParsed === 'bad' || capParsed === 'bad'
      ? `일수는 0부터 ${LIMITS.maxLeaveYearDays}까지 숫자로 넣어 주세요. 모르면 비워 두세요.`
      : '',
  );

  function save() {
    if (inputError || !split) return;
    // 닫으면(onclose) 부모가 이 대화상자를 치우며 year 등이 바뀔 수 있다 — 알림에 쓸 값을 먼저 잡아 둔다
    const y = year;
    const carry = canSave ? carryHours : (firstCarry?.hours ?? 0);
    const said = canSave && carry > 0 ? hours(carry) : '';
    const from = saving?.availableFrom === 'nextYear' ? `${y + 1}년 1월 1일부터` : '';
    // 보상 일수를 건드리지 않았으면 넣어 둔 값(없으면 null — '최대로 보면')을 그대로 둔다
    const keepComp = compTouched ? compDays : (stored?.compDays ?? null);
    const kept = app.applyYearEnd(
      y,
      { unpaidDays: unpaid, capDays: cap, compDays: split.poolDays > 0 ? keepComp : null },
      carry,
      base,
    );
    if (kept) {
      app.toast(
        said
          ? `${y}년 정리를 저장했어요. 저축 ${said}은 ${from ? `${from} 쓸 수 있어요.` : '저축연가 통장에 넣었어요.'}`
          : `${y}년 정리를 저장했어요.`,
        'good',
        'icon-calendar',
      );
    }
    onclose();
  }
</script>

<Modal title="{year}년 연가 정리" icon="icon-calendar" {onclose} wide>
  <div class="stack wide">
    {#if !split || !rule || !book}
      <p class="note">이 해의 연가를 셀 수 없어요. 부여 일수를 넣은 뒤 다시 열어 주세요.</p>
    {:else}
      <p class="kv">
        <span>12월 31일에 남는 연가</span>
        <strong>{hours(split.remainingHours)}</strong>
      </p>
      <p class="cap muted">
        부여 {hours(book.grantedHours)} − {isThisYear ? '올해' : `${year}년`} 연가에서 쓴 {hours(
          book.usedHours,
        )}{isThisYear ? '(예정 기록 포함)' : ''}. 저축연가에서 쓴 기록은 빼지 않아요.
      </p>

      {#if split.remainingHours <= 0}
        <p class="note warn" id="year-end-over">
          올해 연가를 다 썼어요.{split.overUsedHours > 0
            ? ` 넘겨 쓴 ${hours(split.overUsedHours)}은 저축연가에서 빠지거나 다음 재직기간 연가를 미리 쓴 것으로 처리되고, 둘 다 없으면 결근으로 볼 수 있어요.`
            : ''} 기관 인사시스템에서 확인해 주세요.
        </p>
      {:else}
        <fieldset class="org">
          <legend>기관이 정한 것 <span class="cap muted">모르면 비워 두세요</span></legend>
          <div class="field">
            <label for="year-end-unpaid">보상하지 않는 일수(권장 연가·사용 촉진)</label>
            <input
              id="year-end-unpaid"
              class="input short"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={unpaidText}
              aria-describedby="year-end-unpaid-hint"
              data-autofocus
            />
            <span class="hint cap" id="year-end-unpaid-hint">
              {saving?.recommended
                ? `기관이 3월 31일까지 권장 연가 일수와 보상 여부를 알려요(${citeOf(laws, { law: 'service', article: '제16조의2' })}). 보상하지 않는다고 한 날 안에서 못 쓴 연가는 보상도 저축도 되지 않아요.`
                : '기관이 보상하지 않기로 한 일수가 있으면 넣어 주세요. 그 안에서 못 쓴 연가는 보상도 저축도 되지 않아요.'}
            </span>
            {#if prorated !== null && prorated !== unpaid}
              <button
                type="button"
                class="btn small"
                onclick={() => (unpaidText = String(prorated))}
              >
                근무한 {months}개월만큼 줄이기: {days(unpaid as number)} → {days(prorated)}
              </button>
            {/if}
          </div>
          <div class="field">
            <label for="year-end-cap">기관의 보상 한도</label>
            <input
              id="year-end-cap"
              class="input short"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={capText}
              aria-describedby="year-end-cap-hint"
            />
            <span class="hint cap" id="year-end-cap-hint">
              비우면 규정 상한 {days(rule.maxDays)}로 셈해요. 예산에 따라 기관이 줄일 수 있어요.
            </span>
          </div>
          <!-- 경고는 넣는 값이 틀렸을 때만 보인다(대화상자를 열자마자 읽지 않는다) -->
          {#if inputError}<p class="note warn" role="alert">{inputError}</p>{/if}
        </fieldset>

        <dl class="rows">
          {#if split.lapseUnpaidDays > 0}
            <div class="kv">
              <dt>
                사라지는 날 <span class="cap muted">(보상하지 않는 날 안에서 못 쓴 연가)</span>
              </dt>
              <dd>{days(split.lapseUnpaidDays)}</dd>
            </div>
          {/if}
          <div class="kv">
            <dt>보상 또는 저축할 수 있는 날</dt>
            <dd><strong>{days(split.poolDays)}</strong></dd>
          </div>
          {#if canSave && split.autoSaveHours > 0}
            <div class="kv">
              <dt>8시간 미만 끝자리는 저절로 저축돼요</dt>
              <dd>{hours(split.autoSaveHours)}</dd>
            </div>
          {/if}
        </dl>
        {#if split.unknownUnpaid}
          <p class="cap muted">보상하지 않는 일수를 넣지 않아 0일로 셈했어요.</p>
        {/if}
        {#if retiring}
          <p class="note" id="year-end-retire">
            올해 정년퇴직해서 저축하지 않아요. 퇴직하면 저축연가는 정해진 몇 가지 경우를 빼고
            보상비가 없어요. 8시간 미만 끝자리는 기관에 확인해 주세요.
          </p>
        {:else if split.autoSaveUnknown}
          <p class="cap muted">
            8시간 미만 끝자리를 저절로 저축하는지는 이 직종의 원문으로 확인하지 못했어요.
          </p>
        {/if}

        {#if split.poolDays > 0}
          <div class="split">
            <Stepper
              id="year-end-comp"
              label="보상"
              bind:value={compDays}
              min={0}
              max={compMax}
              unit="일"
              hint={`최대 ${days(maxComp)}${compMax < maxComp ? ` · 저축을 줄이면 ${days(maxComp)}까지 늘릴 수 있어요` : ''}`}
              onchange={() => {
                compTouched = true;
                autoCut = '';
              }}
            />
            {#if canSave}
              <Stepper
                id="year-end-save"
                label="저축"
                bind:value={saveDays}
                min={0}
                max={saveMax}
                unit="일"
                hint="저축을 늘리면 보상이 그만큼 줄어요"
                onchange={() => (saveTouched = true)}
              />
            {/if}
          </div>
          <div class="cap" aria-live="polite" id="year-end-left">
            <p>고르지 않은 날 {days(leftover)}</p>
            {#if leftover > 0}
              <p class="muted">
                고르지 않은 날은 보상도 저축도 되지 않는 것으로 셈했어요. 실제 처리는 기관
                인사시스템에서 확인해 주세요.
              </p>
            {/if}
            {#if autoCut}<p class="muted" id="year-end-auto-cut">{autoCut}</p>{/if}
          </div>
          {#if clampedFrom !== null}
            <p class="cap muted">
              넣어 둔 보상 일수({days(clampedFrom)})가 한도보다 커서 {days(maxComp)}로 셈했어요.
            </p>
          {/if}
          {#if canSave && split.poolDays > split.capDays}
            <!-- T25(규정 상한 20일을 넘는 날)·T26(기관 한도를 넘는 날)의 저축: 원문으로 확인하지 못했다 -->
            <p class="cap muted" id="year-end-over-20">
              {split.capDays < rule.maxDays
                ? `기관 보상 한도(${days(split.capDays)})를`
                : `규정 상한(${days(rule.maxDays)})을`} 넘는 날도 저축할 수 있는지는 원문으로 확인하지
              못했어요. 기관에 확인해 주세요.
            </p>
          {/if}
        {/if}

        {#if comp && comp.kind !== 'needsGrant'}
          {@const total = comp.kind === 'year' ? comp.end.total : comp.total}
          {@const net = comp.kind === 'year' ? comp.end.net : comp.total}
          {@const midPaid = comp.kind === 'year' ? comp.end.midPaid : 0}
          {#if total !== null && net !== null}
            <p class="sum" id="year-end-sum">
              보상 {days(compDays)}{compChosen ? '(넣은 값)' : '(최대로 보면)'} →
              {#if hidden}
                12월 정산 {MASKED_WON}
              {:else if net >= 0}
                {comp.kind === 'retire' ? '퇴직 때' : '12월에'}
                <strong><Money value={net} approx /></strong>
              {:else}
                12월에 <strong><Money value={-net} approx /></strong> 환수{midPaid
                  ? '(6월분을 받았다고 보고 셈했어요)'
                  : ''}
              {/if}
            </p>
          {/if}
        {/if}

        {#if hint}
          <p class="note" id="year-end-bonus">
            한도를 넘어 보상받지 못하고 저축하지도 않은 날이 있으면 내년 연가가 1일 늘 수 있어요(그
            해 결근·휴직·정직·직위해제 등이 없고, 그 해 1월 2일 이후에 임용되지 않았을 때 — {saving?.uncompensatedBonus
              ? citeOf(laws, saving.uncompensatedBonus.source)
              : ''}, 예규). 해당하면 내년에 부여 일수를 고쳐 주세요.
          </p>
        {:else if bonusOff && over > 0}
          <OffNote label="내년 연가 가산" off={bonusOff} id="year-end-bonus-off" />
        {/if}
        {#if carries.length > 1}
          <p class="cap muted">
            {year}년 말 저축 줄이 {carries.length}개 있어요. 여기서는 첫 줄만 고쳐요. 나머지는
            저축연가 통장에서 고쳐 주세요.
          </p>
        {/if}
      {/if}
      <p class="cap muted">
        참고용 정리예요. 실제 보상·저축 일수는 소속 기관 인사시스템이 기준이에요.
      </p>
    {/if}
  </div>
  {#snippet actions()}
    <button type="button" class="btn" onclick={onclose}>닫기</button>
    {#if split && split.remainingHours > 0}
      <button type="button" class="btn primary" onclick={save} disabled={inputError !== ''}>
        {canSave && carryHours > 0 ? `저축 ${hours(carryHours)}을 통장에 넣기` : '저장'}
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .org {
    display: grid;
    gap: 9px;
    margin: 0;
    padding: 9px;
    border: 0;
    background: var(--panel-2);
  }
  .org legend {
    padding: 0;
    font-weight: 700;
  }
  .input.short {
    max-width: 120px;
  }
  .rows {
    display: grid;
    gap: 3px;
    margin: 0;
  }
  dt,
  dd {
    margin: 0;
  }
  /* 좁은 화면(320px)에서 값이 밖으로 밀리지 않게 설명과 값을 줄바꿈한다 */
  .rows .kv {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0 9px;
  }
  .rows dt {
    min-width: 0;
    flex: 1 1 12em;
  }
  dd {
    white-space: nowrap;
    flex-shrink: 0;
  }
  #year-end-left p {
    margin: 0;
  }
  .split {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .sum {
    margin: 0;
  }
  .field .btn {
    justify-self: start;
  }
</style>
