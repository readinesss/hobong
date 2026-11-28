<script lang="ts">
  /**
   * 저축연가 통장(#33 묶음 2) — 국가공무원 복무규정 제16조의3·제11조제4항, 복무·징계 예규 제8장 4. 가. (6)·(10).
   * 넣은 것(처음 잔액·연말 저축·시간외근무 저축)에서 저축연가로 쓴 기록을 먼저 저축한 것부터 뺀다(leave-bank.ts savingsLedger).
   * 화면은 직종 이름이 아니라 규정 데이터(leave.saving 의 칸)와 계산 결과만 본다. 참고용 장부다.
   */
  import { untrack } from 'svelte';
  import { cite as citeOf } from '../../lib/app/cite.ts';
  import { formatMonthDayMaybeYear } from '../../lib/app/format.ts';
  import {
    fromText,
    fullDayText,
    lotTitle,
    shortageText,
  } from '../../lib/app/leave-saving-copy.ts';
  import { focusAfterDismiss } from '../../lib/app/dismiss.ts';
  import { session } from '../../lib/app/session.svelte.ts';
  import { app } from '../../lib/app/state.svelte.ts';
  import { view } from '../../lib/app/view.svelte.ts';
  import { yearOf, type Ymd } from '../../lib/calc/date.ts';
  import { formatLeaveHours } from '../../lib/calc/leave.ts';
  import { isAvailable } from '../../lib/rules/index.ts';
  import type { Unavailable } from '../../lib/rules/types.ts';
  import { LIMITS, type SavingsEntry, type SavingsKind } from '../../lib/store/schema.ts';
  import DismissButton from '../../lib/ui/DismissButton.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import Modal from '../../lib/ui/Modal.svelte';
  import MonthInput from '../../lib/ui/MonthInput.svelte';
  import OffNote from '../../lib/ui/OffNote.svelte';
  import Stepper from '../../lib/ui/Stepper.svelte';
  import Win from '../../lib/ui/Win.svelte';

  interface Props {
    /** [부여 일수 고치기](연가 화면의 대화상자) */
    onEditGrant: () => void;
    /** [연말 정리](연가 화면의 대화상자) */
    onYearEnd: () => void;
    /** 모자란 기록으로 가기(그날을 고른다) */
    onPick: (date: Ymd) => void;
  }
  let { onEditGrant, onYearEnd, onPick }: Props = $props();

  const ledger = $derived(view.savings);
  const rule = $derived(
    isAvailable(view.careerRules.leave.saving) ? view.careerRules.leave.saving : null,
  );
  const hpd = $derived(view.leave.hoursPerDay);
  const laws = $derived(view.rules.laws);
  const today = $derived(view.today);
  const hours = (h: number) => formatLeaveHours(h, hpd);
  /** 쓰기 시작하는 날·쓰는 순서를 그 직종의 원문으로 확인하지 못했으면 그 까닭(지방 일반직 등) */
  const datesOff = $derived<Unavailable | null>(
    ledger && !ledger.datesKnown
      ? {
          status: 'pending',
          reason: `저축연가를 언제부터 어떤 순서로 쓰는지는 이 직종의 원문으로 확인하지 못했어요. 넣은 것에서 쓴 것을 뺀 합계만 보여 드려요.`,
        }
      : null,
  );
  const retireDate = $derived(view.retireDate);
  const retiringThisYear = $derived(retireDate !== null && yearOf(retireDate) === view.leave.year);
  /** 정년퇴직하는 해의 연말 저축(퇴직하는 해에는 저축하지 않는다 — 거부하지 않고 알린다) */
  const retireCarry = $derived(
    retireDate !== null &&
      view.data.leave.savings.some((s) => s.kind === 'carry' && s.year === yearOf(retireDate)),
  );
  const overrideAbove = $derived.by(() => {
    const c = view.leaveComp;
    if (!c || c.kind === 'needsGrant') return false;
    return c.kind === 'year' ? c.end.overrideAboveAuto : c.overrideAboveAuto;
  });
  /** 그 해·고친 값마다 한 번 닫는다(값이 바뀌면 다시 뜬다, #15 와 같은 방식) */
  const overrideKey = $derived(
    `leave-savings-override:${view.leave.year}:${view.leave.grantedHours}`,
  );
  const showOverride = $derived(overrideAbove && !session.isDismissed(overrideKey));
  /** 고친 부여 − 자동 계산(일 단위): 저축연가를 부여에 더해 두었다면 옮길 만큼 */
  const overrideExtraDays = $derived(
    Math.max(0, Math.floor((view.leave.grantedHours - view.leave.autoHours) / hpd)),
  );
  const MOVED_MEMO = '부여 일수에서 옮김';
  const MOVED_HINT =
    '이미 저축연가로 쉰 날은 기록 목록에서 [저축연가로]를 눌러 바꿔 주세요. 그래야 올해 연가와 통장이 맞아요.';
  function closeOverride() {
    session.dismiss(overrideKey);
    void focusAfterDismiss();
  }
  const canYearEnd = $derived(view.leaveComp !== null && view.leaveComp.kind !== 'needsGrant');
  const md = (d: Ymd) => formatMonthDayMaybeYear(d, today, false);

  // ── 넣기·고치기 대화상자 ──────────────────────────────────────────────
  /** moved: 부여 일수에 더해 둔 저축연가를 옮기는 중(띠의 [통장에 넣기]) */
  type Draft = { id: string | null; kind: SavingsKind; moved?: boolean };
  let draft = $state<Draft | null>(null);
  let year = $state(0);
  let days = $state(0);
  let rest = $state(0);
  let month = $state('');
  let otHours = $state(8);
  let memo = $state('');
  /** 값을 한 번 바꾸었거나 넣기를 눌렀다(그 전에는 오류 문장을 보이지 않는다 — 열자마자 읽지 않게) */
  let touched = $state(false);
  /** 넣지 못했을 때의 까닭(대화상자를 닫지 않는다) */
  let failed = $state('');
  let base = 0;
  const thisMonth = $derived(today.slice(0, 7));

  function open(kind: SavingsKind, entry?: SavingsEntry, moved = false) {
    const now = view.leave.year;
    draft = { id: entry?.id ?? null, kind, moved };
    year = entry?.year ?? now - 1;
    days =
      entry && kind !== 'overtime' ? Math.floor(entry.hours / hpd) : moved ? overrideExtraDays : 0;
    rest = entry && kind !== 'overtime' ? entry.hours % hpd : 0;
    month = entry?.month ?? thisMonth;
    otHours = entry && kind === 'overtime' ? entry.hours : 8;
    memo = entry?.memo ?? (moved ? MOVED_MEMO : '');
    touched = false;
    failed = '';
    base = untrack(() => app.dataGeneration);
  }

  const draftHours = $derived(draft?.kind === 'overtime' ? otHours : days * hpd + rest);
  const monthError = $derived(
    draft?.kind !== 'overtime'
      ? ''
      : month === ''
        ? '저축한 달을 넣어 주세요.'
        : month > thisMonth
          ? '앞으로의 달은 넣을 수 없어요. 저축한 뒤에 넣어 주세요.'
          : Number(month.slice(0, 4)) < Math.max(LIMITS.minLeaveYear, yearOf(view.profile.hireDate))
            ? '임용 전의 달은 넣을 수 없어요. 저축한 달을 다시 넣어 주세요.'
            : '',
  );
  const draftError = $derived(
    monthError ||
      (draftHours < 1
        ? '1시간 이상 넣어 주세요.'
        : draftHours >
            (draft?.kind === 'overtime' ? LIMITS.maxOvertimeSavingHours : LIMITS.maxSavingHours)
          ? '한 줄에 넣을 수 있는 시간을 넘었어요. 나눠 넣어 주세요.'
          : ''),
  );

  function save() {
    touched = true;
    if (!draft || draftError) return;
    const kind = draft.kind;
    const moved = draft.moved === true;
    const entry = {
      kind,
      year: kind === 'overtime' ? Number(month.slice(0, 4)) : year,
      month: kind === 'overtime' ? month : null,
      hours: draftHours,
      memo,
    };
    const editing = draft.id;
    // 넣지 못하면(형식·개수 한도·다른 탭) 대화상자를 닫지 않고 까닭을 보인다 — 넣은 값을 잃지 않게
    const notSaved = '넣지 못했어요. 값을 확인하고 다시 눌러 주세요.';
    if (editing) {
      if (!app.updateSaving(editing, entry, base)) {
        failed = notSaved;
        base = untrack(() => app.dataGeneration);
        return;
      }
      draft = null;
      app.toast('저축연가 줄을 고쳤어요.', 'good', 'icon-pencil');
      return;
    }
    const id = app.addSaving(entry, base);
    if (!id) {
      failed =
        view.data.leave.savings.length >= LIMITS.maxSavings
          ? `저축 줄은 ${LIMITS.maxSavings}줄까지 넣을 수 있어요. 지난 줄을 지운 뒤 넣어 주세요.`
          : notSaved;
      base = untrack(() => app.dataGeneration);
      return;
    }
    draft = null;
    app.toast(
      `${kind === 'overtime' ? '시간외근무 저축' : '저축연가'} ${hours(entry.hours)}을 넣었어요.${moved ? ` ${MOVED_HINT}` : ''}`,
      'good',
      'icon-hourglass',
      moved ? 12000 : 6000,
      { label: '되돌리기', run: () => void app.removeSaving(id) },
    );
  }

  function remove(entry: SavingsEntry) {
    const removed = app.removeSaving(entry.id);
    if (!removed) return;
    app.toast(`${lotTitle(removed)} 줄을 지웠어요.`, 'info', 'icon-trash', 6000, {
      label: '되돌리기',
      run: () => app.restoreSaving(removed),
    });
  }
