<script lang="ts">
  import { tick } from 'svelte';
  import { anim } from '../lib/app/anim.svelte.ts';
  import { copyText, detectCapabilities, downloadText } from '../lib/app/files.ts';
  import { formatInstant } from '../lib/app/format.ts';
  import { nav } from '../lib/app/nav.svelte.ts';
  import { session } from '../lib/app/session.svelte.ts';
  import { APP_VERSION, app } from '../lib/app/state.svelte.ts';
  import { view } from '../lib/app/view.svelte.ts';
  import { formatKorean } from '../lib/calc/date.ts';
  import { checkWorkHours } from '../lib/calc/today.ts';
  import { characterRules } from '../lib/character/rules.ts';
  import { REPO_URL, SITE_URL } from '../lib/config.ts';
  import { LICENSE_NOTICES } from '../lib/licenses.ts';
  import { backupFileName } from '../lib/store/backup.ts';
  import { canEncrypt, encryptBackup } from '../lib/store/crypto.ts';
  import type { Profile, ThemeSetting, WorkHours } from '../lib/store/schema.ts';
  import ChipRadio from '../lib/ui/ChipRadio.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Modal from '../lib/ui/Modal.svelte';
  import Win from '../lib/ui/Win.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import ProfileForm from './ProfileForm.svelte';
  import LockDialog from './settings/LockDialog.svelte';
  import Sources from './settings/Sources.svelte';

  const caps = detectCapabilities();
  const settings = $derived(view.data.settings);
  const meta = $derived(view.data.meta);
  const profile = $derived(view.profile);

  let editing = $state(false);
  let importing = $state(false);
  let confirmReset = $state(false);
  let confirmUndo = $state(false);
  let showBackupText = $state(false);
  let backupText = $state('');
  /** backupText 가 암호를 건 내용인지 */
  let backupLocked = $state(false);
  /** backupText 를 만든 시각(복사에 성공하면 이 시각으로 내려받은 것으로 기록한다) */
  let backupAt = $state('');
  /** backupText 에 담긴 내용의 지문(복사할 때 그 뒤 바뀌었는지 본다) */
  let backupStamp = '';
  /** 글자 창을 열 때 이미 내용이 바뀌어 있었는지(토스트로 옛 암호문을 다시 열었을 때) */
  let backupStale = $state(false);
  /** 초기화 확인창에서 "먼저 내려받기"를 누른 뒤, 파일이 생긴 것을 확인했는지 */
  let resetDownloaded = $state(false);
  let resetConfirmed = $state(false);
  let workError = $state('');
  let showLicenses = $state(false);

  const hosted = typeof location !== 'undefined' && location.protocol !== 'file:';

  function saveProfile(next: Profile) {
    app.updateProfile(next);
    editing = false;
    app.toast('내 정보를 고쳤어요.', 'good', 'icon-check');
  }

  // ── 근무시간·월급날 ──────────────────────────────────────────────────
  function setWork(key: keyof WorkHours, value: string) {
    const next = { ...settings.work, [key]: value };
    const problem = checkWorkHours(next);
    workError = problem ?? '';
    if (!problem) app.updateSettings({ work: next });
  }
  function resetWork() {
    const w = view.rules.workHours;
    workError = '';
    app.updateSettings({
      work: { start: w.start, end: w.end, lunchStart: w.lunchStart, lunchEnd: w.lunchEnd },
    });
  }
  const paydayOptions = $derived(view.rules.payday.options);
  const customPayday = $derived(!paydayOptions.some((o) => o.day === settings.payday));
  function setPayday(day: number) {
    if (Number.isInteger(day) && day >= 1 && day <= 31) app.updateSettings({ payday: day });
  }

  // ── 화면 ─────────────────────────────────────────────────────────────
  const THEMES: { id: ThemeSetting; label: string }[] = [
    { id: 'auto', label: '기기 설정대로' },
    { id: 'light', label: '주간' },
    { id: 'dark', label: '야근 모드' },
  ];
  function setTheme(theme: ThemeSetting) {
    app.updateSettings({ theme }, false);
    if (theme === 'dark' && app.grantEvent('evt-night')) {
      app.toast('새 배지: 야근 모드', 'good', 'icon-moon', 4500);
    }
  }

  // 안내 띠의 '내 정보 고치기'로 들어오면 고치기 대화상자를 바로 연다
  $effect(() => {
    if (nav.editProfileRequested) {
      nav.editProfileRequested = false;
      editing = true;
    }
  });

  // ── 데이터 ───────────────────────────────────────────────────────────
  /** 모두 지우기 대화상자 안에서 내려받은 파일 이름(결과를 대화상자 안에 적는다) */
  let resetFileName = $state('');
  /** 백업 글자 대화상자의 복사 결과 */
  let copyResult = $state<{ ok: boolean; text: string } | null>(null);

  // ── 암호 걸기(#13) ── 저장하지 않는 화면 상태다. 암호 자체는 여기에 두지 않는다.
  const canLock = canEncrypt();
  let lock = $state(false);
  /** 암호 입력 대화상자: 파일로 내려받기 / 글자로 보기 */
  let lockMode = $state<'file' | 'text' | null>(null);
  /** 마지막으로 암호를 건 내용(암호문). '파일이 안 생겼어요'에서 암호를 다시 묻지 않고 보여 준다 */
  let lastLocked: { text: string; at: string; stamp: string } | null = null;

  function showText(text: string, at: string, stamp: string, locked: boolean) {
    backupText = text;
    backupAt = at;
    backupStamp = stamp;
    backupLocked = locked;
    backupStale = !app.isSameContent(stamp);
    copyResult = null;
    showBackupText = true;
  }

  async function lockAndExport(password: string) {
    const mode = lockMode;
    const { text, at, stamp } = app.exportBackup();
    // PBKDF2 를 기다리는 동안 다른 탭이 바꿀 수 있다. 백업 표시는 stamp 가 그대로일 때만 한다(markBackedUp).
    const sealed = await encryptBackup(text, password);
    if (!sealed.ok) return sealed.code;
    lastLocked = { text: sealed.text, at, stamp };
    lockMode = null;
    // 암호 대화상자가 닫히고 포커스가 돌아간 뒤에 다음 창을 연다
    await tick();
    if (mode === 'file') {
      const fileName = backupFileName(view.today, true);
      if (caps.download && downloadText(sealed.text, fileName)) {
        const action = {
          label: '파일이 안 생겼어요',
          run: () => lastLocked && showText(lastLocked.text, lastLocked.at, lastLocked.stamp, true),
        };
        if (app.markBackedUp(at, stamp)) {
          app.toast(
            `암호를 걸어 내려받기를 시작했어요. ${fileName} 파일이 생겼는지 확인해 주세요. 암호를 잊으면 되살릴 수 없어요.`,
            'good',
            'icon-lock',
            8000,
            action,
          );
        } else {
          app.toast(
            `암호를 걸어 내려받기를 시작했어요. 다만 암호를 거는 사이 다른 탭에서 바뀐 내용이 있어 ${fileName} 에는 들어 있지 않아요. 한 번 더 내려받아 주세요.`,
            'warn',
            'icon-warn',
            10000,
          );
        }
        return 'done' as const;
      }
    }
    showText(sealed.text, at, stamp, true);
    return 'done' as const;
  }

  /** inDialog: 대화상자 안에서 눌렀으면 결과를 알림 대신 그 대화상자 안에 적는다 */
  function download(inDialog = false): boolean {
    // 모두 지우기 안의 '먼저 내려받기'는 대화상자를 겹치지 않게 암호 없이 내려받는다(화면에 적어 둔다)
    if (lock && canLock && !inDialog) {
      lockMode = 'file';
      return false;
    }
    const { text, at, stamp } = app.exportBackup();
    const fileName = backupFileName(view.today);
    if (caps.download && downloadText(text, fileName)) {
      app.markBackedUp(at, stamp);
      // 브라우저는 저장이 끝났는지 알려 주지 않는다. 단정하지 않고 확인을 부탁한다.
      if (inDialog) {
        resetFileName = fileName;
        return true;
      }
      app.toast(
        `내려받기를 시작했어요. ${fileName} 파일이 생겼는지 확인해 주세요. 급여·인사 정보가 들어 있으니 보관에 주의해 주세요.`,
        'good',
        'icon-save',
        8000,
        { label: '파일이 안 생겼어요', run: () => openBackupText() },
      );
      return true;
    }
    showText(text, at, stamp, false);
    return false;
  }
  /** 글자로 보기. 암호 걸기를 켰으면 암호부터 묻는다 */
  function openBackupText() {
    if (lock && canLock) {
      lockMode = 'text';
      return;
    }
    openPlainText();
  }
  function openPlainText() {
    const { text, at, stamp } = app.exportBackup();
    showText(text, at, stamp, false);
  }
  function downloadBeforeReset() {
    if (download(true)) resetDownloaded = true;
  }
  function downloadCorrupt() {
    const copies = app.corruptCopies();
    copies.forEach((raw, i) => {
      const suffix = copies.length > 1 ? `-${i + 1}` : '';
      downloadText(raw, `hobong-unreadable-${view.today.replace(/-/g, '')}${suffix}.json`);
    });
    corruptDownloaded = true;
  }
  let corruptDownloaded = $state(false);
  async function copyBackup() {
    // 결과는 대화상자 안에 적는다(알림은 대화상자에 가려질 수 있다)
    if (await copyText(backupText)) {
      // 글자를 만든 뒤 내용이 바뀌었으면(다른 탭·토스트로 다시 연 옛 내용) 백업 표시를 바꾸지 않는다
      if (app.markBackedUp(backupAt, backupStamp)) {
        copyResult = {
          ok: true,
          text: '백업 내용을 복사했어요. 메모장 등에 붙여넣어 보관해 주세요.',
        };
      } else {
        backupStale = true;
        copyResult = {
          ok: false,
          text: '복사했어요. 다만 이 글자를 만든 뒤 바뀐 내용은 들어 있지 않아요. 창을 닫고 한 번 더 내려받아 주세요.',
        };
      }
    } else {
      copyResult = { ok: false, text: '복사가 막혀 있어요. 글자를 직접 골라 복사해 주세요.' };
    }
  }
  function undo() {
    confirmUndo = false;
    if (app.undoImport()) app.toast('불러오기 전 상태로 되돌렸어요.', 'good', 'icon-undo');
    else app.toast('되돌릴 수 있는 상태가 없어요.', 'warn', 'icon-warn');
  }
  function reset() {
    confirmReset = false;
    resetDownloaded = false;
    resetConfirmed = false;
    lastLocked = null;
    app.reset();
    // 이 탭에서만 기억하던 화면 상태(닫은 안내 띠·카드 종류)도 처음으로
    session.reset();
    nav.go('home');
  }
