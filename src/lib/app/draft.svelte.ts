/**
 * 내 정보 초안. 말을 거는 첫 입력(Talk)과 한 화면 폼(ProfileForm)이 같은 초안을 함께 쓴다 —
 * 두 방식을 오가도 넣은 값이 남고, 직종 → 봉급표 → 계급을 맞추는 규칙과 검사(checkProfile)가 한곳에 있다.
 *
 * 화면은 값을 직접 고치고(bind), 직종·봉급표만 setTrack·setPayTable 로 바꾼다(계급을 새 사다리에 맞춘다).
 * 호봉이 최고호봉을 넘지 않게 묶는 일은 화면이 clampStep() 을 $effect 로 건다(클래스는 effect 를 만들지 않는다).
 */
import {
  addMonthsClamped,
  onOrNextDayOfMonth,
  periodCompleteDate,
  yearOf,
  type Ymd,
} from '../calc/date.ts';
import {
  careerMaxStep,
  careerOf,
  careerStepOn,
  raisePeriodOf,
  stepCeiling,
} from '../calc/career-profile.ts';
import { dateReachedStep, nextRaiseDate } from '../calc/step.ts';
import {
  careerLookup,
  isAvailable,
  resolveCareer,
  rulesFor,
  selectableRanks,
  type RankKey,
  type SeriesScope,
  type TrackId,
} from '../rules/index.ts';
import {
  LIMITS,
  type GeneralPayTableId,
  type PriorService,
  type Profile,
} from '../store/schema.ts';
import { checkProfile, toProfile, type ProfileErrors } from '../store/validate.ts';
import { clock } from './clock.svelte.ts';
import { josa, withRo } from './format.ts';
import { trackStatusText } from './track.ts';

/** 날짜 칸이 스스로 찾은 문제(세 칸이 다 찼는데 없는 날짜)를 담는 칸 이름 */
export const DATE_KEYS = [
  'birthDate',
  'hireDate',
  'rankDate',
  'nextStepDate',
  'longServiceDate',
  'seniorDate',
  'rankLimitDate',
] as const;
export type DateKey = (typeof DATE_KEYS)[number];

export class ProfileDraft {
  /** 고칠 때의 기존 값. 없으면 새로 만든다 */
  readonly initial: Profile | undefined;
  /**
   * 고칠 때는 "오늘 기준" 호봉과 다음 승급일을 보여준다(저장된 기준점은 과거일 수 있다).
   * 최고호봉이면 다음 승급일이 없으므로 그 자리에 "최고호봉이 된 날"을 보여준다.
   */
  readonly start: { stepNow: number; date: Ymd } | null;

  nickname = $state('');
  birthDate = $state<Ymd | ''>('');
  hireDate = $state<Ymd | ''>('');
  // ── 직종 → (일반직이면) 봉급표 → 계급 ─────────────────────────────────
  track = $state<TrackId>('general');
  /** 일반직이 고른 봉급표. 다른 직종을 고르면 null(직종이 봉급표를 정한다) */
  payTable = $state<GeneralPayTableId | null>('table3');
  /** 고른 계급 키. 저장된 계급이 사다리에 없으면 ''(다시 골라 달라고 한다) */
  rank = $state<RankKey | ''>('9');
  /** 직종·봉급표를 바꿔 계급을 맞춘 사실(낭독 한 번) */
  rankNotice = $state('');
  /**
   * 봉급표를 고르는 직종(일반직)으로 돌아왔는데 전에 고른 봉급표를 모를 때(저장본이 다른 직종) 첫 표로 맞춘 사실.
   * 같은 폼 안에서 다녀온 것이면 전에 고른 표를 되살리고 이 말은 하지 않는다
   */
  payTableNotice = $state('');
  /** 이 폼에서 마지막으로 고른 일반직 봉급표(지방 일반직 등으로 갔다 돌아올 때 되살린다) */
  #lastPayTable: GeneralPayTableId | null = null;
  promoted = $state(false);
  rankDate = $state<Ymd | ''>('');
  step = $state(1);
  nextStepDate = $state<Ymd | ''>('');
  longServiceDate = $state<Ymd | ''>('');
  seniorDate = $state<Ymd | ''>('');
  rankLimitDate = $state<Ymd | ''>('');
  /**
   * 일반직의 직렬(선택). 직종을 바꿔도 지우지 않는다(일반직으로 되돌아오면 다시 쓴다).
   * 지울지는 사용자가 '직렬 지우기'로 정한다(말없이 지우지 않는다).
   */
  series = $state<string | null>(null);
  /**
   * 고른 직류(v7, 선택). 직렬 고르기(SeriesPicker)에서 직류로 찾아 고르면 직렬과 함께 들어오고, 직렬을 다시 고르면
   * 지운다(setSeries). 직종을 바꿔도 지우지 않는다(직렬과 같은 규칙). 직렬과 짝이 맞는지는 화면이 jikryuOf 로 본다
   */
  seriesJikryu = $state<string | null>(null);
  /** 임용 전 군 복무(v7, #34). 아직 받는 칸이 없어 저장돼 있던 값을 그대로 이어 준다 */
  priorService = $state.raw<PriorService | null>(null);
  payday = $state(25);
  /** 월급날을 직접 골랐으면 직종을 바꿔도 그대로 둔다 */
  paydayTouched = $state(false);
  dateProblems = $state<Record<DateKey, string>>({
    birthDate: '',
    hireDate: '',
    rankDate: '',
    nextStepDate: '',
    longServiceDate: '',
    seniorDate: '',
    rankLimitDate: '',
  });

