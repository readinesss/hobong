/**
 * 운영 정보(data/site.json): 제안·문의 메일 주소와 '호봉이의 꿈'(앞으로 만들고 싶은 것).
 * 법령과 무관한 값이라 규정 데이터(data/<연도>.json)와 따로 둔다.
 *
 * 앱은 메일을 보내지 않는다. 주소를 보여 주고, 사용자가 자기 메일 프로그램으로 직접 보낸다.
 */
import raw from '../../data/site.json';

export type DreamStatus = 'done' | 'growing' | 'dream';

export interface Dream {
  id: string;
  status: DreamStatus;
  title: string;
  blurb: string;
}

export interface SiteFile {
  schema: 1;
  notes?: string[];
  contactEmail: string;
  dreams: Dream[];
}

/** 화면에 묶어 보이는 순서와 이름 */
export const DREAM_GROUPS: readonly { status: DreamStatus; label: string; icon: string }[] = [
  { status: 'done', label: '이룬 꿈', icon: 'icon-check' },
  { status: 'growing', label: '자라는 중', icon: 'icon-sprout' },
  { status: 'dream', label: '꾸는 꿈', icon: 'icon-moon' },
];

/**
 * 메일 주소 형식(받는 쪽에서 흔히 쓰는 꼴만): 이름@도메인.최상위.
 * 빈칸·꺾쇠·따옴표·괄호 등 mailto 주소를 깨뜨릴 수 있는 글자는 받지 않는다.
 */
const EMAIL_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** 쓸 수 있는 메일 주소면 다듬어서, 아니면(빈 값 포함) null */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length <= 254 && EMAIL_RE.test(trimmed) ? trimmed : null;
}

/** 메일 쓰기 링크. 제목·본문에는 개인정보를 넣지 않는다(앱 버전 같은 정보만) */
export function mailtoHref(email: string, subject: string, body = ''): string {
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${email}?${params.join('&')}`;
}

export const site = raw as SiteFile;
export const CONTACT_EMAIL: string | null = normalizeEmail(site.contactEmail);
export const DREAMS: readonly Dream[] = site.dreams;
