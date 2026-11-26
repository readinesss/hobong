/**
 * 직종(#20) 화면 문구 도우미. 계산은 하지 않고 resolveCareer 결과(CareerRules)를 글로 옮긴다.
 * - 꺼진 항목('준비 중'·'해당 없음'·'다른 기준')의 이름·사유를 화면마다 같은 말로 쓰게 한다.
 * - 직종·봉급표 이름(꼬리말·설정·불러오기 요약).
 * 조사는 josa()·withRo() 로 붙인다(직종 이름 뒤에 고정 조사 금지 — copy.test).
 */
import type { CareerRules } from '../rules/career.ts';
import {
  isAvailable,
  type Avail,
  type FeatureKey,
  type PayTableId,
  type TrackId,
  type TrackRules,
  type Unavailable,
  type UnavailableStatus,
} from '../rules/types.ts';
import { josa } from './format.ts';

/** 꺼진 항목의 상태 이름(색이 아니라 글자로 구별한다) */
export const OFF_STATUS_LABEL: Record<UnavailableStatus, string> = {
  pending: '준비 중',
  none: '해당 없음',
  external: '다른 기준',
  input: '입력 필요',
};

/** 화면에 쓰는 항목 이름 */
export const FEATURE_LABEL: Record<FeatureKey | 'pay', string> = {
  pay: '봉급',
  stepRaise: '정기승급',
  promotionStep: '승진 시 호봉',
  retirement: '정년',
  probation: '시보',
  minService: '승진소요최저연수',
  longService: '근속승진',
  seniorTreatment: '대우공무원',
  leaveAnnual: '연가 일수',
  leaveAdvance: '연가 미리 쓰기',
  leaveCompensation: '연가보상비',
  leaveLongService: '장기재직휴가',
  diligence: '정근수당',
  holidayBonus: '명절휴가비',
  seniorAllowance: '대우공무원수당',
  positionAllowance: '직급보조비',
};

/** 항목의 해석 결과(CareerRules 안의 자리) */
export function featureValue(c: CareerRules, key: FeatureKey | 'pay'): Avail<object> {
  switch (key) {
    case 'pay':
      return c.pay;
    case 'leaveAnnual':
      return c.leave.annual;
    case 'leaveAdvance':
      return c.leave.advance;
    case 'leaveCompensation':
      return c.leave.compensation;
    case 'leaveLongService':
      return c.leave.longService;
    case 'diligence':
      return c.allowances.diligence;
    case 'holidayBonus':
      return c.allowances.holidayBonus;
    case 'seniorAllowance':
      return c.allowances.seniorTreatment;
    case 'positionAllowance':
      return c.allowances.position;
    default:
      return c[key];
  }
}

export interface OffFeature {
  key: FeatureKey | 'pay';
  label: string;
  status: UnavailableStatus;
  statusLabel: string;
  reason: string;
}

/** 화면 순서(봉급 → 승급·승진 → 정년 → 연가 → 수당) */
const FEATURE_ORDER: readonly (FeatureKey | 'pay')[] = [
  'pay',
  'stepRaise',
  'promotionStep',
  'minService',
  'longService',
  'seniorTreatment',
  'retirement',
  'probation',
  'leaveAnnual',
  'leaveAdvance',
  'leaveCompensation',
  'leaveLongService',
  'diligence',
  'holidayBonus',
  'seniorAllowance',
  'positionAllowance',
];

/** 이 직종에서 꺼진 항목(상태를 고르면 그 상태만) */
export function offFeatures(c: CareerRules, only?: UnavailableStatus): OffFeature[] {
  const out: OffFeature[] = [];
  for (const key of FEATURE_ORDER) {
    const value = featureValue(c, key);
    if (isAvailable(value)) continue;
    const off = value as unknown as Unavailable;
    if (only && off.status !== only) continue;
    out.push({
      key,
      label: FEATURE_LABEL[key],
      status: off.status,
      statusLabel: OFF_STATUS_LABEL[off.status],
      reason: off.reason,
    });
  }
  return out;
}

