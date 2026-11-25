/** 새 사용자 데이터와 기본 설정 */
import type { Ymd } from '../calc/date.ts';
import type { Rules } from '../rules/types.ts';
import type { Profile, Settings, UserData } from './schema.ts';

export function defaultSettings(rules: Pick<Rules, 'payday' | 'workHours'>): Settings {
  return {
    payday: rules.payday.defaultDay,
    work: {
      start: rules.workHours.start,
      end: rules.workHours.end,
      lunchStart: rules.workHours.lunchStart,
      lunchEnd: rules.workHours.lunchEnd,
    },
    theme: 'auto',
    reduceMotion: false,
    hideAmounts: false,
    tabTitle: 'default',
    card: {
      ratio: 'square',
      showSalary: false,
      showRetirement: false,
      showTenure: true,
      showBadges: true,
    },
  };
}

export function newUserData(
  profile: Profile,
  settings: Settings,
  nowIso: string,
  today: Ymd,
): UserData {
  return {
    profile,
    settings,
    leave: { records: [], grantOverrideHours: {} },
    achievements: {},
    character: { seenForms: [], lastGrade: profile.grade, lastStep: profile.step },
    visits: { days: [today], lastVisit: null },
    meta: { createdAt: nowIso, updatedAt: nowIso, lastBackupAt: null, changesSinceBackup: 0 },
  };
}
