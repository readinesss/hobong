/**
 * 알 콕 누르기(#39): 손길 해석기·반응표·글 고르기(src/lib/fx/poke.ts). 시계는 테스트가 쥔다.
 */
import { describe, expect, it } from 'vitest';
import { moveAt, moveDuration, MOVES, type Move } from '../../src/lib/fx/moves.ts';
import {
  createPokeTracker,
  echoCount,
  echoMove,
  fanFor,
  pickPokeLine,
  POKE,
  pokeLines,
  pokeReaction,
  pokeSfx,
  sideOf,
  withLean,
  type PokeInput,
  type PokeLineKey,
  type PokeTracker,
} from '../../src/lib/fx/poke.ts';
import { TALK } from '../../src/lib/talk.ts';

/** 누르고 ms 뒤에 뗀다 */
function tap(t: PokeTracker, at: number, ms = 80, x = 50, y = 50) {
  t.down(at, x, y, 0);
  return t.up(at + ms);
}

function expectFairMove(move: Move, name: string) {
  expect(move.length, name).toBeGreaterThan(0);
  for (const frame of move) {
    expect(Number.isInteger(frame.dx) && Number.isInteger(frame.dy), name).toBe(true);
    expect(Math.abs(frame.dx), name).toBeLessThanOrEqual(3);
    expect(Math.abs(frame.dy), name).toBeLessThanOrEqual(3);
    expect(frame.ms, name).toBeGreaterThanOrEqual(40);
  }
  expect(moveDuration(move), name).toBeLessThanOrEqual(600);
  expect(moveAt(move, moveDuration(move)), name).toEqual({ dx: 0, dy: 0 });
  expect(move[move.length - 1], name).toMatchObject({ dx: 0, dy: 0 });
}

const base: PokeInput = {
  kind: 'tap',
  stage: 0,
  combo: 1,
  side: 0,
  rest: null,
  reduced: false,
  busy: false,
  roomy: true,
};

describe('누른 자리', () => {
  it('단추를 셋으로 나눠 왼쪽 -1, 가운데 0, 오른쪽 +1', () => {
    expect(sideOf(0, 0, 300)).toBe(-1);
    expect(sideOf(99.9, 0, 300)).toBe(-1);
    expect(sideOf(100, 0, 300)).toBe(0);
    expect(sideOf(199.9, 0, 300)).toBe(0);
    expect(sideOf(200, 0, 300)).toBe(1);
    expect(sideOf(310, 10, 300)).toBe(1);
    expect(sideOf(50, 0, 0)).toBe(0);
    expect(sideOf(Number.NaN, 0, 300)).toBe(0);
  });

  it('기울임은 첫 칸만 누른 반대쪽으로 한 칸, 끝은 제자리', () => {
    expect(withLean(MOVES.boing, 0)).toBe(MOVES.boing);
    expect(withLean(MOVES.boing, -1)[0]).toEqual({ dx: 1, dy: -2, ms: 70 });
    expect(withLean(MOVES.boing, 1)[0]).toEqual({ dx: -1, dy: -2, ms: 70 });
    expect(withLean(MOVES.boing, 1).slice(1)).toEqual(MOVES.boing.slice(1));
    for (const name of ['boing', 'boing2', 'giggle', 'readyPoke', 'tap', 'hop'] as const)
      for (const side of [-1, 1] as const) expectFairMove(withLean(MOVES[name], side), name);
    // 한 칸짜리 자세(웅크림)는 기울이지 않는다
    expect(withLean(MOVES.crouch, 1)).toBe(MOVES.crouch);
  });

  it('조각은 누른 반대쪽 위로 튄다', () => {
    const [l0, l1] = fanFor(-1);
    const [r0, r1] = fanFor(1);
    // 화면 좌표(아래가 +): 1.5π 가 위. 왼쪽을 누르면 오른쪽 위(1.5π~2π), 오른쪽을 누르면 왼쪽 위
    expect((l0 + l1) / 2).toBeGreaterThan(Math.PI * 1.5);
    expect((r0 + r1) / 2).toBeLessThan(Math.PI * 1.5);
  });
});

