# 글꼴

| 파일 | 원본 | 쓰임 |
|---|---|---|
| `Galmuri14.subset.woff2` | Galmuri14 (15px 격자) | 본문, 숫자, 제목 — 15px의 정수배(15·30·45px)로만 쓴다 |
| `Galmuri11.subset.woff2` | Galmuri11 (12px 격자) | 작은 설명 글자 — 12px의 정수배(12·24px)로만 쓴다 |

- 원본: [Galmuri](https://github.com/quiple/galmuri) 2.40.3, Copyright (c) 2019–2025 Lee Minseo
- 라이선스: SIL Open Font License 1.1 (`OFL.txt`). 예약된 글꼴 이름(Reserved Font Name)은 없다.
- 변경: 번들 용량을 줄이려고 글자 집합만 줄였다(`scripts/subset-fonts.sh`). 글자 모양은 그대로다.
- 외부 요청을 하지 않도록 빌드할 때 HTML 안에 넣는다(웹폰트 CDN을 쓰지 않는다).
