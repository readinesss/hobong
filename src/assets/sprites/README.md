# 스프라이트

한 글자가 한 픽셀인 텍스트 그리드다. 형식은 `src/lib/character/sprite-format.ts` 머리말에 있다.

- `.` 투명, `0-9a-f` 팔레트 인덱스(16색, `data/character.json`의 `palette`)
- `char-*.txt` 캐릭터 부품(몸통·눈·소품·효과·알), `icons.txt` 16×16 UI 아이콘
  - `char-deco.txt` 꾸미기 장식(머리핀·가슴 배지·볼 터치), `char-series.txt` 일반직 직렬 소품,
    `char-track.txt` 특정직 소품. 손 소품은 `@attach handL`·`@layer 25`·`@skin`(쥔 날개 끝이 몸 색을 따른다)
- 몸통의 3·4 는 몸 색이다. 깃·볏·꼬리에는 쓰지 않는다(꾸미기 색 바꾸기가 영역으로 나눈다:
  `src/lib/character/regions.ts`). 몸통을 고친 뒤에는 영역 칸 수 테스트가 바뀌므로 미리보기로 다시 확인한다.
- 고친 뒤에는 `npm run sprites:preview` 로 `.preview/sprites.png` 를 만들어 눈으로 확인한다.
