/**
 * 화면이 쓰는 계산값 모음. 저장된 입력값과 규정 데이터, 시계에서 매번 다시 계산한다(파생 값은 저장하지 않는다).
 * - 날짜가 바뀔 때만 달라지는 값은 clock.today에,
 * - 분 단위면 충분한 값(기분·한마디)은 clock.minute에,
 * - 초 단위로 움직이는 값(번 돈·카운트다운)은 clock.now에 의존한다.
 */
import { untrack } from 'svelte';
import { clock } from './clock.svelte.ts';
import { app } from './state.svelte.ts';
import {
  achievementViews,
  evaluateAchievements,
  fullDayLeaveDates,
  type AchievementInput,
} from '../achievements.ts';
import { missingHolidayYearForBonuses, upcomingBonuses } from '../calc/bonus.ts';
import { findBridges } from '../calc/bridge.ts';
import {
  compensationYear,
  savingsLedger,
  type CompensationYear,
  type CompPlan,
} from '../calc/leave-bank.ts';
import { Calendar } from '../calc/calendar.ts';
import {
  careerMaxStep,
  careerOf,
  careerStepOn,
  raisePeriodOf,
  stepCeiling,
} from '../calc/career-profile.ts';
import {
  addDays,
  addMonthsClamped,
  diffDays,
  minYmd,
  parseYmd,
  spanBetween,
  yearOf,
  type Ymd,
} from '../calc/date.ts';
import { advanceLimitDays, dayLeaveKind, summarizeLeave, type DayLeave } from '../calc/leave.ts';
import {
  diligenceLeft,
  newYearsLeft,
  paydayCounts,
  paydayHolidaysKnown,
  resolveLifetimeEnd,
  type YearMonth,
} from '../calc/lifetime.ts';
import { buildMilestones, longLeaveNotices, upcomingMilestones } from '../calc/milestones.ts';
import { yearGrid as buildYearGrid, yearRecap, type GridInput } from '../calc/recap.ts';
import {
  longServiceInfo,
  minServiceDate,
  minServiceMonths,
  promotionPreview,
  seniorAllowance,
  seniorTreatmentInfo,
  type LongServiceInfo,
  type SeniorInfo,
} from '../calc/promotion.ts';
import {
  careerProgress,
  effectiveRetirement,
  retireDateFor,
  retirePeriodText,
  retirementInfo,
  serviceDayOf,
} from '../calc/retirement.ts';
import {
  cumulativeSalary,
  isPayPending,
  lifetimeSalary,
  nextStepRaise,
  salaryOn,
  yearToDateSalary,
} from '../calc/salary.ts';
import { isRaiseDay, prevRaiseDate } from '../calc/step.ts';
import { earnings, secondOfDay, todayStatus, toSchedule, type TodayStatus } from '../calc/today.ts';
import {
  decideMood,
  formIdFor,
  holdsOwnProp,
  nextUnlock,
  resolveLook,
  type MoodId,
} from '../character/look.ts';
import {
  isOwnSeriesName,
  jikryuOf,
  propOwnerOf,
  seriesLabel,
  seriesNameOf,
  seriesWord,
} from '../character/series.ts';
import { characterRules } from '../character/rules.ts';
import { lineFor } from '../lines.ts';
import {
  careerLookup,
  hasHolidayData,
  isAvailable,
  rankLabel,
  rankStepLabel,
  rulesFor,
  type Avail,
  type Unavailable,
} from '../rules/index.ts';
import type { UserData } from '../store/schema.ts';
import { checkProfile } from '../store/validate.ts';

export const calendar = new Calendar(rulesFor);

/** 꺼진 항목(준비 중·해당 없음)이면 그 상태, 켜져 있으면 null */
function offOf<T extends object>(value: Avail<T>): Unavailable | null {
  return isAvailable(value) ? null : value;
}

const NOT_LONG_SERVICE: LongServiceInfo = {
  applicable: false,
  targetRank: null,
  requiredMonths: null,
  autoDate: null,
  date: null,
  overridden: false,
  reviewFrom: null,
  quotaNote: null,
};
const NOT_SENIOR: SeniorInfo = {
  applicable: false,
  targetRank: null,
  requiredMonths: null,
  qualifyDate: null,
  autoDate: null,
  date: null,
  overridden: false,
};

class View {
  /** 화면이 그려지는 동안에는 항상 데이터가 있다 */
  get data(): UserData {
    const data = app.data;
    if (!data) throw new Error('사용자 데이터가 없습니다');
    return data;
  }

  today = $derived(clock.today);
  rules = $derived(rulesFor(yearOf(this.today)));
  holidayDataMissing = $derived(!hasHolidayData(this.rules));

