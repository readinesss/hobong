/**
 * 규정 데이터가 낡지 않았는지 점검한다(순수 함수).
 *
 * 이 서비스에서 사람이 해마다 챙겨야 하는 일은 사실상 data/<연도>.json 갱신뿐이다.
 * 그 일을 잊지 않도록 "오늘 기준으로 손봐야 할 것"을 찾아낸다.
 * CI 요약과 월간 점검 워크플로(.github/workflows/rules-watch.yml)가 쓴다.
 */
import { diffDays, parseYmd, type Ymd } from '../calc/date.ts';
import { availableYears, type RulesRegistry } from './resolve.ts';
import type { SectionKey } from './types.ts';

export interface FreshnessFinding {
  /** 같은 건으로 알림을 두 번 만들지 않기 위한 식별자 */
  id: string;
  /** action: 지금 계산에 영향이 있다 / upcoming: 미리 준비할 일 */
  level: 'action' | 'upcoming';
  /** 손봐야 할 데이터의 연도 */
  year: number;
  title: string;
  detail: string;
}

/** 이 달부터는 다음 해 공휴일이 들어 있어야 한다(월력요항은 전년도 중반에 발표된다). */
export const NEXT_YEAR_HOLIDAYS_FROM_MONTH = 7;
/** 원문을 마지막으로 확인한 뒤 이만큼 지나면 다시 확인하도록 알린다. */
export const REVERIFY_AFTER_DAYS = 183;

const SECTION_LABEL: Record<SectionKey, string> = {
  retirement: '정년',
  probation: '시보 기간',
  salary: '봉급표',
  stepRaise: '승급 기간',
  promotionStep: '승진 시 호봉',
  payday: '보수 지급일',
  workHours: '근무시간',
  leave: '연가',
  promotion: '승진·근속승진·대우공무원',
  allowances: '수당',
  holidays: '공휴일',
};

export function sectionLabel(key: SectionKey): string {
  return SECTION_LABEL[key];
}

function holidayCount(registry: RulesRegistry, year: number): number {
  return registry.get(year)?.holidays?.items.length ?? 0;
}

/** 오늘(today) 기준으로 규정 데이터에서 손봐야 할 것 */
export function checkFreshness(registry: RulesRegistry, today: Ymd): FreshnessFinding[] {
  const { y: year, m: month } = parseYmd(today);
  const findings: FreshnessFinding[] = [];
  const years = availableYears(registry);
  const current = registry.get(year);

  if (!current) {
    const latest = years.filter((y) => y < year).pop();
    findings.push({
      id: `missing-${year}`,
      level: 'action',
      year,
      title: `${year}년 규정 파일이 없습니다`,
      detail:
        latest === undefined
          ? `data/${year}.json 이 없어 계산할 규정이 없습니다.`
          : `data/${year}.json 이 없어 ${latest}년 규정으로 계산하고 있습니다. 공휴일은 연도가 다르면 쓸 수 없어 월급날·근무일·징검다리 계산이 부정확합니다.`,
    });
  } else {
    for (const key of current.pending ?? []) {
      findings.push({
        id: `pending-${year}-${key}`,
        level: 'action',
        year,
        title: `${year}년 ${SECTION_LABEL[key]}: 확정 전(이전 연도 값 사용 중)`,
        detail: `data/${year}.json 의 pending 에 '${key}' 가 남아 있어 ${current.extends ?? '이전'}년 값을 쓰고 있습니다. 개정된 원문을 확인해 값을 넣고 pending 에서 지워 주세요.`,
      });
    }
    if (holidayCount(registry, year) === 0) {
      findings.push({
        id: `holidays-${year}`,
        level: 'action',
        year,
        title: `${year}년 공휴일이 없습니다`,
        detail: `data/${year}.json 에 holidays 항목이 없거나 비어 있습니다. 월급날·근무일·징검다리 계산에 필요합니다.`,
      });
    }
    const age = diffDays(current.verifiedAt, today);
    if (age > REVERIFY_AFTER_DAYS) {
      findings.push({
        id: `reverify-${year}-${current.verifiedAt}`,
        level: 'upcoming',
        year,
        title: `${year}년 규정을 다시 확인할 때입니다`,
        detail: `마지막 원문 확인일(${current.verifiedAt})에서 ${age}일 지났습니다. 그사이 개정(수당·복무 규정, 임시공휴일 지정 등)이 있었는지 확인하고 verifiedAt 을 갱신해 주세요.`,
      });
    }
  }

  if (month >= NEXT_YEAR_HOLIDAYS_FROM_MONTH && holidayCount(registry, year + 1) === 0) {
    findings.push({
      id: `holidays-${year + 1}`,
      level: 'upcoming',
      year: year + 1,
      title: `${year + 1}년 공휴일을 넣을 때입니다`,
      detail: `다음 해 월력요항이 발표됐는지 확인하고 data/${year + 1}.json 에 holidays 를 넣어 주세요. 없으면 해가 바뀐 뒤의 월급날·징검다리를 미리 보여줄 수 없습니다.`,
    });
  }

  return findings;
}