</script>

{#if ledger && rule}
  <Win title="저축연가" icon="icon-hourglass" id="leave-savings" area="savings">
    {#snippet aside()}참고용{/snippet}
    <div class="stack wide">
      <div class="kv">
        <span>{ledger.datesKnown ? '지금 쓸 수 있는 것' : '남은 저축연가'}</span>
        <strong class="big" id="leave-savings-available">{hours(ledger.availableHours)}</strong>
      </div>
      {#if ledger.pendingHours > 0 && ledger.nextFrom}
        <p class="cap muted" id="leave-savings-pending">
          {fullDayText(ledger.nextFrom)}부터 {hours(ledger.pendingHours)} 더 쓸 수 있어요.
        </p>
      {/if}
      {#if ledger.plannedHours > 0}
        <p class="cap muted">예정 기록이 {hours(ledger.plannedHours)} 더 빼 가요.</p>
      {/if}

      {#if showOverride}
        <div class="note warn band" id="leave-savings-override">
          <div class="band-body">
            <p>
              저축연가를 부여 일수에 더해 두셨다면 이 통장으로 옮기고 부여 일수를 되돌려 주세요.
              {MOVED_HINT} 가산 연가만 더했다면 그대로 두세요.
            </p>
            <div class="btn-row">
              <button
                type="button"
                class="btn small"
                onclick={() => open('opening', undefined, true)}
              >
                <Icon name="icon-plus" /> 통장에 넣기
              </button>
              <button type="button" class="btn small" onclick={onEditGrant}>
                <Icon name="icon-pencil" /> 부여 일수 고치기
              </button>
            </div>
          </div>
          <DismissButton label="저축연가 옮기기 안내 닫기" onclick={closeOverride} />
        </div>
      {/if}

      {#each ledger.shortages as s (s.recordId)}
        <div class="note warn short">
          <p>
            {shortageText(s, hpd, today)}
            {ledger.datesKnown
              ? '그날은 아직 쓸 수 없는 저축분을 빼고 셈했어요.'
              : '넣은 저축연가보다 많이 썼어요.'}
          </p>
          <button type="button" class="btn small" onclick={() => onPick(s.date)}>
            {md(s.date)} 기록 보기
          </button>
        </div>
      {/each}

      {#if retireCarry}
        <p class="note warn" id="leave-savings-retire-carry">
          퇴직하는 해({yearOf(retireDate as Ymd)}년)의 연말 저축이 들어 있어요. 퇴직하면 저축연가는
          정해진 몇 가지 경우를 빼고 보상받지 못해요.
        </p>
      {:else if retiringThisYear && ledger.availableHours + ledger.pendingHours > 0}
        <p class="note" id="leave-savings-retire">
          올해 정년퇴직해요. 퇴직하면 저축연가는 정해진 몇 가지 경우를 빼고 보상받지 못해요.
        </p>
      {/if}

      {#if ledger.lots.length === 0}
        <p class="note" id="leave-savings-empty">
          인사시스템에 나온 저축연가가 있으면 넣어 두세요. 연말에는 남은 연가를 저축으로 옮길 수
          있어요.
        </p>
      {:else}
        <ul class="lots">
          {#each ledger.lots as lot (lot.entry.id)}
            {@const waiting = ledger.datesKnown && lot.from !== null && lot.from > today}
            <li>
              <div class="grow stack">
                <span>{lotTitle(lot.entry)}</span>
                <span class="cap muted">
                  {hours(lot.entry.hours)} · {lot.leftHours === 0
                    ? '다 씀'
                    : `남음 ${hours(lot.leftHours)}`}{waiting && lot.from
                    ? ` · ${fromText(lot.from)}`
                    : ''}{lot.entry.memo ? ` · ${lot.entry.memo}` : ''}
                </span>
              </div>
              <button
                type="button"
                class="btn small"
                onclick={() => open(lot.entry.kind, lot.entry)}
                aria-label="{lotTitle(lot.entry)} 고치기"
              >
                <Icon name="icon-pencil" />
              </button>
              <button
                type="button"
                class="btn small"
                onclick={() => remove(lot.entry)}
                aria-label="{lotTitle(lot.entry)} 지우기"
              >
                <Icon name="icon-trash" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="btn-row">
        <button type="button" class="btn small" onclick={() => open('opening')}>
          <Icon name="icon-plus" /> 처음 잔액 넣기
        </button>
        <button type="button" class="btn small" onclick={() => open('overtime')}>
          <Icon name="icon-clock" /> 시간외근무 저축 넣기
        </button>
        {#if canYearEnd}
          <button type="button" class="btn small" onclick={onYearEnd}>
            <Icon name="icon-calendar" /> 연말 정리
          </button>
        {/if}
      </div>

      {#if datesOff}<OffNote
          label="쓰는 때·순서"
          off={datesOff}
          id="leave-savings-dates-off"
        />{/if}
      <div class="foot cap muted">
        {#if ledger.datesKnown}
          <p>
            연말 저축은 다음 해 1월 1일부터, 시간외근무 저축은 다음 달 1일부터 쓰고, 먼저 저축한
            것부터 빠져요.
          </p>
        {/if}
        <p>
          저축연가는 정해진 몇 가지 경우를 빼고 연가보상비가 없어요({citeOf(laws, rule.source)}).
          {rule.expires === 'never' ? '저축연가는 사라지지 않아요(2024. 7. 2. 소멸시효 폐지).' : ''}
        </p>
        <p>참고용 장부예요. 공식 기록은 소속 기관 인사시스템이 기준이에요.</p>
      </div>
    </div>
  </Win>
{/if}

{#if draft}
  <Modal
    title={draft.kind === 'overtime'
      ? '시간외근무를 다음 달로 저축한 시간'
      : draft.kind === 'carry'
        ? '연말 저축 고치기'
        : draft.id
          ? '처음 잔액 고치기'
          : '처음 잔액 넣기'}
    icon="icon-hourglass"
    onclose={() => (draft = null)}
  >
    <div class="stack wide">
      {#if draft.kind === 'overtime'}
        <p class="cap" id="saving-ot-help">
          시간외근무수당 대신 연가로 바꿔 다음 달로 넘긴 시간이에요. 같은 달 안에 쓴 시간은 넣지
          않아요.{rule?.overtimeAvailableFrom === 'nextMonth'
            ? ' 시간외근무수당을 받는 5급 이하 공무원이 쓸 수 있고, 다음 달 1일부터 써요. 다음 달이 되면 취소할 수 없어요(예규).'
            : ''}
        </p>
        <MonthInput
          id="saving-month"
          label="저축한 달"
          bind:value={month}
          error={monthError}
          describedby="saving-ot-help"
        />
        <Stepper
          id="saving-ot-hours"
          label="다음 달로 넘긴 시간"
          bind:value={otHours}
          min={1}
          max={LIMITS.maxOvertimeSavingHours}
          unit="시간"
          onchange={() => (touched = true)}
        />
      {:else}
        <p class="cap" id="saving-opening-help">
          소속 기관 인사시스템에 나온 저축연가를 넣어 주세요. 참고용 장부예요.{draft.moved
            ? ` 부여 일수에서 자동 계산보다 많은 ${overrideExtraDays}일을 넣어 두었어요. 넣은 뒤 부여 일수를 되돌려 주세요. ${MOVED_HINT}`
            : ''}
        </p>
        <Stepper
          id="saving-year"
          label={draft.kind === 'carry' ? '저축한 해' : '언제까지 모인 것인가요(그해 말까지)'}
          bind:value={year}
          min={Math.max(LIMITS.minLeaveYear, yearOf(view.profile.hireDate))}
          max={view.leave.year}
          unit="년"
          hint={rule?.availableFrom === 'nextYear' ? `${year + 1}년 1월 1일부터 써요` : undefined}
          describedby="saving-opening-help"
        />
        <div class="grant">
          <Stepper
            id="saving-days"
            label="일"
            bind:value={days}
            min={0}
            max={200}
            unit="일"
            onchange={() => (touched = true)}
          />
          <Stepper
            id="saving-hours"
            label="시간"
            bind:value={rest}
            min={0}
            max={hpd - 1}
            unit="시간"
            onchange={() => (touched = true)}
          />
        </div>
      {/if}
      <div class="field">
        <label for="saving-memo">메모 <span class="cap muted">선택</span></label>
        <input
          id="saving-memo"
          class="input"
          type="text"
          maxlength={LIMITS.memoMax}
          autocomplete="off"
          bind:value={memo}
          aria-describedby="saving-memo-hint"
        />
        <span class="hint cap" id="saving-memo-hint">
          이름이나 민감한 내용은 적지 마세요. 임용정보 패키지 파일에 그대로 담겨요.
        </span>
      </div>
      {#if failed}<p class="note warn" role="alert" id="saving-failed">{failed}</p>{/if}
      {#if touched && draftError && !monthError}<p class="note warn" role="alert">
          {draftError}
        </p>{:else if draftHours < 1}<p class="cap muted">
          1시간 이상 넣으면 넣기를 누를 수 있어요.
        </p>{/if}
    </div>
    {#snippet actions()}
      <button type="button" class="btn" onclick={() => (draft = null)}>취소</button>
      <button
        type="button"
        class="btn primary"
        data-autofocus
        onclick={save}
        disabled={draftError !== ''}
      >
        {draft?.id ? '저장' : `${hours(Math.max(0, draftHours))} 넣기`}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .lots {
    display: grid;
    gap: 3px;
  }
  .lots li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 3px 6px 9px;
    background: var(--panel-2);
  }
  .grant {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .note.warn {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .note.warn p {
    margin: 0;
  }
  .note.band {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .band-body {
    display: grid;
    gap: 6px;
    justify-items: start;
    flex: 1;
    min-width: 0;
  }
  .foot {
    display: grid;
    gap: 3px;
  }
  .foot p {
    margin: 0;
  }
</style>