  profile = $derived(this.data.profile);
  /**
   * 올해 이 사람에게 적용할 직종 규정(resolveCareer). 꺼진 항목은 'pending'·'none'·'external' 상태 그대로다.
   * 화면은 직종을 가르지 않고 이 값과 아래 계산 결과만 본다.
   */
  careerRules = $derived(careerOf(rulesFor, this.profile, yearOf(this.today)));
  /** 올해 봉급표가 아직 없어 이전 연도 표로 계산 중인지(봉급을 계산하지 않는 직종은 false) */
  salaryPending = $derived(isPayPending(this.careerRules));
  /** 봉급이 꺼져 있으면 그 상태(준비 중·계급을 골라 주세요 등) */
  payOff = $derived(offOf(this.careerRules.pay));
  /** 계급 이름('7급'·'경위'·'우정7급'). 교원·사다리 없는 직종은 '' */
  rankLabel = $derived(rankLabel(this.careerRules));
  /** 봉급표의 최고호봉. 봉급표가 없는 직종(준비 중)은 null(최고호봉이 필요한 표시는 숨긴다) */
  maxStep = $derived(careerMaxStep(this.careerRules));
  /** 정기승급을 계산하는지(꺼지면 입력한 호봉을 그대로 쓰고 자동으로 올리지 않는다) */
  raisesAutomatically = $derived(isAvailable(this.careerRules.stepRaise));
  /**
   * 저장된 내 정보 중 지금 기준으로 맞지 않는 값(PC 시계가 뒤로 갔거나 규정이 바뀐 경우).
   * 저장본은 그대로 열고, 화면에서 확인을 부탁한다.
   */
  /** 내 정보 점검 결과(칸 이름 → 문구) */
  profileIssueMap = $derived(
    checkProfile(this.profile, {
      today: this.today,
      ...careerLookup(this.rules),
    }) as Partial<Record<string, string>>,
  );
  profileIssues = $derived(Object.values(this.profileIssueMap).filter((m): m is string => !!m));

  // ── 정년 ─────────────────────────────────────────────────────────────
  /** 정년(연령정년·계급정년 중 먼저 오는 날). 정년 규정이 꺼진 직종은 그 상태 */
  retirement = $derived(effectiveRetirement(this.careerRules, this.profile));
  retirementOff = $derived(offOf(this.retirement));
  /**
   * 정년퇴직일(연령·계급정년 중 이른 날). 정년을 계산하지 않는 직종(준비 중)은 null.
   * reachDate 는 늘 연령정년의 '정년 나이가 되는 날'(age 세 생일)이다. 계급정년은 rankLimit 에 따로 둔다.
   * periodText·basis 는 규정 데이터(periods·source)로 만든 퇴직 구간 규칙과 근거 조문이다.
   */
  retire = $derived.by(() => {
    const r = this.retirement;
    const rules = this.careerRules.retirement;
    if (!isAvailable(r) || !isAvailable(rules)) return null;
    const law = this.rules.laws[rules.source.law]?.name ?? rules.source.law;
    // 2월 29일생이 평년에 정년 나이가 되면 '이른 날'을 3월 1일로 본다. 2월 28일로 보면 퇴직일이 달라지는
    // 직종(교원: 3~8월 → 8월 31일, 1~2월 → 2월 말일)에서는 그 날을 함께 알려 준다(설계 §11.1-2)
    const leapBirth =
      this.profile.birthDate.endsWith('-02-29') && r.age.reachDate.endsWith('-03-01');
    const altRetire = leapBirth
      ? retireDateFor(rules, `${r.age.reachDate.slice(0, 4)}-02-28`)
      : r.age.retireDate;
    return {
      reachDate: r.age.reachDate,
      /** 연령정년의 퇴직일(계급정년이 먼저여도 함께 보여 준다) */
      ageRetireDate: r.age.retireDate,
      /** 2월 29일생의 다른 해석(2월 28일에 이른 것으로 볼 때) 퇴직일. 같으면 null */
      leapAltRetireDate: altRetire !== r.age.retireDate ? altRetire : null,
      retireDate: r.retireDate,
      age: r.ageYears,
      cause: r.cause,
      rankLimit: r.rankLimit,
      periodText: retirePeriodText(rules),
      basis: `${law} ${rules.source.article}`,
    };
  });
  /** 정년퇴직일(없으면 null) */
  retireDate = $derived(this.retire ? this.retire.retireDate : null);
  /** 정년퇴직일이 지났는지 */
  retired = $derived(this.retireDate !== null && this.today > this.retireDate);
  /**
   * 재직 중의 값(호봉·봉급·재직기간·누적 봉급)을 계산하는 날.
   * 정년퇴직일이 지나면 그날에서 멈춘다(퇴직 뒤에도 숫자가 계속 늘어나지 않게).
   */
  serviceDay = $derived(serviceDayOf(this.retirement, this.today));

