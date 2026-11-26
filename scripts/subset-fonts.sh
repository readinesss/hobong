#!/usr/bin/env bash
# 픽셀 폰트 서브셋 만들기 (결과물은 저장소에 커밋돼 있으므로 폰트를 바꿀 때만 실행한다).
#
#   준비: pip install fonttools brotli
#   실행: bash scripts/subset-fonts.sh
#
# 원본: Galmuri (https://github.com/quiple/galmuri) — SIL Open Font License 1.1
#   Galmuri14: 15px 격자. 본문·숫자용. 현대 한글 11,172자 전부(닉네임·메모에 어떤 글자든 쓸 수 있게).
#   Galmuri11: 12px 격자. 작은 설명 글자용. KS X 1001 한글 2,350자(없는 글자는 Galmuri14로 대체된다).
# 한자·가나 등은 뺀다. 번들에 포함하기 위한 용량 조정이며 글자 모양은 바꾸지 않는다.
set -euo pipefail

VERSION="2.40.3"
OUT="$(cd "$(dirname "$0")/.." && pwd)/src/assets/fonts"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
npm pack "galmuri@${VERSION}" --silent >/dev/null
tar xzf "galmuri-${VERSION}.tgz"

# 공통: 라틴, 문장부호, 화살표, 수학기호, 원문자, 선·블록·도형, 기호, 한글 자모, 전각 문자
COMMON="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+2190-21FF,U+2200-22FF,U+2460-24FF,U+2500-257F,U+2580-259F,U+25A0-25FF,U+2600-26FF,U+2700-27BF,U+3000-303F,U+3130-318F,U+3200-32FF,U+FF00-FFEF"

# KS X 1001 한글 2,350자
python3 - <<'PY'
chars = []
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try:
            chars.append(bytes([hi, lo]).decode("euc-kr"))
        except UnicodeDecodeError:
            pass
assert len(chars) == 2350, len(chars)
open("ksx1001.txt", "w", encoding="utf-8").write("".join(chars))
PY

pyftsubset package/dist/Galmuri14.ttf --unicodes="${COMMON},U+AC00-D7A3" \
  --flavor=woff2 --layout-features='*' --no-hinting --output-file="${OUT}/Galmuri14.subset.woff2"
pyftsubset package/dist/Galmuri11.ttf --unicodes="${COMMON}" --text-file=ksx1001.txt \
  --flavor=woff2 --layout-features='*' --no-hinting --output-file="${OUT}/Galmuri11.subset.woff2"

# WOFF2 의 glyf/loca 변환(transform)은 빼고 저장한다. 변환된 큰 글꼴을 WebKit(Safari 엔진)이
# 해독하지 못하는 경우가 있어서다(CI 의 WebKit 에서 확인: 변환한 것은 SyntaxError, 뺀 것은 정상).
# 글자 모양은 그대로이고 파일만 조금 커진다.
python3 - "${OUT}/Galmuri14.subset.woff2" "${OUT}/Galmuri11.subset.woff2" <<'PY'
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.woff2 import WOFF2FlavorData
for path in sys.argv[1:]:
    font = TTFont(path)
    font.flavor = "woff2"
    font.flavorData = WOFF2FlavorData(transformedTables=set())
    font.save(path)
PY

cp package/dist/LICENSE.txt "${OUT}/OFL.txt"
ls -l "${OUT}"
