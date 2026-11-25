/**
 * 대기 애니메이션의 공통 박자(250ms). 화면에 보이는 스프라이트가 함께 쓴다.
 * 화면이 가려지거나 "움직임 줄이기"가 켜져 있으면 멈춘다.
 */
class Anim {
  tick = $state(0);
  reduced = $state(false);
  #timer: ReturnType<typeof setInterval> | null = null;
  #users = 0;
  #listening = false;

  /** 스프라이트가 화면에 붙을 때 부른다. 돌려받은 함수를 뗄 때 부른다 */
  use(): () => void {
    this.#users += 1;
    this.#sync();
    if (!this.#listening && typeof document !== 'undefined') {
      this.#listening = true;
      document.addEventListener('visibilitychange', () => this.#sync());
    }
    return () => {
      this.#users = Math.max(0, this.#users - 1);
      this.#sync();
    };
  }

  setReduced(value: boolean): void {
    this.reduced = value;
    if (value) this.tick = 0;
    this.#sync();
  }

  #sync(): void {
    const run = this.#users > 0 && !this.reduced && !(typeof document !== 'undefined' && document.hidden);
    if (run && this.#timer === null) {
      this.#timer = setInterval(() => {
        this.tick += 1;
      }, 250);
    } else if (!run && this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}

export const anim = new Anim();