  step = $derived(careerStepOn(this.careerRules, this.profile, this.serviceDay));
  /** '7급 12호봉' / '경위 12호봉' / '12호봉'(교원·사다리 없는 직종) */
  rankStepLabel = $derived(rankStepLabel(this.careerRules, this.step));
  /** 직렬을 고르는 직종이면 그 직렬 표(직종 데이터의 seriesScope — 일반직 national, 지방 일반직 local). 아니면 null */
  seriesScope = $derived(this.careerRules.track.seriesScope ?? null);
  /**
   * 고른 직렬 이름(data/series.json, 직류 없이). 고르지 않았거나 지금 직종의 표에 없거나 직렬을 고르지 않는 직종이면 null.
   * 카드에 쓰는 이름이다(직류는 카드·공유에 넣지 않는다). 소속을 짐작하게 할 수 있어 화면마다 사용자 설정
   * (identity.showSeriesHome·card.showSeries)을 보고 보인다.
   */
  seriesName = $derived(seriesNameOf(this.profile.series, this.seriesScope));
  /**
   * 고른 이름이 두 표 밖의 '직접 적은 이름'인지(#38). 직렬 표가 있는 직종에서만 참이다.
   * 직접 적은 이름에는 '직렬'을 붙이지 않는다(법령의 직렬처럼 보이지 않게)
   */
  seriesOwn = $derived(this.seriesName !== null && isOwnSeriesName(this.profile.series));
  /** 카드에 넣는 직렬 글자: '행정 직렬' / 직접 적은 이름은 그대로('경찰행정'). 직류는 넣지 않는다 */
  seriesCardText = $derived(this.seriesName === null ? null : seriesWord(this.seriesName));
  /** 이 브라우저 안의 화면(홈·설정)에 보일 직렬 이름: '행정 · 교육행정 직류'(직류를 골랐을 때) / '행정' */
  seriesFullName = $derived(seriesLabel(this.profile, this.seriesScope));
  /**
   * 홈 상태창의 직렬 줄: '행정 직렬 · 교육행정 직류' / '간호 직렬' / 직접 적은 이름은 그대로('경찰행정').
   * 공개 설정(showSeriesHome)은 화면이 본다
   */
  seriesHomeText = $derived.by(() => {
    if (this.seriesName === null) return null;
    const jikryu = jikryuOf(this.profile.series, this.profile.seriesJikryu, this.seriesScope);
    return `${seriesWord(this.seriesName)}${jikryu ? ` · ${jikryu} 직류` : ''}`;
  });
  /** 홈에 직렬·계급 이름을 보일지(settings.identity.showSeriesHome, 기본 켬) */
  showIdentityHome = $derived(this.data.settings.identity.showSeriesHome);
  /**
   * 홈(상태창·지갑)에 쓰는 계급·호봉 글자. 공개 설정을 끄면 계급 이름을 빼고 '12호봉'만 쓴다
   * (#20 설계 §13: 우정직은 계급 이름 '우정7급'이 곧 직군이다. '7급 상당' 같은 표기는 쓰지 않는다).
   */
  homeRankStepLabel = $derived(this.showIdentityHome ? this.rankStepLabel : `${this.step}호봉`);
  /**
   * 홈(승급·정년 창 설명 포함)에 쓸 계급 이름. 공개 설정을 끄면 null — 화면은 '지금 계급'·'다음 계급'처럼
   * 이름 없이 쓴다(우정·경찰·소방 계급 이름은 직군·직종을 드러낸다)
   */
  homeRankLabel = $derived(this.showIdentityHome ? this.rankLabel : null);
  /** 지금 봉급. 봉급을 계산하지 않는 직종(준비 중)은 null */
  salary = $derived(salaryOn(rulesFor, this.profile, this.serviceDay));
  /** 정기승급을 계산하지 않는 직종에서 입력한 다음 승급일이 지났는지(호봉을 고쳐 달라고 한다) */
  manualRaiseOverdue = $derived(
    !this.raisesAutomatically && this.profile.nextStepDate <= this.today,
  );

  // ── 승급 ─────────────────────────────────────────────────────────────
  /** 다음 정기승급. 최고호봉이거나 정년퇴직일 뒤이거나 봉급·정기승급을 계산하지 않으면 null */
  nextRaise = $derived.by(() => {
    const next = nextStepRaise(rulesFor, this.profile, this.serviceDay);
    return next && (this.retireDate === null || next.date <= this.retireDate) ? next : null;
  });
  /**
   * 다음 승급이 없는 까닭.
   * 'manual': 정기승급을 계산하지 않는 직종(입력한 날만 보여 준다).
   * 'payOff': 정기승급은 계산하지만 봉급표(최고호봉)를 몰라 다음 승급을 셀 수 없음(계급을 모름 등 — payOff.reason).
   */
  noRaiseReason = $derived.by<'max' | 'retire' | 'manual' | 'payOff' | null>(() => {
    if (this.nextRaise) return null;
    if (!this.raisesAutomatically) return 'manual';
    if (this.maxStep === null) return 'payOff';
    return this.step >= this.maxStep ? 'max' : 'retire';
  });
  /** 직전 승급일~다음 승급일 사이의 진행 정도 */
  raiseProgress = $derived.by(() => {
    const next = this.nextRaise;
    const period = raisePeriodOf(this.careerRules);
    if (!next || period === null) return null;
    const prev = prevRaiseDate(this.profile, this.today, period);
    const total = Math.max(1, diffDays(prev, next.date));
    const done = diffDays(prev, this.today);
    return {
      prev,
      next: next.date,
      total,
      done,
      left: total - done,
      ratio: Math.min(1, Math.max(0, done / total)),
    };
  });
  raisedToday = $derived.by(() => {
    const period = raisePeriodOf(this.careerRules);
    return (
      period !== null && isRaiseDay(this.profile, this.today, stepCeiling(this.careerRules), period)
    );
  });

