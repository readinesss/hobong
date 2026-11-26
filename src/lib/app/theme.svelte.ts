/** 지금 실제로 쓰는 밝기(설정과 기기 설정을 합친 값). App 이 정하고, 색을 직접 골라 그리는 곳(캔버스 등)이 읽는다. */
class Theme {
  dark = $state(false);
}

export const theme = new Theme();