describe('새 몸짓·메아리', () => {
  it('알 콕 누르기 몸짓은 정수 칸·3칸 안·600ms 안이고, 장난(콩)은 진행 신호(톡)보다 작다', () => {
    for (const name of [
      'boing',
      'boing2',
      'giggle',
      'bigHop',
      'tuck',
      'readyPoke',
      'startle',
      'jolt',
      'lookAround',
    ] as const)
      expectFairMove(MOVES[name], name);
    const height = (move: Move) => Math.max(...move.map((f) => -f.dy));
    expect(height(MOVES.boing)).toBeLessThan(height(MOVES.tap));
  });

  it('메아리는 n 번 두드린다(200ms 씩)', () => {
    expect(moveDuration(echoMove(2))).toBe(400);
    expect(moveDuration(echoMove(3))).toBe(600);
    expectFairMove(echoMove(2), 'echo2');
    expectFairMove(echoMove(3), 'echo3');
    expect(echoMove(9).length).toBe(9);
  });
});

describe('손길 해석기', () => {
  it('짧게 누르고 떼면 한 번 누르기, 첫 확정에만 신호', () => {
    const t = createPokeTracker();
    expect(t.down(1000, 10, 10, -1)).toBe(true);
    expect(t.pressing).toBe(true);
    // 누른 채 다시 down 이 와도(두 번째 손가락) 받지 않는다
    expect(t.down(1010, 10, 10, 1)).toBe(false);
    const c = t.up(1080);
    expect(c).toMatchObject({ kind: 'tap', combo: 1, side: -1, rest: null, cue: true, total: 1 });
    expect(t.pressing).toBe(false);
    expect(t.up(1100)).toBeNull();
  });

  it('600ms 안에 다시 누르면 이어 누르기(combo), 넘으면 새 묶음', () => {
    const t = createPokeTracker();
    expect(tap(t, 0)?.combo).toBe(1);
    // 앞 확정(80)에서 600ms 뒤에 누름 → 이어짐
    expect(tap(t, 680)?.combo).toBe(2);
    expect(tap(t, 1300)?.combo).toBe(3);
    // 앞 확정(1380)에서 601ms 뒤 → 새 묶음
    expect(tap(t, 1981)?.combo).toBe(1);
  });

  it('신호는 묶음의 첫 확정에만, 앞 신호와 400ms 넘게 떨어져서', () => {
    const t = createPokeTracker();
    const cues = [0, 200, 400, 600].map((at) => tap(t, at, 50)?.cue);
    expect(cues).toEqual([true, false, false, false]);
    // 묶음이 끝난 뒤(700ms 조용) 새 묶음의 첫 확정이면 다시
    expect(t.settle(650 + POKE.quietMs)).not.toBeNull();
    expect(tap(t, 2000)?.cue).toBe(true);
    // 앞 신호에서 400ms 안이면 새 묶음이어도 내지 않는다
    const u = createPokeTracker();
    expect(tap(u, 0, 50)?.cue).toBe(true);
    u.forget();
    expect(tap(u, 300, 50)?.cue).toBe(false);
  });

  it('마지막 확정 뒤 700ms 조용하면 묶음 요약을 한 번만 돌려준다', () => {
    const t = createPokeTracker();
    tap(t, 0);
    tap(t, 300);
    tap(t, 600);
    expect(t.settle(680 + POKE.quietMs - 1)).toBeNull();
    expect(t.settle(680 + POKE.quietMs)).toEqual({
      count: 3,
      combo: 3,
      kind: 'tap',
      rested: false,
    });
    expect(t.settle(5000)).toBeNull();
    // 누르고 있는 동안에는 끝나지 않는다
    t.down(6000, 0, 0, 0);
    expect(t.settle(9000)).toBeNull();
  });

  it('질문이 바뀌면(forget) 기다리던 묶음을 버린다', () => {
    const t = createPokeTracker();
    tap(t, 0);
    t.forget();
    expect(t.settle(5000)).toBeNull();
    expect(tap(t, 100)?.combo).toBe(1);
  });

  it('500ms 누르고 있으면 품기: 시작 한 번, 하트는 400ms 마다 셋까지', () => {
    const t = createPokeTracker();
    t.down(0, 50, 50, 0);
    expect(t.tick(100)).toEqual({ nextAt: POKE.holdMs });
    expect(t.tick(500)).toEqual({ holdStart: true, heart: true, nextAt: 900 });
    expect(t.tick(700)).toEqual({ nextAt: 900 });
    expect(t.tick(900)).toEqual({ heart: true, nextAt: 1300 });
    expect(t.tick(1300)).toEqual({ heart: true, nextAt: null });
    expect(t.tick(1700)).toEqual({ nextAt: null });
    const c = t.up(1800);
    expect(c).toMatchObject({ kind: 'hold', cue: true });
  });

  it('품기를 마치면 같은 묶음이어도 한 번 더 신호를 낸다(묶음에 두 번까지)', () => {
    const t = createPokeTracker();
    expect(tap(t, 0)?.cue).toBe(true);
    t.down(500, 0, 0, 0);
    t.tick(1000);
    expect(t.up(1100)).toMatchObject({ kind: 'hold', combo: 2, cue: true });
    t.down(1200, 0, 0, 0);
    t.tick(1700);
    expect(t.up(1800)).toMatchObject({ kind: 'hold', cue: false });
  });

  it('세로로 8px 넘게 움직이면 스크롤: 취소하고 확정하지 않는다', () => {
    const t = createPokeTracker();
    t.down(0, 50, 50, 0);
    expect(t.move(10, 50, 58)).toBeNull();
    expect(t.move(20, 50, 59)).toEqual({ cancel: true });
    expect(t.pressing).toBe(false);
    expect(t.up(30)).toBeNull();
    expect(t.total).toBe(0);
  });

  it('조금 움직인 채 500ms 가 지나도 8px 를 넘었으면 품기가 아니다', () => {
    const t = createPokeTracker();
    t.down(0, 50, 50, 0);
    t.move(100, 60, 50);
    expect(t.tick(600).holdStart).toBeUndefined();
    expect(t.up(700)?.kind).toBe('tap');
  });

  it('누른 채 좌우를 800ms 안에 세 번 바꾸면 문지르기', () => {
    const t = createPokeTracker();
    t.down(0, 50, 50, 0);
    expect(t.move(50, 56, 50)?.rub).toEqual({ dir: 1, turns: 0, started: false });
    expect(t.move(100, 50, 50)?.rub).toMatchObject({ dir: -1, turns: 1, started: false });
    // 같은 방향으로 더 가도 바뀐 것이 아니다
    expect(t.move(120, 45, 50)).toBeNull();
    expect(t.move(150, 52, 50)?.rub).toMatchObject({ turns: 2, started: false });
    expect(t.move(200, 46, 50)?.rub).toMatchObject({ turns: 3, started: true });
    expect(t.move(250, 52, 50)?.rub).toMatchObject({ turns: 4, started: false });
    // 문지르는 동안에는 세로로 조금 흔들려도 취소하지 않고, 품기도 되지 않는다
    expect(t.move(260, 52, 62)?.cancel).toBeUndefined();
    expect(t.tick(900).holdStart).toBeUndefined();
    expect(t.up(1000)?.kind).toBe('rub');
  });

  it('천천히 바꾸면(800ms 넘게 떨어져) 문지르기가 아니다', () => {
    const t = createPokeTracker();
    t.down(0, 50, 50, 0);
    t.move(10, 56, 50);
    t.move(900, 50, 50);
    t.move(1800, 56, 50);
    expect(t.move(2700, 50, 50)?.rub?.started).toBe(false);
    expect(t.up(2800)?.kind).toBe('tap');
  });

  it('3초 안에 열 번이면 쉬기(웅크림) → 1.5초 동안은 통만, 신호 없음 → 다시 처음부터', () => {
    const t = createPokeTracker();
    const out = Array.from({ length: 10 }, (_, i) => tap(t, i * 250, 50));
    expect(out.slice(0, 9).every((c) => c?.rest === null)).toBe(true);
    const tenth = out[9];
    expect(tenth?.rest).toBe('start');
    expect(tenth?.cue).toBe(false);
    expect(t.resting(2300)).toBe(true);
    expect(tap(t, 2500, 50)?.rest).toBe('on');
    expect(tap(t, 3000, 50)?.rest).toBe('on');
    expect(t.resting(2300 + POKE.restMs)).toBe(false);
    // 묶음 요약에 쉬었다고 남는다(메아리를 하지 않는다)
    expect(t.settle(3050 + POKE.quietMs)?.rested).toBe(true);
    // 쉬고 나면 다시 열 번을 센다
    expect(tap(t, 3900, 50)?.rest).toBeNull();
  });

  it('이번 화면에서 누른 수를 센다(취소는 세지 않는다)', () => {
    const t = createPokeTracker();
    for (let i = 0; i < 12; i += 1) tap(t, i * 1000);
    t.down(20_000, 0, 0, 0);
    t.cancel();
    expect(t.total).toBe(12);
    expect(POKE.greetPokedAt).toBe(12);
  });
});