  // ── 재직 ─────────────────────────────────────────────────────────────
  /** 임용부터 정년까지의 진행. 정년을 계산하지 않으면 null */
  career = $derived(
    this.retireDate === null
      ? null
      : careerProgress(this.profile.hireDate, this.retireDate, this.today),
  );
  tenure = $derived(spanBetween(this.profile.hireDate, addDays(this.serviceDay, 1)));
  /** 오늘이 임용 N주년이면 N */
  anniversaryYears = $derived.by(() => {
    const hire = parseYmd(this.profile.hireDate);
    const now = parseYmd(this.today);
    const years = now.y - hire.y;
    if (years < 1) return null;
    return addMonthsClamped(this.profile.hireDate, years * 12) === this.today ? years : null;
  });

  // ── 승진 ─────────────────────────────────────────────────────────────
  /** 근속승진 규정이 꺼진 직종이면 그 상태(준비 중·해당 없음). 그때 longService 는 applicable false */
  longServiceAvail = $derived(longServiceInfo(this.careerRules, this.profile));
  longServiceOff = $derived(offOf(this.longServiceAvail));
  longService = $derived(
    isAvailable(this.longServiceAvail) ? this.longServiceAvail : NOT_LONG_SERVICE,
  );
  seniorAvail = $derived(seniorTreatmentInfo(this.careerRules, this.profile));
  seniorOff = $derived(offOf(this.seniorAvail));
  senior = $derived(isAvailable(this.seniorAvail) ? this.seniorAvail : NOT_SENIOR);
  minService = $derived(minServiceDate(this.careerRules, this.profile.rankDate));
  minServiceMonths = $derived(minServiceMonths(this.careerRules));
  minServiceOff = $derived(offOf(this.careerRules.minService));
  /** 근속승진 요건일(이미 지났으면 오늘)에 승진한다면 */
  promotion = $derived.by(() => {
    const info = this.longService;
    if (!info.applicable || !info.date) return null;
    const date = info.date > this.today ? info.date : this.today;
    return promotionPreview(rulesFor, this.profile, date);
  });
  seniorAllowance = $derived.by(() => {
    const info = this.senior;
    if (!info.applicable || !info.date) return null;
    return seniorAllowance(rulesFor, this.profile, info.date > this.today ? info.date : this.today);
  });

  // ── 돈 ───────────────────────────────────────────────────────────────
  /** 지금까지 번 봉급. 봉급·정기승급을 계산하지 않는 직종은 null */
  cumulative = $derived(cumulativeSalary(rulesFor, this.profile, this.serviceDay));
  /** 올해 번 봉급. 지난해 이전에 퇴직했다면 0, 봉급을 계산하지 않는 직종은 null */
  yearToDate = $derived.by(() => {
    const amount = yearToDateSalary(rulesFor, this.profile, this.serviceDay);
    return amount !== null && yearOf(this.serviceDay) < yearOf(this.today) ? 0 : amount;
  });
  /** 기준일에 재직 중인 보너스만(정년퇴직일 뒤의 정근수당·명절휴가비는 없다) */
  bonuses = $derived(
    upcomingBonuses(
      rulesFor,
      calendar,
      this.profile,
      this.data.settings.payday,
      this.today,
      3,
      this.retireDate ?? undefined,
    ),
  );
  /** 공휴일 데이터가 없어 명절휴가비가 목록에서 빠졌을 수 있는 해 */
  bonusGapYear = $derived(missingHolidayYearForBonuses(calendar, this.today));
  payday = $derived(calendar.nextPayday(this.today, this.data.settings.payday));
  /** 다음 월급날이 속한 해의 공휴일이 반영돼 있는지(아니면 공휴일과 겹쳐 앞당겨질 수 있다) */
  paydayHolidaysKnown = $derived(calendar.hasHolidayData(yearOf(this.payday)));
  isPayday = $derived(!this.retired && this.payday === this.today);

