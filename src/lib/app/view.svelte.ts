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
import { Calendar } from '../calc/calendar.ts';
import {
  addDays,
  addMonthsClamped,
  diffDays,
  parseYmd,
  spanBetween,
  yearOf,
  type Ymd,
} from '../calc/date.ts';
import { advanceLimitDays, compensationPerDay, summarizeLeave } from '../calc/leave.ts';
import { buildMilestones, upcomingMilestones } from '../calc/milestones.ts';
import {
  longServiceInfo,
  minServiceDate,
  promotionPreview,
  seniorAllowance,
  seniorTreatmentInfo,
} from '../calc/promotion.ts';
import { careerProgress, retirementInfo } from '../calc/retirement.ts';
import {
  cumulativeSalary,
  maxStepOf,
  nextStepRaise,
  salaryOn,
  yearToDateSalary,
} from '../calc/salary.ts';
import { isRaiseDay, prevRaiseDate, stepOn } from '../calc/step.ts';
import {
  earnings,
  secondOfDay,
  todayStatus,
  toSchedule,
  type TodayStatus,
} from '../calc/today.ts';
import { decideMood, nextUnlock, resolveLook, type MoodId } from '../character/look.ts';
import { characterRules } from '../character/rules.ts';
import { lineFor } from '../lines.ts';
import { hasHolidayData, isSalaryConfirmed, rulesFor } from '../rules/index.ts';
import type { UserData } from '../store/schema.ts';
import { checkProfile } from '../store/validate.ts';

export const calendar = new Calendar(rulesFor);

class View {
  /** 화면이 그려지는 동안에는 항상 데이터가 있다 */
  get data(): UserData {
    const data = app.data;
    if (!data) throw new Error('사용자 데이터가 없습니다');
    return data;
  }

  today = $derived(clock.today);
  rules = $derived(rulesFor(yearOf(this.today)));
  /** 올해 봉급표가 아직 없어 이전 연도 표로 계산 중인지 */
  salaryPending = $derived(!isSalaryConfirmed(this.rules));
  holidayDataMissing = $derived(!hasHolidayData(this.rules));

  profile = $derived(this.data.profile);
  maxStep = $derived(maxStepOf(this.rules.salary, this.profile.grade));
  /**
   * 저장된 내 정보 중 지금 기준으로 맞지 않는 값(PC 시계가 뒤로 갔거나 규정이 바뀐 경우).
   * 저장본은 그대로 열고, 화면에서 확인을 부탁한다.
   */
  profileIssues = $derived(
    Object.values(
      checkProfile(this.profile, {
        today: this.today,
        maxStep: (grade) => maxStepOf(this.rules.salary, grade),
      }),
    ),
  );

  // ── 정년 ─────────────────────────────────────────────────────────────
  retire = $derived(retirementInfo(this.rules.retirement, this.profile.birthDate));
  /** 정년퇴직일이 지났는지 */
  retired = $derived(this.today > this.retire.retireDate);
  /**
   * 재직 중의 값(호봉·봉급·재직기간·누적 봉급)을 계산하는 날.
   * 정년퇴직일이 지나면 그날에서 멈춘다(퇴직 뒤에도 숫자가 계속 늘어나지 않게).
   */
  serviceDay = $derived(this.retired ? this.retire.retireDate : this.today);

  step = $derived(
    stepOn(this.profile, this.serviceDay, this.maxStep, this.rules.stepRaise.periodMonths),
  );
  salary = $derived(salaryOn(rulesFor, this.profile, this.serviceDay));