describe('반응표', () => {
  const sig = (input: PokeInput) => JSON.stringify(pokeReaction(input));

  it('금 단계 0~4 마다 반응이 다르다(몸짓·조각·눈·두드림)', () => {
    const all = [0, 1, 2, 3, 4].map((stage) => sig({ ...base, stage }));
    expect(new Set(all).size).toBe(5);
    expect(pokeReaction({ ...base, stage: 0 }).line).toBe('tap0');
    expect(pokeReaction({ ...base, stage: 4 }).line).toBe('tap4');
    // 단계 4: 튀고 나서 안에서 두드린다(누른 반대쪽에 표시)
    const ready = pokeReaction({ ...base, stage: 4, side: 1 });
    expect(ready.knock).toEqual([{ at: 260, side: 'l' }]);
    expect(pokeReaction({ ...base, stage: 4, side: -1 }).knock).toEqual([{ at: 260, side: 'r' }]);
  });

  it('이어 누른 수(1·2·3·5)마다 반응이 다르고, 다섯 번째는 큰 폴짝과 별 둘레', () => {
    const all = [1, 2, 3, 5].map((combo) => sig({ ...base, stage: 1, combo }));
    expect(new Set(all).size).toBe(4);
    const five = pokeReaction({ ...base, combo: 5 });
    expect(five.move).toBe(MOVES.bigHop);
    expect(five.bits).toMatchObject({ shape: 'ring', count: POKE.ringBits });
    expect(five.line).toBe('hop');
    expect(pokeReaction({ ...base, combo: 2 }).line).toBe('few');
  });

  it('여섯 번째부터는 콩콩·꼼지락을 번갈고 글도 그 몸짓(many)을 말한다. 다섯 번째마다 다시 폴짝', () => {
    for (const combo of [6, 7, 8, 9]) {
      const r = pokeReaction({ ...base, stage: 1, combo });
      expect(r.line, String(combo)).toBe('many');
      expect(r.move, String(combo)).toBe(combo % 2 === 0 ? MOVES.boing2 : MOVES.giggle);
    }
    expect(pokeReaction({ ...base, stage: 1, combo: 6 }).move).not.toBe(
      pokeReaction({ ...base, stage: 1, combo: 7 }).move,
    );
    const ten = pokeReaction({ ...base, stage: 2, combo: 10 });
    expect(ten.move).toBe(MOVES.bigHop);
    expect(ten.line).toBe('hop');
    expect(ten.bits?.shape).toBe('ring');
  });

  it('한 번 누르기는 금 단계마다 몸짓부터 다르다(화들짝·부르르·두리번·콩콩·되받아 두드림)', () => {
    const moves = [0, 1, 2, 3, 4].map((stage) => pokeReaction({ ...base, stage }).move);
    expect(moves).toEqual([
      MOVES.startle,
      MOVES.jolt,
      MOVES.lookAround,
      MOVES.boing2,
      MOVES.readyPoke,
    ]);
  });

  it('다 채운 알을 세 번 넘게 이어 누르면 안에서 똑똑 두드린다', () => {
    const r = pokeReaction({ ...base, stage: 4, combo: 3 });
    expect(r.move).toBe(MOVES.knock);
    expect(r.knock.map((k) => k.side)).toEqual(['r', 'l']);
    expect(r.line).toBe('readyMany');
  });

  it('조각은 한 번에 셋까지(다섯 번째만 다섯), 밭이 붐비면 내지 않는다', () => {
    for (let stage = 0; stage <= 4; stage += 1)
      for (let combo = 1; combo <= 9; combo += 1) {
        const r = pokeReaction({ ...base, stage, combo });
        expect(r.bits?.count ?? 0).toBeLessThanOrEqual(
          combo % 5 === 0 ? POKE.ringBits : POKE.maxBits,
        );
        expect(pokeReaction({ ...base, stage, combo, roomy: false }).bits).toBeNull();
      }
  });

  it('누른 자리에 따라 몸짓이 기운다', () => {
    const left = pokeReaction({ ...base, side: -1 }).move;
    const right = pokeReaction({ ...base, side: 1 }).move;
    expect(left?.[0]?.dx).toBe(1);
    expect(right?.[0]?.dx).toBe(-1);
  });

  it('움직임 줄이기: 몸짓·조각·눈·두드림 없이 멈춘 표시, 글 키는 같다(문장은 egg.poke.still 에서 고른다)', () => {
    for (const input of [
      base,
      { ...base, stage: 4, combo: 3 },
      { ...base, kind: 'hold' as const },
      { ...base, rest: 'start' as const },
    ]) {
      const r = pokeReaction({ ...input, reduced: true });
      expect(r).toMatchObject({ move: null, bits: null, peek: null, knock: [], still: true });
      expect(r.line).toBe(pokeReaction(input).line);
    }
  });

  it('답할 때의 반응이 도는 중이면 글만', () => {
    const r = pokeReaction({ ...base, stage: 3, busy: true });
    expect(r).toMatchObject({ move: null, bits: null, peek: null, knock: [], still: false });
    expect(r.line).toBe('tap3');
  });

  it('쉬기는 웅크림 → 통, 품기는 콩콩, 문지르기는 뗄 때 몸짓 없음', () => {
    expect(pokeReaction({ ...base, rest: 'start' })).toMatchObject({
      move: MOVES.tuck,
      bits: null,
      line: 'rest',
    });
    expect(pokeReaction({ ...base, rest: 'on' }).move).toBe(MOVES.bump);
    expect(pokeReaction({ ...base, kind: 'hold' })).toMatchObject({
      move: MOVES.hop,
      line: 'hold',
    });
    expect(pokeReaction({ ...base, kind: 'rub' })).toMatchObject({ move: null, line: 'rub' });
  });

  it('모든 반응의 몸짓이 몸짓 규칙(정수·3칸·600ms·제자리)을 지킨다', () => {
    for (const kind of ['tap', 'hold', 'rub'] as const)
      for (let stage = 0; stage <= 4; stage += 1)
        for (let combo = 1; combo <= 10; combo += 1)
          for (const side of [-1, 0, 1] as const)
            for (const rest of [null, 'start', 'on'] as const) {
              const r = pokeReaction({ ...base, kind, stage, combo, side, rest });
              if (r.move) expectFairMove(r.move, `${kind}/${stage}/${combo}/${side}/${rest}`);
              for (const mark of r.knock)
                expect(mark.at, 'knock').toBeLessThan(moveDuration(r.move ?? []));
            }
  });

  it('메아리: 금이 길어진 알(2단계~)에서 두세 번 누른 묶음만, 쉬었으면 하지 않는다', () => {
    const b = { count: 2, combo: 2, kind: 'tap' as const, rested: false };
    expect(echoCount(b, 1)).toBeNull();
    expect(echoCount(b, 2)).toBe(2);
    expect(echoCount({ ...b, count: 3 }, 4)).toBe(3);
    expect(echoCount({ ...b, count: 1 }, 3)).toBeNull();
    expect(echoCount({ ...b, count: 4 }, 3)).toBeNull();
    expect(echoCount({ ...b, rested: true }, 3)).toBeNull();
    expect(echoCount({ ...b, kind: 'hold' }, 3)).toBeNull();
  });
});