  // ── 생애 봉급(#30) ── 날짜가 바뀔 때만 다시 센다(clock.now 에 기대지 않는다) ──
  /**
   * 퇴직 예정 달('YYYY-MM', 저장 형식 v6 의 data.plan.retireMonth). 없으면 정년까지.
   * '생애 봉급' 창에서만 쓴다 — 정년 D-day·연가·보너스·일정·카드는 정년퇴직일 그대로다.
   */
  retirePlanMonth: YearMonth | null = $derived(this.data.plan.retireMonth);
  /** 연령정년 퇴직일(정년 규정이 켜져 있으면 계급을 몰라도 셈한다). 정한 달의 상한 */
  lifeAgeRetireDate = $derived(
    isAvailable(this.careerRules.retirement)
      ? retirementInfo(this.careerRules.retirement, this.profile.birthDate).retireDate
      : null,
  );
  /** 생애 봉급의 끝나는 날(기본은 정년퇴직일). 정년을 계산하지 못하면 date 가 null */
  lifeEnd = $derived(
    resolveLifetimeEnd({
      today: this.today,
      hireDate: this.profile.hireDate,
      retirement: this.retirement,
      ageRetireDate: this.lifeAgeRetireDate,
      planMonth: this.retirePlanMonth,
    }),
  );
  /** 재직 중의 오늘(끝나는 날이 지나면 그날). 정년 기준이면 serviceDay 와 같은 날이다 */
  lifeAsOf = $derived(this.lifeEnd.date === null ? null : minYmd(this.today, this.lifeEnd.date));
  /**
   * 생애 봉급(추정): 임용일~끝나는 날의 봉급 합계와 지금까지 번 만큼. 끝나는 날이 없거나 봉급·정기승급이 꺼져 있으면 null.
   * earned 는 지갑 창의 '지금까지 번 봉급'(cumulative.total)과 같은 값이다.
   */
  lifetime = $derived(
    this.lifeEnd.date !== null && this.lifeAsOf !== null
      ? lifetimeSalary(rulesFor, this.profile, this.lifeAsOf, this.lifeEnd.date)
      : null,
  );
  /**
   * 정한 달 기준으로 셈할 때, 견줘 보일 정년퇴직일까지의 생애 봉급(추정) 합계. 정년 기준이거나 정년을 계산하지 못하면 null.
   * 끝나는 날만 다르고 셈은 lifetime 과 같다.
   */
  lifeRetirementTotal = $derived(
    this.lifeEnd.basis === 'plan' && this.retireDate !== null && this.retireDate >= this.today
      ? (lifetimeSalary(rulesFor, this.profile, this.today, this.retireDate)?.total ?? null)
      : null,
  );
  /** 받은·남은 월급날 횟수(날짜만으로 센다 — 봉급이 꺼진 직종도 나온다). 끝나는 날이 없으면 null */
  lifePaydays = $derived(
    this.lifeEnd.date === null
      ? null
      : paydayCounts(
          calendar,
          this.data.settings.payday,
          this.profile.hireDate,
          this.today,
          this.lifeEnd.date,
        ),
  );
  /** 남은 정근수당 횟수. 정근수당 규정이 꺼져 있거나 끝나는 날이 없으면 null */
  lifeDiligenceLeft = $derived.by(() => {
    const rule = this.careerRules.allowances.diligence;
    if (!isAvailable(rule) || this.lifeEnd.date === null || this.lifeAsOf === null) return null;
    return diligenceLeft(
      calendar,
      rule,
      this.data.settings.payday,
      this.profile.hireDate,
      this.lifeAsOf,
      this.lifeEnd.date,
    );
  });
  /** 끝나는 날까지 해가 바뀌는 횟수(달력의 사실. 봉급표가 바뀌는 횟수가 아니다) */
  lifeNewYears = $derived(
    this.lifeEnd.date !== null && this.lifeAsOf !== null
      ? newYearsLeft(this.lifeAsOf, this.lifeEnd.date)
      : null,
  );
  /** 정한 달 기준일 때 한마디의 기간 비율. 정년 기준이면 화면이 careerRatio 를 쓴다(정년 창과 같은 값) */
  lifeTimeRatio = $derived(
    this.lifeEnd.basis === 'plan' && this.lifeEnd.date !== null
      ? careerProgress(this.profile.hireDate, this.lifeEnd.date, this.today).ratio
      : null,
  );
  /** 월급날 횟수에 공휴일이 반영돼 있는지(아니면 하루 이틀 차이로 한 번 달라질 수 있다) */
  lifePaydayHolidaysKnown = $derived(
    this.lifeAsOf === null ? true : paydayHolidaysKnown(calendar, this.lifeAsOf),
  );
  /**
   * 금액 가리기 중에 본문을 한 줄로 줄일지: 저장된 퇴직 예정 달이 있으면 그 달·횟수·막대까지 함께 가린다.
   * 참이면 화면은 lifetime·lifePaydays·lifeEnd.planMonth 를 읽지도 않는다(숨긴 DOM 에 숫자가 남지 않게).
   */
  lifeMasked = $derived(this.data.settings.hideAmounts && this.lifeEnd.planHeld);

  // ── 쉬는 날 ──────────────────────────────────────────────────────────
  nextHoliday = $derived.by(() => {
    const next = calendar.nextWeekdayHoliday(this.today);
    if (!next) return null;
    // 그 공휴일을 포함해 이어 쉬는 날 수(앞쪽 주말도 포함)
    let start = next.date;
    while (!calendar.isWorkday(addDays(start, -1)) && diffDays(start, next.date) < 10)
      start = addDays(start, -1);
    return { ...next, restFrom: start, restDays: calendar.restRunFrom(start) };
  });
  holidayTomorrow = $derived.by(() => {
    const tomorrow = addDays(this.today, 1);
    return calendar.holidayName(tomorrow) !== null && !calendar.isWeekend(tomorrow);
  });