  constructor(initial?: Profile, initialPayday?: number) {
    this.initial = initial;
    const today = clock.today;
    const rules = rulesFor(yearOf(today));
    if (initial) {
      const c = careerOf(rulesFor, initial, yearOf(today));
      const max = stepCeiling(c);
      const period = raisePeriodOf(c);
      const stepNow = careerStepOn(c, initial, today);
      // 정기승급을 계산하지 않는 직종은 입력한 다음 승급일을 그대로 보여 준다
      if (period === null) this.start = { stepNow, date: initial.nextStepDate };
      else {
        const next = nextRaiseDate(initial, today, max, period);
        this.start = { stepNow, date: next ?? dateReachedStep(initial, max, period) };
      }
      this.nickname = initial.nickname;
      this.birthDate = initial.birthDate;
      this.hireDate = initial.hireDate;
      this.track = initial.track;
      this.payTable = initial.payTable;
      this.#lastPayTable = initial.payTable;
      const choices = selectableRanks(rules, initial.track, initial.payTable);
      this.rank =
        initial.rank !== null && choices.some((c2) => c2.key === initial.rank) ? initial.rank : '';
      this.promoted = initial.rankDate !== initial.hireDate;
      this.rankDate = initial.rankDate;
      this.step = this.start.stepNow;
      this.nextStepDate = this.start.date;
      this.longServiceDate = initial.overrides.longServiceDate ?? '';
      this.seniorDate = initial.overrides.seniorDate ?? '';
      this.rankLimitDate = initial.overrides.rankLimitDate ?? '';
      this.series = initial.series ?? null;
      this.seriesJikryu = initial.seriesJikryu ?? null;
      this.priorService = initial.priorService ?? null;
    } else {
      this.start = null;
    }
    this.payday =
      initialPayday ?? rules.tracks.items[initial?.track ?? 'general'].payday.defaultDay;
  }

  readonly today = $derived(clock.today);
  readonly rules = $derived(rulesFor(yearOf(this.today)));
  readonly trackRules = $derived(this.rules.tracks.items[this.track]);
  /** 고를 봉급표가 여럿인 직종인지(일반직) — 직종 id 가 아니라 직종 데이터의 payTables 로 정한다 */
  readonly askPayTable = $derived(this.trackRules.payTables.length > 1);
  /** 직렬을 고르는 직종이면 그 직렬 표(일반직 national, 지방 일반직 local). 아니면 null */
  readonly seriesScope = $derived<SeriesScope | null>(this.trackRules.seriesScope ?? null);
  /** 이 직종·봉급표에서 고를 수 있는 계급(낮은 계급부터) */
  readonly ranks = $derived(selectableRanks(this.rules, this.track, this.payTable));
  /** 계급 이름을 묻지 않는 직종(교원은 계급이 하나뿐이고 이름을 쓰지 않는다) */
  readonly hiddenRank = $derived(this.ranks.length === 1 && this.ranks[0]?.hideLabel === true);
  readonly askRank = $derived(this.ranks.length > 0 && !this.hiddenRank);
  /** 저장할 계급: 칸이 있으면 고른 값, 교원은 그 하나, 사다리가 없으면 null */
  readonly draftRank = $derived<RankKey | null>(
    this.ranks.length === 0
      ? null
      : this.hiddenRank
        ? (this.ranks[0]?.key ?? null)
        : this.rank || null,
  );
  readonly career = $derived(
    resolveCareer(this.rules, {
      track: this.track,
      payTable: this.payTable,
      rank: this.draftRank,
    }),
  );
  /** '직급'·'계급'·'직무등급' */
  readonly noun = $derived(this.career.ladder?.noun ?? '직급');
  /** 사다리에는 있지만 고를 수 없는 계급(치안총감·소방총감) */
  readonly unselectable = $derived(
    (this.career.ladder?.ranks ?? []).filter((r) => r.selectable === false),
  );