describe('글', () => {
  const KEYS: PokeLineKey[] = [
    'tap0',
    'tap1',
    'tap2',
    'tap3',
    'tap4',
    'few',
    'hop',
    'many',
    'readyMany',
    'rest',
    'hold',
    'rub',
    'echo',
  ];

  it('모든 글 키에 문장(둘 이상)과 소리 글자가 있고, 금 단계는 다섯이다', () => {
    expect(TALK.egg.poke.tap).toHaveLength(5);
    expect(TALK.egg.poke.sfx.tap).toHaveLength(5);
    for (const key of KEYS) {
      expect(pokeLines(key).length, key).toBeGreaterThanOrEqual(2);
      expect(pokeSfx(key).length, key).toBeGreaterThan(0);
    }
    expect(TALK.egg.poke.label).toBe('호봉이 알 콕 누르기');
  });

  it('움직임 줄이기(알이 멈춰 있다)의 글·소리 글자는 몸짓을 말하지 않는다', () => {
    const MOTION = /튀|뛰|뒤척|꼼지락|폴짝|웅크|들썩|두리번|부르르|화들짝|깜빡|흔들|데굴|콩/;
    for (const key of KEYS) {
      const lines = pokeLines(key, true);
      expect(lines.length, key).toBeGreaterThanOrEqual(2);
      for (const line of lines) expect(line, key).not.toMatch(MOTION);
      expect(pokeSfx(key, true), key).not.toMatch(MOTION);
      expect(pokeSfx(key, true).length, key).toBeGreaterThan(0);
      for (let turn = 0; turn < 4; turn += 1)
        expect(lines).toContain(pickPokeLine(key, turn, null, true));
    }
    // 몸짓을 말하는 보통 글은 줄이기에서 쓰지 않는다
    expect(pokeLines('hop', true)).not.toEqual(pokeLines('hop'));
    expect(pokeLines('tap0', true)).not.toEqual(pokeLines('tap0'));
  });

  it('보통 글은 그 손길의 몸짓과 맞는다(폴짝은 폴짝일 때만)', () => {
    for (const key of KEYS)
      if (key !== 'hop') for (const line of pokeLines(key)) expect(line, key).not.toMatch(/폴짝/);
    expect(pokeSfx('hop')).toBe('폴짝!');
    expect(pokeSfx('many')).not.toMatch(/폴짝/);
  });

  it('차례로 골라도 같은 문장이 이어 나오지 않는다(무작위 없음)', () => {
    for (const key of KEYS) {
      let last: string | null = null;
      for (let turn = 0; turn < 10; turn += 1) {
        const line = pickPokeLine(key, turn, last);
        expect(line, key).not.toBe(last);
        last = line;
      }
    }
    // 다른 키를 사이에 두어도 앞 문장과 같으면 건너뛴다
    const first = pickPokeLine('tap0', 0, null);
    expect(pickPokeLine('tap0', 3, first)).not.toBe(first);
    expect(pickPokeLine('tap0', 7, 'x')).toBe(pickPokeLine('tap0', 7, 'x'));
  });
});