  // ── 연가 ─────────────────────────────────────────────────────────────
  /** 올해 연가. 연가 일수 규정이 꺼진 직종은 자동 부여 0(leave.needsManualGrant: 직접 넣어 달라고 한다) */
  leave = $derived(
    summarizeLeave(
      this.careerRules.leave,
      this.profile.hireDate,
      this.data.leave,
      this.today,
      this.retireDate ?? undefined,
    ),
  );
  /** 올해가 정년퇴직하는 해라 연가가 근무 개월 수만큼만 나오는지 */
  leaveProrated = $derived(
    this.retireDate !== null &&
      yearOf(this.retireDate) === yearOf(this.today) &&
      !this.retireDate.endsWith('-12-31'),
  );
  /**
   * 올해 연가보상비 어림(#33). 상반기 지급 여부·12월 보상 일수는 화면이 고른 값(plan)으로 받고, 고르지 않으면
   * '모름'·'최대로'다. 보상비가 없거나(교원) 준비 중이거나 올해 재직하지 않으면 null. 금액은 봉급이 꺼지면 null
   */
  leaveCompFor(
    plan: CompPlan | null,
    year: number = this.leave.year,
    opts: { excludeCarry?: boolean } = {},
  ): CompensationYear | null {
    return compensationYear({
      rules: rulesFor,
      profile: this.profile,
      leave: this.data.leave,
      year,
      today: this.today,
      retireDate: this.retireDate ?? undefined,
      plan,
      excludeCarry: opts.excludeCarry ?? false,
    });
  }
  /** 올해 연가 정리 값(저장된 것, v7 leave.years). 넣지 않았으면 null */
  leaveYearPlan = $derived(this.data.leave.years[String(this.leave.year)] ?? null);
  /** 저장된 올해 정리 값(상반기 지급 여부·보상 일수·한도·보상하지 않는 일수)으로 본 어림. 넣지 않았으면 '모름'·'최대로' */
  leaveComp = $derived(this.leaveCompFor(this.leaveYearPlan));
  /**
   * 지갑의 '연가보상비(어림)' 한 줄(#33 묶음 3). 다가오는 보너스(3개)와 다가오는 일정(5개)의 자리를 차지하지 않는다.
   * - 6월 30일 기준: 그날 남은 연가가 하한 이상(예정 기록 포함)이고, 받았다·받지 않았다고 하지 않았으면 7월 31일까지
   * - 12월 31일 기준: 정산 값이 0보다 클 때(환수는 보너스가 아니다)
   * 정년퇴직하는 해의 퇴직 줄, 셀 수 없는 해, 봉급이 꺼진 직종은 없다(null)
   */
  leaveCompBonus = $derived.by<{
    basis: 'mid' | 'end';
    amount: number;
    days: number;
    midPaid: boolean;
  } | null>(() => {
    const c = this.leaveComp;
    if (this.retired || !c || c.kind !== 'year') return null;
    const plan = this.leaveYearPlan;
    const y = c.year;
    const julyEnd = `${y}-07-31`;
    if (
      this.today <= julyEnd &&
      c.mid.eligible &&
      (plan?.midYear ?? null) === null &&
      c.mid.amount !== null &&
      c.mid.amount > 0
    )
      return { basis: 'mid', amount: c.mid.amount, days: c.mid.days, midPaid: false };
    if (this.today > julyEnd || !c.mid.eligible || plan?.midYear != null) {
      if (c.end.net !== null && c.end.net > 0 && !c.end.retireDate)
        return {
          basis: 'end',
          amount: c.end.net,
          days: c.end.chosenDays,
          midPaid: (c.end.midPaid ?? 0) > 0,
        };
    }
    return null;
  });
  /**
   * 저축연가 통장(#33). 연가 저축 항목이 꺼진 직종(교원 '해당 없음', 준비 중)은 null.
   * 넣은 칸이 없어도 빈 통장을 돌려준다(처음 잔액을 넣게 한다)
   */
  savings = $derived.by(() => {
    const rule = this.careerRules.leave.saving;
    if (!isAvailable(rule)) return null;
    return savingsLedger(rule, this.data.leave.savings, this.data.leave.records, this.today);
  });
  /**
   * 연말 정리를 할 해: 1월에는 지난해(12월 31일 기준으로 남은 연가를 나눈다), 그 밖에는 올해
   */
  yearEndYear = $derived(
    Number(this.today.slice(5, 7)) === 1 ? this.leave.year - 1 : this.leave.year,
  );
  /** 그 해를 정리했는지(보상 일수를 넣었거나 그 해 말 저축 칸이 있다) */
  yearEndDone = $derived(
    this.data.leave.years[String(this.yearEndYear)]?.compDays != null ||
      this.data.leave.savings.some((s) => s.kind === 'carry' && s.year === this.yearEndYear),
  );
  /** 12월·1월에 아직 정리하지 않았으면 홈·연가 화면에서 [연말 정리 해 보기]를 권한다(저축을 쓰는 직종만) */
  yearEndPrompt = $derived.by(() => {
    const month = Number(this.today.slice(5, 7));
    if (month !== 12 && month !== 1) return false;
    if (this.retired || this.savings === null || this.yearEndDone) return false;
    const comp = this.leaveCompFor(
      this.data.leave.years[String(this.yearEndYear)] ?? null,
      this.yearEndYear,
    );
    return comp !== null && comp.kind !== 'needsGrant';
  });
  leaveCompensationOff = $derived(offOf(this.careerRules.leave.compensation));
  /** 미리 쓸 수 있는 연가 일수. 준비 중인 직종은 null */
  advanceLimit = $derived(
    advanceLimitDays(this.careerRules.leave, this.profile.hireDate, this.today),
  );
  fullDayLeave = $derived(
    fullDayLeaveDates(this.data.leave.records, this.careerRules.leave.units.hoursPerDay),
  );
  bridges = $derived(findBridges(calendar, this.today, this.fullDayLeave));
  /** 장기재직휴가 규정이 꺼진 직종이면 그 상태(소방: 조례, 준비 중 등) */
  longLeaveOff = $derived(offOf(this.careerRules.leave.longService));
  /** 지금 쓸 수 있거나 1년 안에 생기는 장기재직휴가(특별휴가라 위 연가 계산과는 따로다) */
  longLeave = $derived.by(() => {
    const rule = this.careerRules.leave.longService;
    if (!isAvailable(rule)) return [];
    return longLeaveNotices(rule.tiers, this.profile.hireDate, this.today, this.retireDate);
  });

