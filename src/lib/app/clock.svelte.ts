/**
 * 시계. 초 단위로 가는 now와, 날짜가 바뀔 때만 바뀌는 today를 따로 둔다.
 * (대부분의 화면은 today에만 의존하므로 매초 다시 계산하지 않는다)
 */
import { todayYmd } from '../calc/date.ts';

class Clock {
  now = $state(new Date());
  today = $derived(todayYmd(this.now));
  /** 분이 바뀔 때만 달라지는 값(기분·한마디처럼 분 단위면 충분한 계산용) */
  minute = $derived(Math.floor(this.now.getTime() / 60_000));

  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;

  start(): void {
    if (this.#started) return;
    this.#started = true;
    const tick = () => {
      this.now = new Date();
      // 다음 초 경계에 맞춰 깨어난다(밀리는 것을 막는다).
      this.#timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 2);
    };
    tick();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.now = new Date();
    });
  }

  stop(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#started = false;
  }
}

export const clock = new Clock();