  /** 봉급표의 최고호봉. 봉급표가 없는 직종(준비 중)은 저장본 상한(99)까지 받는다 */
  readonly payMax = $derived(careerMaxStep(this.career));
  readonly maxStep = $derived(this.payMax ?? LIMITS.maxStepAny);
  /** 정기승급을 계산하는 직종인지(아니면 입력한 호봉·다음 승급일을 그대로 쓴다) */
  readonly raises = $derived(isAvailable(this.career.stepRaise));
  /** 더 오를 호봉이 없는 상태. 날짜 칸은 "최고호봉이 된 날"을 받는다 */
  readonly atMax = $derived(this.raises && this.payMax !== null && this.step >= this.payMax);

  // ── 예외 칸(직종·계급에 따라 보인다) ─────────────────────────────────
  readonly longServiceGrades = $derived.by(() => {
    const rule = this.career.longService;
    if (!isAvailable(rule)) return [];
    return (this.career.ladder?.ranks ?? []).filter((r) => rule.monthsByGrade[r.key] != null);
  });
  readonly showLongService = $derived(
    this.draftRank !== null && this.longServiceGrades.some((r) => r.key === this.draftRank),
  );
  readonly showSenior = $derived.by(() => {
    const rule = this.career.seniorTreatment;
    return (
      this.askRank &&
      isAvailable(rule) &&
      this.draftRank !== null &&
      rule.monthsByGrade[this.draftRank] != null
    );
  });
  /** 계급정년이 있는 직종(경찰·해양경찰·소방). 강등된 계급처럼 계급정년이 없는 계급도 날짜를 넣을 수 있다 */
  readonly showRankLimit = $derived.by(() => {
    const rule = this.career.retirement;
    return isAvailable(rule) && rule.rankLimit !== undefined;
  });