  // ── 일정·업적 ────────────────────────────────────────────────────────
  milestones = $derived(buildMilestones(rulesFor, this.profile, this.today));
  upcoming = $derived(upcomingMilestones(this.milestones, this.today, 5));
  achievementInput = $derived<AchievementInput>({
    today: this.today,
    data: this.data,
    milestones: this.milestones,
    currentStep: this.step,
    anchor: this.profile,
    leave: this.leave,
    cal: calendar,
  });
  /** 업적 계산이 어떤 입력에서 실패해도 화면 전체가 비지 않게, 저장된 업적을 그대로 쓴다 */
  earned = $derived.by(() => {
    try {
      return evaluateAchievements(this.achievementInput);
    } catch (error) {
      console.warn('업적을 계산하지 못해 저장된 기록을 그대로 씁니다.', error);
      return { ...this.data.achievements };
    }
  });
  badges = $derived(achievementViews(this.achievementInput, this.earned));
  earnedCount = $derived(this.badges.filter((b) => b.at !== null).length);

  // ── 올해 결산·1년 달력(날짜가 바뀔 때만 다시 센다) ──────────────────
  recapInput = $derived<GridInput>({
    today: this.today,
    profile: this.profile,
    retireDate: this.retireDate,
    maxStep: stepCeiling(this.careerRules),
    periodMonths: raisePeriodOf(this.careerRules),
    cal: calendar,
    records: this.data.leave.records,
    hoursPerDay: this.careerRules.leave.units.hoursPerDay,
    visits: this.data.visits.days,
  });
  recap = $derived(yearRecap({ ...this.recapInput, rules: rulesFor, badges: this.badges }));
  yearGrid = $derived(buildYearGrid(yearOf(this.today), this.recapInput));

  // ── 오늘(초 단위) ────────────────────────────────────────────────────
  schedule = $derived(toSchedule(this.data.settings.work, this.rules.workHours));
  status = $derived.by<TodayStatus>(() => {
    const status = todayStatus(calendar, this.schedule, clock.now);
    if (!this.retired) return status;
    // 퇴직 뒤에는 근무일이 아니다
    return {
      ...status,
      workday: false,
      phase: 'off',
      workedSeconds: 0,
      progress: 0,
      secondsToStart: null,
      secondsToEnd: null,
    };
  });
  /** 오늘·이번 달 번 돈. 봉급을 계산하지 않는 직종은 null(화면이 그 칸을 숨긴다) */
  earn = $derived(
    this.salary
      ? earnings(this.retired ? 0 : this.salary.amount, calendar, this.schedule, clock.now)
      : null,
  );
  /** 하루 중 지난 만큼을 더한 정년 진행률(소수점이 움직인다). 정년을 계산하지 않으면 0 */
  careerRatio = $derived(
    this.retireDate === null
      ? 0
      : careerProgress(this.profile.hireDate, this.retireDate, this.today, this.status.dayFraction)
          .ratio,
  );

