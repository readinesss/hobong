/**
 * 금액 × 비율을 부동소수점 오차 없이 계산한다.
 *
 * 0.35 같은 비율을 그대로 곱하면 2,624,400 × 0.35 가 918,539.999… 가 되어
 * 원 미만을 버릴 때 1원이 사라진다. 비율을 천분율 정수로 바꿔 정수끼리 곱하고 나눈다.
 * (규정의 비율은 4.1%처럼 0.1% 단위까지다. 금액은 천만 원대라 곱해도 정밀도 안에 든다.)
 */
export function perMille(rate: number): number {
  return Math.round(rate * 1000);
}

/** floor(amount × rate × times ÷ over). 원 미만 버림 */
export function floorRate(amount: number, rate: number, times = 1, over = 1): number {
  return Math.floor((amount * perMille(rate) * times) / (1000 * over));
}