  // ── 승급 ─────────────────────────────────────────────────────────────
  /** 다음 정기승급. 최고호봉이거나 정년퇴직일 뒤라면 null */
  nextRaise = $derived.by(() => {
    const next = nextStepRaise(rulesFor, this.profile, this.serviceDay);
    return next && next.date <= this.retire.retireDate ? next : null;
  });
  /** 다음 승급이 없는 까닭 */
  noRaiseReason = $derived.by<'max' | 'retire' | null>(() => {
    if (this.nextRaise) return null;
    return this.step >= this.maxStep ? 'max' : 'retire';
  });
  /** 직전 승급일~다음 승급일 사이의 진행 정도 */
  raiseProgress = $derived.by(() => {
    const next = this.nextRaise;
    if (!next) return null;
    const prev = prevRaiseDate(this.profile, this.today, this.rules.stepRaise.periodMonths);
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
  raisedToday = $derived(
    isRaiseDay(this.profile, this.today, this.maxStep, this.rules.stepRaise.periodMonths),
  );
  nextUnlock = $derived(nextUnlock(characterRules, this.step));

  // ── 재직 ─────────────────────────────────────────────────────────────
  career = $derived(careerProgress(this.profile.hireDate, this.retire.retireDate, this.today));
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
  longService = $derived(longServiceInfo(this.rules.promotion, this.profile));
  senior = $derived(seniorTreatmentInfo(this.rules.promotion, this.profile));
  minService = $derived(
    minServiceDate(this.rules.promotion, this.profile.grade, this.profile.gradeDate),
  );
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
  cumulative = $derived(cumulativeSalary(rulesFor, this.profile, this.serviceDay));
  /** 올해 번 봉급. 지난해 이전에 퇴직했다면 0 */
  yearToDate = $derived(
    yearOf(this.serviceDay) < yearOf(this.today)
      ? 0
      : yearToDateSalary(rulesFor, this.profile, this.serviceDay),
  );
  /** 기준일에 재직 중인 보너스만(정년퇴직일 뒤의 정근수당·명절휴가비는 없다) */
  bonuses = $derived(
    upcomingBonuses(
      rulesFor,
      calendar,
      this.profile,
      this.data.settings.payday,
      this.today,
      3,
      this.retire.retireDate,
    ),
  );
  /** 공휴일 데이터가 없어 명절휴가비가 목록에서 빠졌을 수 있는 해 */
  bonusGapYear = $derived(missingHolidayYearForBonuses(calendar, this.today));
  payday = $derived(calendar.nextPayday(this.today, this.data.settings.payday));
  /** 다음 월급날이 속한 해의 공휴일이 반영돼 있는지(아니면 공휴일과 겹쳐 앞당겨질 수 있다) */
  paydayHolidaysKnown = $derived(calendar.hasHolidayData(yearOf(this.payday)));
  isPayday = $derived(!this.retired && this.payday === this.today);

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
  leave = $derived(
    summarizeLeave(
      this.rules.leave,
      this.profile.hireDate,
      this.data.leave,
      this.today,
      this.retire.retireDate,
    ),
  );
  /** 올해가 정년퇴직하는 해라 연가가 근무 개월 수만큼만 나오는지 */
  leaveProrated = $derived(
    yearOf(this.retire.retireDate) === yearOf(this.today) &&
      !this.retire.retireDate.endsWith('-12-31'),
  );
  leaveDayPrice = $derived(compensationPerDay(this.rules.leave, this.salary.amount));
  advanceLimit = $derived(advanceLimitDays(this.rules.leave, this.profile.hireDate, this.today));
  fullDayLeave = $derived(
    fullDayLeaveDates(this.data.leave.records, this.rules.leave.units.hoursPerDay),
  );
  bridges = $derived(findBridges(calendar, this.today, this.fullDayLeave));

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
  earn = $derived(
    earnings(this.retired ? 0 : this.salary.amount, calendar, this.schedule, clock.now),
  );
  /** 하루 중 지난 만큼을 더한 정년 진행률(소수점이 움직인다) */
  careerRatio = $derived(
    careerProgress(
      this.profile.hireDate,
      this.retire.retireDate,
      this.today,
      this.status.dayFraction,
    ).ratio,
  );

  // ── 오늘의 연가(반차 구분) ───────────────────────────────────────────
  /**
   * 오늘 연가 종류: 'full'(하루 이상), 'am'·'pm'(반일 기록 하나), 'hours'(시간 연가), 없으면 null
   */
  leaveToday = $derived.by<'full' | 'am' | 'pm' | 'hours' | null>(() => {
    const records = this.data.leave.records.filter((r) => r.date === this.today);
    const hours = records.reduce((sum, r) => sum + r.hours, 0);
    if (hours <= 0) return null;
    if (hours >= this.rules.leave.units.hoursPerDay) return 'full';
    const only = records.length === 1 ? records[0] : undefined;
    if (only && (only.kind === 'am' || only.kind === 'pm')) return only.kind;
    return 'hours';
  });
  /**
   * 반차의 경계(자정부터의 분): 퇴근 시각에서 반일 시간을 뺀 때(9~18시면 14시).
   * 오전 반차는 이때까지, 오후 반차는 이때부터 쉰다.
   */
  halfDaySplit = $derived(this.schedule.end - this.rules.leave.units.halfDayHours * 60);
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
      halfDayHours: this.rules.leave.units.halfDayHours,
      isPayday: this.isPayday,
      hour: now.getHours(),
      phase: status.phase,
      daysSinceLeave: this.leave.daysSinceLastUse,
      hasLeaveLeft: this.leave.remainingHours > 0,
    });
  });
  look = $derived(resolveLook(characterRules, this.profile.grade, this.step, this.mood));
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
    const before = stepOn(this.profile, date, this.maxStep, this.rules.stepRaise.periodMonths);
    return {
      workdays: calendar.workdaysBetween(from, to),
      raises: Math.max(0, this.step - before),
      paydays,
    };
  }
}

export const view = new View();