  // ── 오늘의 연가(반차 구분) ───────────────────────────────────────────
  todayLeaveRecords = $derived(this.data.leave.records.filter((r) => r.date === this.today));
  /**
   * 오늘 반일 연가의 시간. 직종의 반일 단위가 있으면 그것(국가 4시간). 반일 단위를 확인하지 못한 직종(지방 일반직)은
   * 직종을 바꾸기 전에 적은 반일 기록의 저장 시간을 쓰고, 반일 기록이 없으면 하루 시간(반차로 보지 않는다)
   */
  halfDayHoursToday = $derived(
    this.careerRules.leave.units.halfDayHours ??
      this.todayLeaveRecords.find((r) => r.kind === 'am' || r.kind === 'pm')?.hours ??
      this.careerRules.leave.units.hoursPerDay,
  );
  /**
   * 오늘 연가 종류: 'full'(하루 이상), 'am'·'pm'(반일 기록 하나), 'hours'(시간 연가), 없으면 null
   */
  leaveToday = $derived<DayLeave>(
    dayLeaveKind(this.todayLeaveRecords, this.careerRules.leave.units.hoursPerDay),
  );
  /**
   * 반차의 경계(자정부터의 분): 퇴근 시각에서 반일 시간을 뺀 때(9~18시면 14시).
   * 오전 반차는 이때까지, 오후 반차는 이때부터 쉰다.
   */
  halfDaySplit = $derived(this.schedule.end - this.halfDayHoursToday * 60);
  /** 지금 시각이 연가 구간인지(분 단위로 바뀐다) */
  onLeaveNow = $derived.by<boolean>(() => {
    void clock.minute;
    const kind = this.leaveToday;
    if (kind === 'full') return true;
    if (kind !== 'am' && kind !== 'pm') return false;
    const minute = secondOfDay(untrack(() => clock.now)) / 60;
    return kind === 'am' ? minute < this.halfDaySplit : minute >= this.halfDaySplit;
  });

  // ── 캐릭터(분 단위) ──────────────────────────────────────────────────
  mood = $derived.by<MoodId>(() => {
    void clock.minute;
    const now = untrack(() => clock.now);
    const status = untrack(() => this.status);
    return decideMood(characterRules, {
      celebrating: this.raisedToday || this.anniversaryYears !== null,
      leaveHoursToday: this.leave.todayHours,
      onLeaveNow: this.onLeaveNow,
      halfDayHours: this.halfDayHoursToday,
      isPayday: this.isPayday,
      hour: now.getHours(),
      phase: status.phase,
      daysSinceLeave: this.leave.daysSinceLastUse,
      hasLeaveLeft: this.leave.remainingHours > 0,
    });
  });
  /** 지금 형태 id: 일반직은 직급, 다른 사다리는 evolution.byRank, 교원·사다리 없는 직종은 재직 연수 */
  formId = $derived(
    formIdFor(characterRules, {
      ladderId: this.careerRules.ladderId,
      rank: this.profile.rank,
      hireDate: this.profile.hireDate,
      today: this.serviceDay,
    }),
  );
  /** 꾸미기와 'auto' 소품을 고를 사용자 정보(직렬은 테마 id 로만 넘긴다). 모든 그림이 같은 값을 쓴다 */
  characterLook = $derived(this.data.character.look);
  propOwner = $derived(propOwnerOf(this.profile, this.seriesScope));
  /** 손 소품을 들고 있어 왼손 호봉 소품(결재판)이 나오지 않는지. 다음 소품 약속·'새로 생김'에서 뺀다 */
  handHeld = $derived(holdsOwnProp(characterRules, this.characterLook, this.propOwner));
  nextUnlock = $derived(nextUnlock(characterRules, this.step, this.handHeld));
  look = $derived(
    resolveLook(
      characterRules,
      this.formId,
      this.step,
      this.mood,
      this.characterLook,
      this.propOwner,
    ),
  );
  line = $derived.by(() => {
    void clock.minute;
    const now = untrack(() => clock.now);
    const status = untrack(() => this.status);
    return lineFor({
      today: this.today,
      nickname: this.profile.nickname,
      mood: this.mood,
      phase: status.phase,
      hour: now.getHours(),
      isPayday: this.isPayday,
      holidayTomorrow: this.holidayTomorrow,
      stepDay: this.raisedToday,
      daysToStep: this.raiseProgress ? this.raiseProgress.left : null,
      anniversaryYears: this.anniversaryYears,
    });
  });

  /** 복귀 정산: since 다음 날부터 어제까지 지나간 근무일과 월급날, 그동안 오른 호봉 */
  since(date: Ymd): { workdays: number; raises: number; paydays: number } {
    const from = addDays(date, 1);
    const to = this.today;
    let paydays = 0;
    for (let cur = from; cur < to; cur = addDays(cur, 1)) {
      const { y, m } = parseYmd(cur);
      if (calendar.payday(y, m, this.data.settings.payday) === cur) paydays += 1;
    }
    const before = careerStepOn(this.careerRules, this.profile, date);
    return {
      workdays: calendar.workdaysBetween(from, to),
      raises: Math.max(0, this.step - before),
      paydays,
    };
  }
}

export const view = new View();