</script>

<div class="page">
  <!-- 좁은 폭에서는 .col 이 사라져(display: contents) 위에서 아래로 한 줄이 되고, 넓은 폭에서는
       열 묶음이 된다. 어느 폭에서나 DOM 순서 = 보이는 순서 = Tab 순서다. -->
  <div class="col c1">
    <Win title="내 정보" icon="icon-user" id="set-profile">
      <dl class="stack">
        <div class="kv">
          <dt>닉네임</dt>
          <dd>{profile.nickname}</dd>
        </div>
        <div class="kv">
          <dt>생년월일</dt>
          <dd>{formatKorean(profile.birthDate, false)}</dd>
        </div>
        <div class="kv">
          <dt>임용일</dt>
          <dd>{formatKorean(profile.hireDate, false)}</dd>
        </div>
        <div class="kv">
          <dt>직급·호봉</dt>
          <dd>{profile.grade}급 {view.step}호봉</dd>
        </div>
        {#if profile.gradeDate !== profile.hireDate}
          <div class="kv">
            <dt>현 직급 임용일</dt>
            <dd>{formatKorean(profile.gradeDate, false)}</dd>
          </div>
        {/if}
        <div class="kv">
          <dt>다음 승급일</dt>
          <dd>
            {view.nextRaise
              ? formatKorean(view.nextRaise.date, false)
              : view.noRaiseReason === 'retire'
                ? '정년 전 승급 없음'
                : '최고호봉'}
          </dd>
        </div>
        {#if profile.overrides.longServiceDate}
          <div class="kv">
            <dt>근속승진 요건일(직접)</dt>
            <dd>{formatKorean(profile.overrides.longServiceDate, false)}</dd>
          </div>
        {/if}
        {#if profile.overrides.seniorDate}
          <div class="kv">
            <dt>대우공무원 예정일(직접)</dt>
            <dd>{formatKorean(profile.overrides.seniorDate, false)}</dd>
          </div>
        {/if}
      </dl>
      <div class="btn-row">
        <button type="button" class="btn" onclick={() => (editing = true)}>
          <Icon name="icon-pencil" /> 고치기
        </button>
      </div>
      <p class="cap muted">
        승진했거나 승급일이 바뀌었으면 여기서 고쳐 주세요. 연가 기록과 업적은 그대로 남아요.
      </p>
    </Win>

    <Win title="데이터" icon="icon-save" id="set-data">
      <div class="stack wide">
        <p>
          입력한 내용은 이 브라우저에만 있어요. 파일로 내려받아 두면 다른 PC·브라우저에서나 저장소가
          지워진 뒤에도 그대로 이어서 쓸 수 있어요.
        </p>
        <dl class="well stack">
          <div class="kv">
            <dt>마지막 내려받기</dt>
            <dd>{meta.lastBackupAt ? formatInstant(meta.lastBackupAt) : '아직 없음'}</dd>
          </div>
          <div class="kv">
            <dt>그 뒤 바뀐 횟수</dt>
            <dd class="num">{meta.changesSinceBackup}번</dd>
          </div>
        </dl>
        {#if canLock}
          <label class="switch" id="set-lock">
            <input type="checkbox" bind:checked={lock} />
            <span class="box" aria-hidden="true"></span>
            <span>암호 걸기 <span class="cap muted">파일을 열 때 암호를 물어요</span></span>
          </label>
        {:else}
          <p class="cap muted" id="set-lock-unavailable">
            이 브라우저에서는 암호 기능(WebCrypto)을 쓸 수 없어 암호 없이만 내려받을 수 있어요.
          </p>
        {/if}
        <div class="btn-row stretch data-btns">
          <button type="button" class="btn primary" onclick={() => download()}>
            <Icon name="icon-download" /> 데이터 내려받기
          </button>
          <button type="button" class="btn" onclick={() => (importing = true)}>
            <Icon name="icon-upload" /> 데이터 불러오기
          </button>
        </div>
        <p class="note warn">
          백업 파일에는 생년월일·임용일·호봉 같은 인사 정보가 들어 있어요. 공용 PC나 공유 폴더에
          두지 말고, 메신저로 보낼 때도 주의해 주세요.
        </p>
        {#if !hosted}
          <p class="note" id="set-file-origin">
            파일(hobong.html)로 열어 쓰면 같은 PC·같은 브라우저로 여는 다른 HTML 파일과 저장소를
            함께 써요. 출처를 모르는 HTML 파일은 같은 브라우저로 열지 말고, 예전 hobong.html 사본은
            지워 주세요.
          </p>
        {/if}
        <button type="button" class="btn small ghost link" onclick={openBackupText}>
          파일 저장이 안 되나요? 글자로 보기
        </button>

        {#if app.corruptKept}
          <div class="well stack" id="set-corrupt">
            <p>
              예전에 읽지 못해 따로 옮겨 둔 데이터가 있어요. 내려받아 두면 나중에 새 버전에서 다시
              불러올 수 있어요.
            </p>
            <div class="btn-row">
              <button type="button" class="btn small" onclick={downloadCorrupt}>
                <Icon name="icon-download" /> 읽지 못한 데이터 내려받기
              </button>
              {#if corruptDownloaded}
                <button
                  type="button"
                  class="btn small ghost"
                  onclick={() => app.discardCorruptCopies()}
                >
                  <Icon name="icon-trash" /> 따로 둔 데이터 지우기
                </button>
              {/if}
            </div>
          </div>
        {/if}

        {#if app.undoSavedAt}
          <div class="well stack">
            <p>
              불러오기 직전 상태가 보관돼 있어요. <span class="cap muted">
                ({formatInstant(app.undoSavedAt)})
              </span>
            </p>
            <div class="btn-row">
              <button type="button" class="btn" onclick={() => (confirmUndo = true)}>
                <Icon name="icon-undo" /> 불러오기 전으로 되돌리기
              </button>
            </div>
          </div>
        {/if}

        <hr class="rule" />
        <div class="btn-row">
          <button
            type="button"
            class="btn danger"
            onclick={() => {
              resetDownloaded = false;
              resetConfirmed = false;
              confirmReset = true;
            }}
          >
            <Icon name="icon-trash" /> 모두 지우고 처음부터
          </button>
        </div>
      </div>
    </Win>
  </div>
  <div class="col c2">
    <div class="col c2a">
      <Win title="근무와 월급날" icon="icon-clock" id="set-work">
        <div class="stack wide">
          <fieldset class="stack">
            <legend>월급날</legend>
            <ChipRadio
              label="월급날"
              options={paydayOptions.map((o) => ({ value: o.day, label: `${o.day}일` }))}
              value={settings.payday}
              onchange={setPayday}
            />
            <p class="cap muted">
              {paydayOptions.find((o) => o.day === settings.payday)?.orgs ?? '직접 정한 날'} · 토요일이나
              공휴일이면 그 전날 받아요(보수규정 제20조).
            </p>
            <div class="field inline">
              <label for="set-payday">다른 날이면</label>
              <input
                id="set-payday"
                class="input"
                type="text"
                inputmode="numeric"
                maxlength="2"
                autocomplete="off"
                value={customPayday ? String(settings.payday) : ''}
                placeholder="1~31"
                onchange={(e) => {
                  const day = Number(e.currentTarget.value.replace(/\D/g, ''));
                  if (day >= 1 && day <= 31) setPayday(day);
                  else e.currentTarget.value = customPayday ? String(settings.payday) : '';
                }}
              />
              <span>일</span>
            </div>
          </fieldset>

          <fieldset class="stack">
            <legend>근무시간</legend>
            <div class="times">
              <div class="field">
                <label for="set-start">출근</label>
                <input
                  id="set-start"
                  class="input"
                  type="time"
                  value={settings.work.start}
                  onchange={(e) => setWork('start', e.currentTarget.value)}
                />
              </div>
              <div class="field">
                <label for="set-end">퇴근</label>
                <input
                  id="set-end"
                  class="input"
                  type="time"
                  value={settings.work.end}
                  onchange={(e) => setWork('end', e.currentTarget.value)}
                />
              </div>
              <div class="field">
                <label for="set-lunch-start">점심 시작</label>
                <input
                  id="set-lunch-start"
                  class="input"
                  type="time"
                  value={settings.work.lunchStart}
                  onchange={(e) => setWork('lunchStart', e.currentTarget.value)}
                />
              </div>
              <div class="field">
                <label for="set-lunch-end">점심 끝</label>
                <input
                  id="set-lunch-end"
                  class="input"
                  type="time"
                  value={settings.work.lunchEnd}
                  onchange={(e) => setWork('lunchEnd', e.currentTarget.value)}
                />
              </div>
            </div>
            {#if workError}<p class="note warn" role="alert">{workError}</p>{/if}
            <div class="btn-row">
              <button type="button" class="btn small" onclick={resetWork}>
                기본값(9시~18시)으로
              </button>
            </div>
            <p class="cap muted">
              유연근무를 한다면 맞게 고쳐 주세요. "오늘 번 돈"과 퇴근 카운트다운에 쓰여요.
            </p>
          </fieldset>
        </div>
      </Win>

      <Win title="화면" icon="icon-sun" id="set-display">
        <div class="stack wide">
          <div class="stack">
            <span id="theme-label">밝기</span>
            <ChipRadio
              labelledby="theme-label"
              options={THEMES.map((t) => ({ value: t.id, label: t.label }))}
              value={settings.theme}
              onchange={setTheme}
            />
          </div>
          <label class="switch">
            <input
              type="checkbox"
              checked={settings.hideAmounts}
              onchange={(e) => app.updateSettings({ hideAmounts: e.currentTarget.checked }, false)}
            />
            <span class="box" aria-hidden="true"></span>
            <span>금액 가리기 <span class="cap muted">사무실에서 띄워 둘 때</span></span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={settings.reduceMotion || anim.systemReduced}
              disabled={anim.systemReduced}
              aria-describedby={anim.systemReduced ? 'set-motion-system' : undefined}
              onchange={(e) => app.updateSettings({ reduceMotion: e.currentTarget.checked }, false)}
            />
            <span class="box" aria-hidden="true"></span>
            <span>움직임 줄이기 <span class="cap muted">캐릭터와 연출을 멈춰요</span></span>
          </label>
          {#if anim.systemReduced}
            <p class="cap muted" id="set-motion-system">
              기기 설정에서 움직임 줄이기가 켜져 있어 늘 멈춰 있어요.
            </p>
          {/if}
          <label class="switch">
            <input
              type="checkbox"
              checked={settings.tabTitle === 'countdown'}
              onchange={(e) =>
                app.updateSettings(
                  { tabTitle: e.currentTarget.checked ? 'countdown' : 'default' },
                  false,
                )}
            />
            <span class="box" aria-hidden="true"></span>
            <span>
              탭 제목에 퇴근까지 남은 시간 <span class="cap muted">금액은 표시하지 않아요</span>
            </span>
          </label>
        </div>
      </Win>
    </div>
    <div class="col c2b">
      <Win title="호봉에 대하여" icon="icon-info" id="set-about">
        <div class="stack wide">
          <ul class="facts">
            <li>
              <Icon name="icon-shield" />
              <span>서버가 없어요. 모든 계산은 이 브라우저 안에서 해요.</span>
            </li>
            <li>
              <Icon name="icon-lock" />
              <span>
                외부로 나가는 통신이 없어요. 보안 정책(CSP)으로 스크립트·이미지·글꼴·연결을 모두
                막아 두어, 인터넷이 막힌 업무망에서도 파일 하나로 그대로 동작해요.
              </span>
            </li>
            <li>
              <Icon name="icon-user" />
              <span>실명·소속을 받지 않아요. 입력한 내용은 이 브라우저의 저장소에만 있어요.</span>
            </li>
            <li>
              <Icon name="icon-book" />
              <span>
                금액은 봉급표 기준 추정치이며 실수령액과 달라요. 공식 인사·급여 시스템의 기록이
                기준이에요.
              </span>
            </li>
          </ul>
          <dl class="stack">
            <div class="kv">
              <dt>버전</dt>
              <dd>{APP_VERSION}</dd>
            </div>
            <div class="kv">
              <dt>적용 대상</dt>
              <dd>{view.rules.target.label}</dd>
            </div>
            <div class="kv">
              <dt>주소</dt>
              <dd>{SITE_URL}</dd>
            </div>
            <div class="kv">
              <dt>글꼴</dt>
              <dd>Galmuri <span class="cap muted">(SIL OFL 1.1, © Lee Minseo)</span></dd>
            </div>
            <div class="kv">
              <dt>색</dt>
              <dd class="cap">{characterRules.paletteName}</dd>
            </div>
          </dl>
          {#if hosted}
            <div class="btn-row">
              <a class="btn" href="hobong.html" download="hobong.html">
                <Icon name="icon-download" /> 업무망용 파일(hobong.html) 받기
              </a>
            </div>
            <p class="cap muted">
              이 파일 하나를 내부망 PC로 옮겨 브라우저로 열면 그대로 쓸 수 있어요.
            </p>
          {/if}
          <p class="cap muted">소스와 규정 데이터: {REPO_URL.replace('https://', '')}</p>
          <div class="stack">
            <button
              type="button"
              class="btn small toggle"
              aria-expanded={showLicenses}
              aria-controls="set-licenses"
              onclick={() => (showLicenses = !showLicenses)}
            >
              <span aria-hidden="true">{showLicenses ? '▼' : '▶'}</span>
              <span>오픈소스 고지</span>
            </button>
            {#if showLicenses}
              <div id="set-licenses" class="stack">
                <p class="cap muted">
                  이 파일에는 아래 오픈소스가 함께 들어 있어요. 고마운 분들이에요.
                </p>
                {#each LICENSE_NOTICES as notice (notice.name)}
                  <section class="well stack" aria-label="{notice.name} 라이선스">
                    <p>
                      <strong>{notice.name}</strong> <span class="cap muted">{notice.license}</span>
                    </p>
                    <p class="cap muted">{notice.use}</p>
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                    <pre class="license" tabindex="0">{notice.text}</pre>
                  </section>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </Win>
    </div>
  </div>

  <Win title="근거 법령" icon="icon-book" id="set-sources">
    {#snippet aside()}확인일 {formatKorean(view.rules.meta.verifiedAt, false)}{/snippet}
    <Sources />
  </Win>
</div>

{#if editing}
  <Modal title="내 정보 고치기" icon="icon-pencil" wide onclose={() => (editing = false)}>
    <ProfileForm
      initial={profile}
      submitLabel="저장"
      onsubmit={saveProfile}
      oncancel={() => (editing = false)}
    />
  </Modal>
{/if}

{#if importing}
  <ImportDialog onclose={() => (importing = false)} />
{/if}

{#if lockMode}
  <LockDialog mode={lockMode} onconfirm={lockAndExport} onclose={() => (lockMode = null)} />
{/if}

{#if showBackupText}
  <Modal title="백업 내용(글자)" icon="icon-text" wide onclose={() => (showBackupText = false)}>
    <div class="stack wide">
      {#if backupStale}
        <p class="note warn" id="backup-text-stale">
          이 글자를 만든 뒤 바뀐 내용이 있어요. 바뀐 내용까지 담으려면 창을 닫고 한 번 더 내려받아
          주세요.
        </p>
      {/if}
      {#if backupLocked}
        <p class="note" id="backup-text-locked">
          암호가 걸린 내용이에요. 불러오기에 그대로 붙여넣고 암호를 넣으면 열려요.
        </p>
      {/if}
      <p>
        아래 글자를 통째로 복사해 메모장 등에 붙여넣고 <span class="nowrap">.json</span> 파일로 저장해
        두세요. 불러올 때는 "글자로 붙여넣기"에 넣으면 돼요.
      </p>
      <textarea
        class="input"
        readonly
        rows="10"
        spellcheck="false"
        onfocus={(e) => e.currentTarget.select()}>{backupText}</textarea
      >
      {#if !backupLocked}
        <p class="note warn">급여·인사 정보가 들어 있으니 보관에 주의해 주세요.</p>
      {/if}
      <div id="backup-copy-result" role="status">
        {#if copyResult}
          <p class="note" class:warn={!copyResult.ok}>{copyResult.text}</p>
        {/if}
      </div>
    </div>
    {#snippet actions()}
      <button type="button" class="btn primary" data-autofocus onclick={copyBackup}>
        <Icon name="icon-copy" /> 모두 복사
      </button>
    {/snippet}
  </Modal>
{/if}

{#if confirmUndo}
  <Modal title="되돌리기" icon="icon-undo" onclose={() => (confirmUndo = false)}>
    <p>지금 데이터를 버리고 불러오기 직전 상태로 돌아가요. 계속할까요?</p>
    {#snippet actions()}
      <button type="button" class="btn" data-autofocus onclick={() => (confirmUndo = false)}>
        취소
      </button>
      <button type="button" class="btn primary" onclick={undo}>되돌리기</button>
    {/snippet}
  </Modal>
{/if}

{#if confirmReset}
  <Modal title="모두 지우기" icon="icon-warn" onclose={() => (confirmReset = false)}>
    <div class="stack wide">
      <p>
        이 브라우저에 있는 내 정보, 연가 기록, 업적을 모두 지우고 첫 화면으로 돌아가요. 지운 뒤에는
        되돌릴 수 없어요.
      </p>
      <p class="note">먼저 데이터를 내려받아 두면 나중에 다시 불러올 수 있어요.</p>
      {#if lock && canLock}
        <p class="cap muted" id="reset-plain-note">
          여기서는 암호 없이 내려받아요. 암호를 걸려면 닫고 데이터 내려받기를 눌러 주세요.
        </p>
      {/if}
      {#if resetDownloaded}
        <div class="note" id="reset-download-note" role="status">
          <p>
            내려받기를 시작했어요. <span class="nowrap">{resetFileName}</span> 파일이 생겼는지 확인해
            주세요.
          </p>
          <button type="button" class="btn small ghost link" onclick={openPlainText}>
            파일이 안 생겼어요 · 글자로 보기
          </button>
        </div>
        <label class="switch">
          <input type="checkbox" bind:checked={resetConfirmed} />
          <span class="box" aria-hidden="true"></span>
          <span>백업 파일이 저장된 것을 확인했어요</span>
        </label>
      {/if}
    </div>
    {#snippet actions()}
      <button type="button" class="btn" data-autofocus onclick={() => (confirmReset = false)}>
        취소
      </button>
      <button type="button" class="btn" onclick={downloadBeforeReset}>먼저 내려받기</button>
      <button
        type="button"
        class="btn danger"
        onclick={reset}
        disabled={resetDownloaded && !resetConfirmed}
      >
        모두 지우기
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  .page {
    display: grid;
    gap: 9px;
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
  dl,
  dt,
  dd {
    margin: 0;
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
  .inline {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .toggle {
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    width: fit-content;
  }
  .license {
    margin: 0;
    max-height: 180px;
    overflow: auto;
    padding: 6px;
    font: inherit;
    font-size: 12px;
    line-height: 18px;
    font-family: 'Galmuri11', 'Galmuri14', monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--bg);
    color: var(--ink);
  }
  .inline .input {
    width: 72px;
    text-align: center;
    flex: none;
  }
  .times {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 9px;
  }
  .facts {
    display: grid;
    gap: 9px;
  }
  .facts li {
    display: flex;
    gap: 9px;
    align-items: flex-start;
  }
  .link {
    justify-content: flex-start;
    width: fit-content;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .col {
    display: contents;
  }
  /* 데이터 버튼은 글자가 두 줄로 쪼개지지 않게, 좁으면 버튼째 다음 줄로 넘긴다 */
  .data-btns > :global(.btn) {
    flex: 1 1 13em;
    white-space: nowrap;
  }
  /* 두 열: [내 정보, 데이터] [근무와 월급날, 화면, 호봉에 대하여], 근거 법령은 아래 전체 폭 */
  @media (min-width: 720px) {
    .page {
      gap: 12px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .c1,
    .c2 {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .page > :global(#set-sources) {
      grid-column: 1 / -1;
    }
  }
  /* 세 열: [내 정보, 데이터] [근무와 월급날, 화면] [호봉에 대하여] */
  @media (min-width: 1100px) {
    .page {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .c2 {
      display: contents;
    }
    .c2a,
    .c2b {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
  }
</style>
