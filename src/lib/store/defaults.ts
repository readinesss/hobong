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
      // 일반직 사다리(1~9급) 기본. 직종을 고르면(묶음 4) 그 직종에 맞춘다(경찰·소방·우정·외무는 끔)
      showRank: true,
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
    // lastForm 은 형태 변화 감지(교원 등)가 들어올 때 첫 저장의 현재 형태로 채운다. 그 전에는 비워 둔다
    character: { seenForms: [], lastRank: profile.rank, lastStep: profile.step, lastForm: null },
    visits: { days: [today], lastVisit: null },
    meta: { createdAt: nowIso, updatedAt: nowIso, lastBackupAt: null, changesSinceBackup: 0 },
  };
}
