# 제3자 고지

호봉의 빌드 결과물(`hobong.html`)에 함께 들어가는 다른 사람의 저작물과 그 조건입니다.
같은 내용이 앱의 **설정 → 호봉에 대하여 → 오픈소스 고지**에도 전문과 함께 들어 있습니다.

## 결과물에 포함되는 것

| 이름 | 쓰임 | 라이선스 | 저작권 | 전문 |
|---|---|---|---|---|
| [Galmuri](https://github.com/quiple/galmuri) 2.40.3 | 글꼴(Galmuri14·Galmuri11). 글자 집합만 줄인 서브셋 | SIL Open Font License 1.1 | © 2019–2025 Lee Minseo | [`src/assets/fonts/OFL.txt`](src/assets/fonts/OFL.txt) |
| [Svelte](https://svelte.dev) 5 | 화면을 그리는 실행 코드 | MIT | © 2016–2025 Svelte Contributors | [`src/assets/licenses/svelte-MIT.txt`](src/assets/licenses/svelte-MIT.txt) |

- Galmuri는 예약된 글꼴 이름(Reserved Font Name)이 없어 서브셋을 같은 이름으로 배포할 수 있습니다.
  글자 모양은 바꾸지 않았고, 만드는 방법은 [`scripts/subset-fonts.sh`](scripts/subset-fonts.sh)에 있습니다.
- 색은 GrafxKid의 16색 팔레트 **Sweetie 16**을 씁니다.

## 결과물에 들어가지 않는 것

Vite, TypeScript, Vitest, Playwright, ESLint, Prettier 등은 만들고 검사하는 데만 쓰며 결과물에는 들어가지 않습니다.
목록과 버전은 [`package.json`](package.json)에 있습니다.

## 법령 발췌본

`docs/sources/` 의 글은 국가법령정보센터 등에서 가져온 법령·행정규칙·공공 달력자료의 발췌본입니다.
법령과 고시·훈령은 저작권법 제7조에 따라 보호받지 못하는 저작물입니다. 각 파일 머리에 출처와 조회일을 적었습니다.

## 캐릭터와 아이콘

`src/assets/sprites/` 의 캐릭터 "호봉이"와 아이콘은 이 프로젝트를 위해 새로 그린 것입니다.
