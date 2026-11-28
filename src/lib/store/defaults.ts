/** 새 사용자 데이터와 기본 설정 */
import type { Ymd } from '../calc/date.ts';
import type { Rules } from '../rules/types.ts';
import type { CharacterLook, Profile, Settings, SoundSettings, UserData } from './schema.ts';

/**
 * 꾸미기 기본값. 이 모습의 합성 결과는 꾸미기를 들이기 전(v4)의 모습과 픽셀 단위로 같다(테스트가 지킨다).
 * 값은 data/character.json custom 구역의 id.
 */
export const DEFAULT_LOOK: Readonly<CharacterLook> = Object.freeze({
  body: 'sunny',
  crest: 'red',
  plume: 'auto',
  deco: Object.freeze({ pin: null, chest: null, cheek: false }),
  prop: 'auto',
});

/** 새 꾸미기 값(고칠 수 있는 사본) */
export function defaultLook(): CharacterLook {
  return { ...DEFAULT_LOOK, deco: { ...DEFAULT_LOOK.deco } };
}

/** 소리 기본값(#24 설정안): 모두 꺼짐 */
export function defaultSound(): SoundSettings {
  return { sfx: false, bgm: false, master: 80, sfxVolume: 80, bgmVolume: 50, bgmTrack: 'auto' };
}

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
      // 직렬은 소속을 짐작하게 할 수 있다. 카드는 앱 밖으로 나가므로 기본 꺼짐
      showSeries: false,
    },
    // 홈(본인 화면)에는 기본으로 보인다. 직렬을 고르지 않았으면 보일 것이 없다
    identity: { showSeriesHome: true },
    haptics: true,
    sound: defaultSound(),
    pointer: 'pixel',
    sparkles: true,
  };
}

export function newUserData(
  profile: Profile,
  settings: Settings,
  nowIso: string,
  today: Ymd,
  /** 첫 입력에서 고른 꾸미기. 없으면 기본 모습 */
  look: CharacterLook = defaultLook(),
): UserData {
  return {
    profile,
    settings,
    leave: { records: [], grantOverrideHours: {}, savings: [], years: {} },
    achievements: {},
    // lastForm 은 형태 변화 감지(교원 등)가 들어올 때 첫 저장의 현재 형태로 채운다. 그 전에는 비워 둔다
    character: {
      seenForms: [],
      lastRank: profile.rank,
      lastStep: profile.step,
      lastForm: null,
      look: { ...look, deco: { ...look.deco } },
    },
    visits: { days: [today], lastVisit: null },
    meta: { createdAt: nowIso, updatedAt: nowIso, lastBackupAt: null, changesSinceBackup: 0 },
    // 퇴직 예정 달은 정한 적이 없다(정년까지)
    plan: { retireMonth: null },
  };
}