  readonly draft = $derived({
    nickname: this.nickname,
    birthDate: this.birthDate,
    hireDate: this.hireDate,
    track: this.track,
    series: this.series,
    seriesJikryu: this.seriesJikryu,
    payTable: this.payTable,
    rank: this.draftRank,
    rankDate: this.askRank && this.promoted ? this.rankDate : this.hireDate,
    step: this.step,
    nextStepDate: this.nextStepDate,
    // 숨은 예외 칸의 값은 화면에서 지우지 않되(직종을 되돌리면 남아 있게) 저장하지 않는다
    overrides: {
      longServiceDate: (this.showLongService && this.longServiceDate) || null,
      seniorDate: (this.showSenior && this.seniorDate) || null,
      // 계급정년 날짜는 칸이 숨어도(계급정년이 없는 직종으로 잠깐 바꿔도) 지우지 않는다(설계 §6.3, 계산에 안 쓴다)
      rankLimitDate: (this.showRankLimit ? this.rankLimitDate : this.#keptRankLimit()) || null,
    },
    priorService: this.priorService,
  });
  readonly errors = $derived<ProfileErrors>(
    checkProfile(this.draft, {
      today: this.today,
      ...careerLookup(this.rules),
      raiseDateRule: this.atMax ? 'reached' : 'future',
    }),
  );

  /**
   * 화면에 보이는 칸 기준의 오류. 승진 체크를 끄면 현 직급 임용일 칸이 숨으므로(임용일과 같다고 본다)
   * 그 칸의 오류는 세지 않는다. 없는 날짜는 "넣어 주세요"보다 먼저 그 까닭을 센다.
   */
  readonly visibleErrors = $derived.by<ProfileErrors>(() => {
    const out: ProfileErrors = { ...this.errors };
    const rankDateShown = this.askRank && this.promoted;
    if (!rankDateShown) delete out.rankDate;
    const hidden: Partial<Record<DateKey, boolean>> = {
      rankDate: !rankDateShown,
      longServiceDate: !this.showLongService,
      seniorDate: !this.showSenior,
      rankLimitDate: !this.showRankLimit,
    };
    for (const key of DATE_KEYS) {
      const text = this.dateProblems[key];
      if (!text || hidden[key]) continue;
      out[key] = text;
    }
    return out;
  });
  readonly errorCount = $derived(Object.keys(this.visibleErrors).length);
  /**
   * 화면에 칸이 없는 값의 오류(교원의 계급처럼 폼이 맞춰 넣는 값). 칸 아래에 안내를 붙일 수 없으므로
   * 따로 모아 보인다(저장 버튼이 아무 말 없이 막히지 않게).
   */
  readonly hiddenErrors = $derived(
    Object.entries(this.visibleErrors).flatMap(([key, text]) => {
      if (!text) return [];
      if (key === 'rank' && !this.askRank) return [`${this.noun}: ${text}`];
      if (key === 'track') return [`직종: ${text}`];
      if (key === 'payTable') return [`봉급표: ${text}`];
      if (key === 'series') return [`직렬: ${text}`];
      if (key === 'seriesJikryu') return [`직류: ${text}`];
      if (key === 'priorService') return [`군 복무 경력: ${text}`];
      if (key === 'stepAsOf') return [`호봉 확인일: ${text}`];
      return [];
    }),
  );
  /** 저장해도 되는지 */
  readonly valid = $derived(this.errorCount === 0 && Object.keys(this.errors).length === 0);

  /**
   * 승급기간(1년)을 채운 뒤 처음 오는 1일 중 오늘 다음 날 이후인 날.
   * 승진해도 승급 주기는 새로 시작하지 않는다(승진 전의 잔여기간을 다음 승급기간에 넣는다,
   * 보수규정 제11조제7항). 그래서 승진 여부와 관계없이 최초 임용일에서 어림한다.
   * 정기승급을 계산하지 않는 직종에서는 어림하지 않는다.
   */
  readonly guessedNext = $derived.by(() => {
    const rule = this.career.stepRaise;
    if (!this.hireDate || !isAvailable(rule)) return null;
    let candidate = onOrNextDayOfMonth(
      periodCompleteDate(this.hireDate, rule.periodMonths),
      rule.dayOfMonth,
    );
    for (let i = 0; i < 60 && candidate <= this.today; i += 1) {
      candidate = addMonthsClamped(candidate, rule.periodMonths);
    }
    return candidate;
  });

  // ── 도움말 ────────────────────────────────────────────────────────────
  readonly trackStatus = $derived(trackStatusText(this.trackRules));
  readonly birthHint = $derived.by(() => {
    const rule = this.career.retirement;
    return isAvailable(rule) && rule.age !== this.rules.retirement.age
      ? `정년(${rule.age}세) 퇴직일 계산에 써요.`
      : '정년퇴직일 계산에 써요.';
  });
  readonly table4High = $derived(
    this.askPayTable &&
      this.payTable === 'table4' &&
      this.draftRank !== null &&
      Number(this.draftRank) <= 4,
  );
  readonly longServiceHint = $derived(
    this.longServiceGrades.length > 0
      ? `${this.longServiceGrades.map((r) => r.label).join('·')}만 해당해요.`
      : '',
  );
  readonly rankDateHint = $derived(
    this.showRankLimit
      ? '근속승진·대우공무원·계급정년 기간의 기준이에요.'
      : '근속승진·대우공무원 기간의 기준이에요.',
  );
  /** 월급날 선택지: 직종의 선택지(지방 일반직 20·17일)가 있으면 그것, 없으면 별표 30 의 네 날짜 */
  readonly paydayOptions = $derived(this.career.payday.options);
  readonly paydayOrgs = $derived(this.paydayOptions.find((o) => o.day === this.payday)?.orgs ?? '');
  /** 다음 승급일 칸의 이름(최고호봉이면 그 날을 묻는다) */
  readonly nextLabel = $derived(this.atMax ? '최고호봉이 된 날' : '다음 승급일');
  readonly nextHint = $derived(
    this.atMax
      ? '더 오를 호봉이 없어요. 최고호봉이 된 날을 넣어 주세요. 정확히 몰라도 괜찮아요(지금까지 번 봉급을 어림할 때만 써요).'
      : this.raises
        ? "인사기록의 차기 승급일을 넣어 주세요(보통 어느 달 1일). 미뤄졌다면 아래 '예외가 있어요'를 보세요."
        : '인사기록의 다음 승급일. 그날이 지나면 호봉을 고쳐 달라고 알려 드릴게요.',
  );

  /** 고치기 전에 저장돼 있던 계급정년 날짜(칸이 숨어 있는 동안 그대로 지킨다) */
  #keptRankLimit(): Ymd | '' {
    return this.initial?.overrides.rankLimitDate ?? '';
  }

