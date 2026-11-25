# 스프라이트

한 글자가 한 픽셀인 텍스트 그리드다. 형식은 `src/lib/character/sprite-format.ts` 머리말에 있다.

- `.` 투명, `0-9a-f` 팔레트 인덱스(16색, `data/character.json`의 `palette`)
- `char-*.txt` 캐릭터 부품(몸통·눈·소품·효과·알), `icons.txt` 16×16 UI 아이콘
- 고친 뒤에는 `npm run sprites:preview` 로 `.preview/sprites.png` 를 만들어 눈으로 확인한다.
