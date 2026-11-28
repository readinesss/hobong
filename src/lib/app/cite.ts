/**
 * 본문에 다는 짧은 근거 글자. 직종 해석 결과의 근거(SourceRef)에서 읽는다 —
 * 직종마다 근거 법령이 달라(국가 공무원보수규정 / 지방공무원 보수규정) 화면에 손으로 쓰지 않는다.
 */
import type { LawInfo, SourceRef } from '../rules/types.ts';

type Laws = Readonly<Record<string, Pick<LawInfo, 'name'>>>;
type Cited = Pick<SourceRef, 'law' | 'article'>;

/** 법령 이름(모르는 키면 키 그대로) */
export function lawName(laws: Laws, law: string): string {
  return laws[law]?.name ?? law;
}

/**
 * 조문의 앞머리: '제20조제1항·제2항, 별표 30' → '제20조'. paragraph 면 첫 항까지('제17조제2항', '제7조의2제2항').
 * 조로 시작하지 않으면(별표만) 그대로
 */
export function articleHead(article: string, paragraph = false): string {
  const re = paragraph ? /^제\d+조(의\d+)?(제\d+항)?/ : /^제\d+조(의\d+)?/;
  return re.exec(article)?.[0] ?? article;
}

/** '국가공무원 복무규정 제15조' / '지방공무원 복무규정 제7조의2제2항'(paragraph) */
export function cite(laws: Laws, source: Cited, paragraph = false): string {
  return `${lawName(laws, source.law)} ${articleHead(source.article, paragraph)}`;
}

/**
 * 여러 근거를 한 줄로: 이어진 같은 법령은 이름을 한 번만 쓴다.
 * [{보수규정 제13조, '정기승급'}, {보수규정 제20조}, {수당규정 제7조}] →
 * '공무원보수규정 제13조(정기승급)·제20조, 공무원수당 등에 관한 규정 제7조'
 */
export function citeList(laws: Laws, items: readonly { source: Cited; label?: string }[]): string {
  const groups: { law: string; parts: string[] }[] = [];
  for (const { source, label } of items) {
    const part = `${articleHead(source.article)}${label ? `(${label})` : ''}`;
    const last = groups[groups.length - 1];
    if (last && last.law === source.law) {
      if (!last.parts.includes(part)) last.parts.push(part);
    } else groups.push({ law: source.law, parts: [part] });
  }
  return groups.map((g) => `${lawName(laws, g.law)} ${g.parts.join('·')}`).join(', ');
}