  /** 직종·봉급표가 바뀌어 지금 계급이 새 사다리에 없으면 가장 낮은 계급으로 맞춘다 */
  adjustRank(): void {
    this.rankNotice = '';
    const choices = selectableRanks(this.rules, this.track, this.payTable);
    if (choices.length === 0 || (choices.length === 1 && choices[0]?.hideLabel)) {
      // 승진할 계급이 없는 직종: 현 계급 임용일은 임용일과 같다(값은 숨겨 두고 저장할 때만 맞춘다)
      this.promoted = false;
      return;
    }
    if (this.rank !== '' && choices.some((c) => c.key === this.rank)) return;
    const first = choices[0];
    if (!first) return;
    const had = this.rank !== '';
    this.rank = first.key;
    const ladderNoun =
      resolveCareer(this.rules, { track: this.track, payTable: this.payTable, rank: first.key })
        .ladder?.noun ?? '계급';
    if (had || this.initial)
      this.rankNotice = `${josa(ladderNoun, '을', '를')} ${withRo(first.label)} 맞췄어요. 확인해 주세요.`;
  }

  setTrack(next: TrackId): void {
    if (next === this.track) return;
    this.track = next;
    if (this.payTable !== null) this.#lastPayTable = this.payTable;
    // 봉급표는 고를 표가 여럿인 직종(일반직)만 고른다. 그 밖은 직종이 정한다(null).
    // 돌아오면 이 폼에서 전에 고른 표를 되살리고, 모르면 첫 표로 맞춘 뒤 (고치는 중이면) 확인해 달라고 한다
    const tables = this.rules.tracks.items[next].payTables;
    this.payTableNotice = '';
    if (tables.length > 1) {
      const kept = this.payTable ?? this.#lastPayTable;
      const first = tables[0] as GeneralPayTableId;
      this.payTable = kept !== null && tables.includes(kept) ? kept : first;
      if (kept === null && this.initial)
        this.payTableNotice = `봉급표를 ${withRo(first === 'table3' ? '별표 3' : (this.rules.payTables.items[first]?.annex ?? first))} 맞췄어요. 확인해 주세요.`;
    } else this.payTable = null;
    this.adjustRank();
    if (!this.paydayTouched && !this.initial)
      this.payday = this.rules.tracks.items[next].payday.defaultDay;
  }

  /** 직렬(과 직류)을 고른다. 직렬만 고르면(jikryu null) 직류는 지운다 */
  setSeries(series: string | null, jikryu: string | null = null): void {
    this.series = series;
    this.seriesJikryu = series === null ? null : jikryu;
  }

  setPayTable(next: GeneralPayTableId): void {
    this.payTableNotice = '';
    if (next === this.payTable) return;
    this.payTable = next;
    this.adjustRank();
  }

  setPayday(day: number): void {
    this.payday = day;
    this.paydayTouched = true;
  }

  /** 호봉이 최고호봉을 넘지 않게 묶는다(화면이 $effect 로 건다) */
  clampStep(): void {
    if (this.step > this.maxStep) this.step = this.maxStep;
  }

  /** 저장할 호봉 기준점(호봉, 다음 승급일, 확인한 날) */
  #anchorFields(): { step: number; nextStepDate: Ymd; stepAsOf: Ymd } {
    const { initial, start } = this;
    // 직종·봉급표·계급과 호봉·날짜를 건드리지 않았으면 저장돼 있던 기준점을 그대로 둔다.
    // (다시 저장하기만 해도 지나간 호봉 추정이 달라지는 일을 막는다)
    if (
      initial &&
      start &&
      this.track === initial.track &&
      this.payTable === initial.payTable &&
      this.draftRank === initial.rank &&
      this.step === start.stepNow &&
      this.nextStepDate === start.date
    ) {
      return {
        step: initial.step,
        nextStepDate: initial.nextStepDate,
        stepAsOf: initial.stepAsOf,
      };
    }
    // 최고호봉: "바로 아래 호봉이 그날 전날까지"라고 적어 두면 그날부터 최고호봉이 된다.
    if (this.atMax)
      return {
        step: this.maxStep - 1,
        nextStepDate: this.nextStepDate as Ymd,
        stepAsOf: this.today,
      };
    return { step: this.step, nextStepDate: this.nextStepDate as Ymd, stepAsOf: this.today };
  }

  /** 검사를 통과한 초안을 저장할 내 정보로 만든다(valid 일 때만 부른다) */
  toProfile(): Profile {
    return toProfile({ ...this.draft, ...this.#anchorFields() });
  }
}