/** '준비 중: 사유' 한 줄 */
export function offText(off: Unavailable): string {
  return off.reason
    ? `${OFF_STATUS_LABEL[off.status]}: ${off.reason}`
    : OFF_STATUS_LABEL[off.status];
}

/**
 * 꺼진 항목을 문장으로: '봉급 계산은 준비 중이에요. 사유' / 입력이 모자라면 '계급을 골라 주세요. 그러면 봉급을 계산해요.'
 * 해당 없음·다른 기준은 '봉급: 해당 없음. 사유'.
 */
export function offSentence(label: string, off: Unavailable): string {
  const reason = off.reason ? ` ${off.reason}` : '';
  if (off.status === 'pending') return `${label} 계산은 준비 중이에요.${reason}`;
  if (off.status === 'input') return `${off.reason} 그러면 ${josa(label, '을', '를')} 계산해요.`;
  return `${label}: ${OFF_STATUS_LABEL[off.status]}.${reason}`;
}

/** 직종 고르기 옆 글자(색만으로 구별하지 않는다) */
export function trackStatusText(track: Pick<TrackRules, 'status'>): string {
  return track.status === 'partial' ? '일부 준비 중' : track.status === 'pending' ? '준비 중' : '';
}

/** 직종 칩 글자: '해양경찰 (일부 준비 중)' */
export function trackChipLabel(track: Pick<TrackRules, 'label' | 'status'>): string {
  const status = trackStatusText(track);
  return status ? `${track.label} (${status})` : track.label;
}

/** 일반직이 고르는 봉급표의 화면 이름 */
export const GENERAL_PAY_TABLE_LABEL: Partial<Record<PayTableId, string>> = {
  table3: '일반직(별표 3)',
  table4: '공안업무 등(별표 4)',
  table8: '우정직군(별표 8)',
};

/** 설정 '봉급표' 줄: '별표 4(공안업무 등)' */
export const PAY_TABLE_SHORT: Partial<Record<PayTableId, string>> = {
  table4: '별표 4(공안업무 등)',
  table8: '별표 8(우정직군)',
};

/** 꼬리말·안내의 직종 이름: '일반직' / '일반직(별표 4)' / '경찰' */
export function trackNameOf(c: Pick<CareerRules, 'sel' | 'track' | 'payTableId'>): string {
  if (c.sel.track === 'general' && c.payTableId && c.payTableId !== 'table3') {
    const annex = c.payTableId.replace('table', '별표 ');
    return `${c.track.label}(${annex})`;
  }
  return c.track.label;
}

/** 카드에 계급 이름을 넣는 기본값(Q2): 일반직 사다리(1~9급)만 켬. 경찰·소방·우정·외무는 직종을 드러낸다 */
export function defaultShowRank(c: Pick<CareerRules, 'ladderId'>): boolean {
  return c.ladderId === 'general';
}

/** 준비 중 직종 안내 띠: '외무는 일부만 계산해요. 준비 중: 정년, 승진소요최저연수 …' */
export function pendingTrackText(c: CareerRules): string | null {
  if (c.track.status === 'ready') return null;
  const pending = offFeatures(c, 'pending').map((f) => f.label);
  if (pending.length === 0) return null;
  // 봉급부터 준비 중인 직종(군무원·그 밖의 특정직): 열여섯 항목을 늘어놓지 않고 쓸 수 있는 것을 말한다
  if (c.track.status === 'pending' && !isAvailable(c.pay))
    return `${josa(c.track.label, '은', '는')} 봉급·정년·연가 일수 등을 아직 계산하지 않아요. 재직기간·연가 장부·근무시간은 쓸 수 있어요.`;
  return `${josa(c.track.label, '은', '는')} 일부만 계산해요. 준비 중: ${pending.join(', ')}.`;
}

/** 직종별 월급날 기본값 안내: '교원 월급날 기본값은 17일이에요.' */
export function paydayDefaultText(trackLabel: string, day: number): string {
  return `${trackLabel} 월급날 기본값은 ${day}일이에요.`;
}

export type { TrackId };
