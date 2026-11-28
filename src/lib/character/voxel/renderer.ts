/**
 * 복셀 렌더러(WebGL1, 외부 라이브러리 없음). 복셀 모듈에서 DOM(WebGL 캔버스)을 쓰는 것은 이 파일뿐이다.
 *   N×N 프레임버퍼에 복셀 1칸 = 1px 로 그리고(색 / 깊이·묶음 두 패스), 합성 셰이더가 외곽선·얼굴 도장·그림자를 얹어 정수배 S 로 확대한다.
 *   명암 2단: 본색 / 그늘색(경계 한 줄만 2×2 바둑판). 가장 어두운 색은 그늘 대신 빛 받는 쪽에 한 단계 밝은 색 — 모두 팔레트(Sweetie 16) 안.
 */
import { placeStamps, TILE, MAX_STAMPS, type Mat3, type StampPlace } from './face.ts';
import type { VoxelMesh } from './mesh.ts';
import type { VoxelMeta } from './generate.ts';

export const VIEW = {
  /** 프레임버퍼 한 변(복셀 칸) */
  fb: 64,
  scale: 3,
  pitch: 15,
  pitchReduced: 10,
  pivotY: 24,
  shadowColor: 15,
  // 빛은 화면 기준 왼쪽 위 앞. 그늘은 오른쪽 아래로 도는 면에만 초승달 하나로 진다
  light: [-0.42, 0.66, 0.62] as readonly [number, number, number],
  shadeAt: -0.2,
  highAt: 0.8,
  /** 자동 회전: 1초에 autoFps 번, 한 바퀴를 autoSteps 칸으로 */
  autoFps: 8,
  autoSteps: 48,
};
export type ViewConfig = typeof VIEW;

/**
 * 내려다보는 각도: 정면(0°)은 수평(2D 와 같은 그림)이고 돌릴수록 pitch 까지 부드럽게 올라간다 — pitch × sin²(yaw/2).
 * 움직임 줄이기: 정면 0°, 그 밖은 pitchReduced 의 2단.
 */
export function pitchAt(yawDeg: number, reduced = false, view: ViewConfig = VIEW): number {
  const y = ((yawDeg % 360) + 360) % 360;
  if (reduced) return y < 0.5 || y > 359.5 ? 0 : view.pitchReduced;
  const s = Math.sin((y * Math.PI) / 360);
  return view.pitch * s * s;
}

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCG;
uniform mat4 uM; uniform mat3 uN;
varying vec3 vN; varying vec3 vCG; varying float vZ;
void main(){
  vec4 p = uM * vec4(aPos, 1.0);
  gl_Position = p; vZ = p.z;
  vN = uN * aNrm;
  vCG = aCG;
}`;
// 명암 단(0 빛 받는 쪽 · 1 본색 · 2 그늘): 경계는 딱 끊고, 바둑판 디더는 합성 단계가 경계 한 줄에만 넣는다
const BAND = `
uniform vec3 uL; uniform vec3 uBand;
float bandOf(vec3 n, float flags){
  float d = dot(normalize(n), uL);
  bool lit = mod(floor((flags + 0.5) / 2.0), 2.0) > 0.5;
  if (d > uBand.z) return 0.0;
  if (d < uBand.x && !lit) return 2.0;
  return 1.0;
}`;
const FS_COLOR = `
precision mediump float;
uniform sampler2D uRamp;
varying vec3 vN; varying vec3 vCG;
${BAND}
void main(){
  float band = bandOf(vN, vCG.z);
  gl_FragColor = vec4(texture2D(uRamp, vec2((floor(vCG.x + 0.5) + 0.5) / 16.0, (band + 0.5) / 4.0)).rgb, 1.0);
}`;
const FS_DATA = `
precision highp float;
varying vec3 vN; varying vec3 vCG; varying float vZ;
${BAND}
void main(){
  float z = clamp(vZ * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
  float hi = floor(z / 256.0); float lo = z - hi * 256.0;
  // 묶음·색 번호는 정수 그대로 바이트에 담는다. 알파 = 색 번호 + 16 × 살갗(얼굴 도장을 찍어도 되는 칸) + 32 × 명암 단
  float skin = mod(floor(vCG.z + 0.5), 2.0);
  gl_FragColor = vec4(hi / 255.0, lo / 255.0, floor(vCG.y + 0.5) / 255.0, (floor(vCG.x + 0.5) + 16.0 * skin + 32.0 * bandOf(vN, vCG.z)) / 255.0);
}`;
const VS_QUAD = `attribute vec2 aP; void main(){ gl_Position = vec4(aP, 0.0, 1.0); }`;
const FS_COMP = `
precision highp float;
uniform sampler2D uC; uniform sampler2D uD; uniform sampler2D uRamp; uniform sampler2D uFace;
uniform vec2 uN; uniform float uS; uniform vec3 uShadow; uniform float uShadowY; uniform vec3 uShadowC; uniform float uZScale; uniform vec4 uOutline;
uniform vec4 uStamp[${MAX_STAMPS}]; uniform vec2 uStampT[${MAX_STAMPS}]; uniform vec2 uFaceN; uniform vec2 uBody;
float depthAt(vec4 d){ return (d.r * 255.0 * 256.0 + d.g * 255.0) / 65535.0 * uZScale; }
float grp(vec4 d){ return floor(d.b * 255.0 + 0.5); }
vec4 C(vec2 t){ return texture2D(uC, (t + 0.5) / uN); }
vec4 Dd(vec2 t){ return texture2D(uD, (t + 0.5) / uN); }
bool inside(vec2 t){ return t.x >= 0.0 && t.y >= 0.0 && t.x < uN.x && t.y < uN.y; }
void main(){
  vec2 t = floor(gl_FragCoord.xy / uS);
  vec4 c = C(t);
  vec4 d = Dd(t);
  vec2 off[4]; off[0] = vec2(1.0,0.0); off[1] = vec2(-1.0,0.0); off[2] = vec2(0.0,1.0); off[3] = vec2(0.0,-1.0);
  if (c.a < 0.5) {
    // 바깥 외곽선(복셀 실루엣 바로 바깥 1칸). 100~109 묶음은 검정 대신 그 색의 그늘색, 110 이상은 외곽선 없음
    bool thin = false; vec3 thinC = vec3(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 q = t + off[i];
      if (!inside(q) || C(q).a < 0.5) continue;
      vec4 dq = Dd(q); float gq = mod(grp(dq), 128.0);
      if (gq < 100.0) { gl_FragColor = uOutline; return; }
      if (gq < 110.0 && !thin) { thin = true; thinC = texture2D(uRamp, vec2((mod(floor(dq.a * 255.0 + 0.5), 16.0) + 0.5) / 16.0, 2.5 / 4.0)).rgb; }
    }
    if (thin) { gl_FragColor = vec4(thinC, 1.0); return; }
    vec2 e = (t + 0.5 - uShadow.xy) / vec2(uShadow.z, uShadow.z * uShadowY);
    if (uShadow.z > 0.0 && dot(e, e) <= 1.0) { gl_FragColor = vec4(uShadowC, 1.0); return; }
    gl_FragColor = vec4(0.0); return;
  }
  float z = depthAt(d); float g = grp(d);
  float gid = mod(g, 128.0); bool soft = g >= 128.0;
  float ai = floor(d.a * 255.0 + 0.5); float ci = mod(ai, 16.0); bool skin = mod(ai, 32.0) >= 15.5; float band = floor(ai / 32.0);
  float dark = band;
  bool softLine = false;
  for (int i = 0; i < 4; i++) {
    vec2 q = t + off[i];
    if (!inside(q) || C(q).a < 0.5) continue;
    vec4 dq = Dd(q);
    float zq = depthAt(dq); float gq = grp(dq); float gidq = mod(gq, 128.0);
    // 명암 경계: 같은 묶음·같은 색의 이웃이 더 어두운 단이면 기억해 둔다(아래에서 바둑판 칸만 그 단으로)
    float aq = floor(dq.a * 255.0 + 0.5);
    if (gq == g && abs(mod(aq, 16.0) - ci) < 0.5 && abs(zq - z) < 2.5) dark = max(dark, floor(aq / 32.0));
    if (gid >= 100.0 || gidq >= 100.0) continue;
    bool line = false; bool hard = true;
    if (gidq != gid) {
      // 묶음 경계: 더 먼 쪽(같으면 번호 작은 쪽)에 선
      if (zq < z - 0.3 || (abs(zq - z) <= 0.3 && gidq > gid)) { line = true; hard = !(soft && gq >= 128.0); }
    } else if (zq < z - (soft ? 6.5 : 3.5)) { line = true; hard = !soft; } // 몸(부드러운 묶음)은 더 큰 단차에서만: 내려다본 정수리 가장자리에 줄이 서지 않게
    if (line) {
      if (hard) { gl_FragColor = uOutline; return; }
      softLine = true;
    }
  }
  if (skin) {
    // 얼굴 도장(눈·안경·볼): 살갗 칸에만, 도장 자리의 깊이와 가까운 칸에만
    vec2 T = vec2(t.x, uN.y - 1.0 - t.y);
    for (int i = 0; i < ${MAX_STAMPS}; i++) {
      if (uStamp[i].w < 0.5) continue;
      vec2 q = T - uStamp[i].xy;
      if (q.x < 0.0 || q.y < 0.0 || q.x >= ${TILE}.0 || q.y >= ${TILE}.0) continue;
      if (abs(z - uStamp[i].z) > 7.0) continue;
      vec4 s = texture2D(uFace, (uStampT[i] + q + 0.5) / uFaceN);
      if (s.a > 0.5) { gl_FragColor = vec4(s.rgb, 1.0); return; }
    }
  }
  // 외톨이 선 칸: 먹색 복셀인데 8방 이웃에 먹색·빈 칸·다른 묶음이 하나도 없으면(돌려서 외곽선과 떨어진 선 끝) 옆 칸 색으로 메운다.
  // 정면에서는 2D 의 선이 늘 외곽선(빈 칸)이나 다른 묶음과 닿아 있어 그대로 남는다
  if (ci < 0.5 && gid < 100.0) {
    bool lone = true;
    for (int j = 0; j < 9; j++) {
      if (j == 4) continue;
      vec2 q = t + vec2(mod(float(j), 3.0) - 1.0, floor(float(j) / 3.0) - 1.0);
      if (!inside(q) || C(q).a < 0.5) { lone = false; break; }
      vec4 dq = Dd(q);
      float gq = grp(dq);
      if (mod(floor(dq.a * 255.0 + 0.5), 16.0) < 0.5 || (gq != g && !(soft && gq >= 128.0))) { lone = false; break; }
    }
    if (lone) { gl_FragColor = vec4(C(t + off[1]).rgb, 1.0); return; }
  }
  // 부드러운 선(팔과 몸 사이 주름): 몸 바탕색 칸만 그늘색으로. 줄무늬·그늘 칸은 그대로 둔다(더 어두운 색으로 내려가지 않게)
  if (softLine && abs(ci - uBody.x) < 0.5) { gl_FragColor = vec4(texture2D(uRamp, vec2((uBody.y + 0.5) / 16.0, 1.5 / 4.0)).rgb, 1.0); return; }
  if (dark > band && mod(t.x + t.y, 2.0) < 0.5) { gl_FragColor = vec4(texture2D(uRamp, vec2((ci + 0.5) / 16.0, (dark + 0.5) / 4.0)).rgb, 1.0); return; }
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

/** 한 단계 밝은 색(가장 어두운 색의 하이라이트). 없으면 본색 */
export const LIGHTER: Readonly<Record<number, number>> = { 1: 2, 8: 9, 15: 14 };

export interface DrawOptions {
  /** 몸만 위로 띄우는 칸 수(떠 있는 봉황의 둥실거림, 그림자는 그대로) */
  lift?: number;
  /** false: 그림자 없이 */
  shadow?: boolean;
  /** 그림자를 이 색(팔레트 번호)으로. 어두운 무대에서 그림자가 묻히지 않게(야근 모드) */
  shadowInk?: number;
  /** 움직임 줄이기: 내려다보는 각을 2단으로 */
  reduced?: boolean;
  /** false: 얼굴 도장 없이(점검용) */
  face?: boolean;
}
export interface DrawInfo {
  stamps: (StampPlace | null)[];
  pitch: number;
}

export interface VoxelRenderer {
  gl: WebGLRenderingContext;
  /** 프레임버퍼 한 변(복셀 칸) · 확대 배율 */
  N: number;
  S: number;
  setModel(mesh: VoxelMesh | null, meta: VoxelMeta | null): void;
  /** pitchDeg 를 비우면 pitchAt(yaw) */
  draw(yawDeg: number, pitchDeg?: number, opt?: DrawOptions): DrawInfo;
  /** 점검: 마지막으로 그린 깊이·묶음 버퍼(N×N, 위가 첫 행). [깊이(복셀), 묶음, 색 번호, 살갗, 명암 단] */
  readData(): number[][][];
  /**
   * 파이프라인 데우기: 그린 뒤 1px 을 읽어 GPU 가 실제로 그리게 한다. 소프트웨어 GL(SwiftShader)은 합성 셰이더를
   * 처음 실행할 때 수백 ms 걸리므로, 아직 2D 그림이 보이는 동안 한 번 불러 그 멈춤을 입체가 처음 보이는 순간에서 떼어 낸다
   */
  warm(): void;
  /** GPU 자원을 놓는다(대화상자를 닫을 때) */
  dispose(): void;
}

export type RendererResult = { ok: true; renderer: VoxelRenderer } | { ok: false; reason: string };

/** WebGL 을 못 쓸 때 화면에 한 줄로 알릴 말 */
export const NO_WEBGL = '이 브라우저에서는 입체로 그릴 수 없어 그림으로 보여 드려요.';

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * 캔버스에 렌더러를 붙인다. 캔버스 크기는 부르는 쪽이 정한다(fb × scale 의 정수배).
 * WebGL1 이 없거나 셰이더가 안 되면 { ok: false, reason } — 화면은 2D 그림 그대로 두고 reason 을 한 줄로 알린다.
 */
export function makeRenderer(
  canvas: HTMLCanvasElement,
  {
    palette,
    ramp,
    view = VIEW,
    scale = view.scale,
    preserve = false,
  }: {
    palette: readonly string[];
    ramp: readonly number[];
    view?: ViewConfig;
    scale?: number;
    preserve?: boolean;
  },
): RendererResult {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: preserve,
      antialias: false,
    });
  } catch {
    gl = null;
  }
  if (!gl) return { ok: false, reason: NO_WEBGL };
  try {
    return { ok: true, renderer: build(gl, canvas, palette, ramp, view, scale) };
  } catch {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { ok: false, reason: NO_WEBGL };
  }
}

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function build(
  gl: WebGLRenderingContext,
  canvas: HTMLCanvasElement,
  palette: readonly string[],
  ramp: readonly number[],
  view: ViewConfig,
  S: number,
): VoxelRenderer {
  const N = view.fb;
  const PAL = palette.map(hexRgb);
  const pal = (i: number) => PAL[i] ?? [0, 0, 0];
  const need = <T>(v: T | null, what: string): T => {
    if (v === null) throw new Error(what);
    return v;
  };
  const sh = (type: number, src: string) => {
    const s = need(gl.createShader(type), 'shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = (vs: string, fs: string): Program => {
    const p = need(gl.createProgram(), 'program');
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      if (info) u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  };
  const pColor = prog(VS, FS_COLOR),
    pData = prog(VS, FS_DATA),
    pComp = prog(VS_QUAD, FS_COMP);
  const U = (pr: Program, name: string) => pr.u[name] ?? null;
  // 명암표: 0행 빛 받는 쪽(어두운 색만 한 단계 밝게), 1행 본색, 2행 그늘색
  const rampPx = new Uint8Array(16 * 4 * 4);
  for (let i = 0; i < 16; i++)
    for (let b = 0; b < 3; b++) {
      const c = pal(b === 0 ? (LIGHTER[i] ?? i) : b === 1 ? i : (ramp[i] ?? i));
      rampPx.set([c[0], c[1], c[2], 255], (b * 16 + i) * 4);
    }
  const tex = (w: number, h: number, data: Uint8Array | null) => {
    const t = need(gl.createTexture(), 'texture');
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const rampTex = tex(16, 4, rampPx);
  // 얼굴 도장 아틀라스: 도장 MAX_STAMPS 개(눈 둘 + 뒤통수 줄무늬 셋) × 타일 3벌(full·narrow·side)
  const FW = TILE * 3,
    FH = TILE * MAX_STAMPS;
  const facePx = new Uint8Array(FW * FH * 4);
  const faceTex = tex(FW, FH, facePx);
  const mkFbo = () => {
    const t = tex(N, N, null);
    const f = need(gl.createFramebuffer(), 'framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const rb = need(gl.createRenderbuffer(), 'renderbuffer');
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, N, N);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('framebuffer');
    return { f, t };
  };
  const fC = mkFbo(),
    fD = mkFbo();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const quad = need(gl.createBuffer(), 'buffer');
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  let mesh: VoxelMesh | null = null,
    meta: VoxelMeta | null = null;
  const bufs = {
    pos: need(gl.createBuffer(), 'buffer'),
    nrm: need(gl.createBuffer(), 'buffer'),
    cg: need(gl.createBuffer(), 'buffer'),
  };
  const ZR = 64;

  function setModel(m: VoxelMesh | null, mt: VoxelMeta | null) {
    mesh = m;
    meta = mt;
    if (m)
      for (const k of ['pos', 'nrm', 'cg'] as const) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]);
        gl.bufferData(gl.ARRAY_BUFFER, m[k], gl.STATIC_DRAW);
      }
    facePx.fill(0);
    (mt?.face.stamps ?? []).slice(0, MAX_STAMPS).forEach((s, row) => {
      [s.full, s.narrow, s.sideTile].forEach((tile, col) => {
        for (let r = 0; r < TILE; r++)
          for (let c = 0; c < TILE; c++) {
            const v = tile[r * TILE + c] as number;
            if (v === 255) continue;
            const p = pal(v);
            facePx.set([p[0], p[1], p[2], 255], ((row * TILE + r) * FW + col * TILE + c) * 4);
          }
      });
    });
    gl.bindTexture(gl.TEXTURE_2D, faceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FW, FH, 0, gl.RGBA, gl.UNSIGNED_BYTE, facePx);
  }
  function bindAttrs(p: WebGLProgram) {
    for (const [name, k] of [
      ['aPos', 'pos'],
      ['aNrm', 'nrm'],
      ['aCG', 'cg'],
    ] as const) {
      const loc = gl.getAttribLocation(p, name);
      if (loc < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs[k]);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    }
  }
  function draw(yawDeg: number, pitchArg?: number, opt: DrawOptions = {}): DrawInfo {
    const pitchDeg = pitchArg ?? pitchAt(yawDeg, opt.reduced, view);
    const pivotY = view.pivotY;
    const ya = (yawDeg * Math.PI) / 180,
      pa = (pitchDeg * Math.PI) / 180;
    const cy = Math.cos(ya),
      sy = Math.sin(ya),
      cp = Math.cos(pa),
      sp = Math.sin(pa);
    // 복셀(x 오른, y 아래, z 앞) → 화면: R = Rx(pitch)·Ry(yaw)·diag(1,−1,1)
    const r0 = [cy, 0, sy] as const,
      r1 = [sp * sy, -cp, -sp * cy] as const,
      r2 = [-cp * sy, -sp, cp * cy] as const;
    const R: Mat3 = [r0, r1, r2];
    const tx = -24,
      ty = -pivotY;
    const k = 2 / N,
      ky = k / cp; // 앞면 한 행이 화면 한 줄이 되게 세로를 1/cos(pitch) 늘린다
    const off = (row: readonly [number, number, number]) => row[0] * tx + row[1] * ty;
    // 내려다본 정도(0 정면 ~ 1 가장 높이): 떠 있는 몸은 그만큼 띄우고 그림자는 내린다
    const look = Math.min(1, Math.abs(pitchDeg) / view.pitch);
    const lift = (opt.lift ?? 0) + (meta?.shadowRise ?? 0) * look;
    const M = new Float32Array([
      r0[0] * k,
      r1[0] * ky,
      -r2[0] / ZR,
      0,
      r0[1] * k,
      r1[1] * ky,
      -r2[1] / ZR,
      0,
      r0[2] * k,
      r1[2] * ky,
      -r2[2] / ZR,
      0,
      off(r0) * k,
      off(r1) * ky + (lift * 2) / N,
      -off(r2) / ZR,
      1,
    ]);
    const Nm = new Float32Array([r0[0], r1[0], r2[0], r0[1], r1[1], r2[1], r0[2], r1[2], r2[2]]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    const L = view.light,
      l = Math.hypot(L[0], L[1], L[2]);
    for (const [fbo, pr] of [
      [fC, pColor],
      [fD, pData],
    ] as const) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.f);
      gl.viewport(0, 0, N, N);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!mesh) continue;
      gl.useProgram(pr.p);
      bindAttrs(pr.p);
      gl.uniformMatrix4fv(U(pr, 'uM'), false, M);
      gl.uniformMatrix3fv(U(pr, 'uN'), false, Nm);
      gl.uniform3f(U(pr, 'uL'), L[0] / l, L[1] / l, L[2] / l);
      gl.uniform3f(U(pr, 'uBand'), view.shadeAt, 0, view.highAt);
      if (pr === pColor) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rampTex);
        gl.uniform1i(U(pr, 'uRamp'), 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pComp.p);
    const loc = gl.getAttribLocation(pComp.p, 'aP');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const units: [WebGLTexture, string][] = [
      [fC.t, 'uC'],
      [fD.t, 'uD'],
      [rampTex, 'uRamp'],
      [faceTex, 'uFace'],
    ];
    units.forEach(([t, u], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(U(pComp, u), i);
    });
    gl.uniform2f(U(pComp, 'uN'), N, N);
    gl.uniform1f(U(pComp, 'uS'), S);
    gl.uniform1f(U(pComp, 'uZScale'), ZR * 2);
    gl.uniform2f(U(pComp, 'uFaceN'), FW, FH);
    gl.uniform2f(U(pComp, 'uBody'), meta?.base ?? 4, meta?.shade ?? 3);
    const st =
      opt.face === false
        ? []
        : placeStamps(meta?.face, R, yawDeg, { n: N, pivotY, zr: ZR, cp, lift });
    const sv = new Float32Array(MAX_STAMPS * 4),
      stt = new Float32Array(MAX_STAMPS * 2);
    for (let i = 0; i < MAX_STAMPS; i++) {
      const s = st[i];
      if (!s) continue;
      sv.set([s.ox, s.oy, s.depth, 1], i * 4);
      stt.set([s.tile * TILE, i * TILE], i * 2);
    }
    gl.uniform4fv(U(pComp, 'uStamp'), sv);
    gl.uniform2fv(U(pComp, 'uStampT'), stt);
    const o0 = pal(0);
    gl.uniform4f(U(pComp, 'uOutline'), o0[0] / 255, o0[1] / 255, o0[2] / 255, 1);
    // 그림자: 발밑 바닥(24, groundY, 0)의 화면 자리. 떠 있는 몸(봉황)은 내려다볼수록 조금 더 아래에
    const gy = (meta?.groundY ?? 45.5) - pivotY + (meta?.shadowDrop ?? 0) * look;
    const shadowR = opt.shadow !== false && meta ? meta.shadowR : 0;
    gl.uniform3f(U(pComp, 'uShadow'), N / 2, N / 2 - gy, shadowR); // gl_FragCoord 는 아래가 0
    gl.uniform1f(
      U(pComp, 'uShadowY'),
      Math.min(meta?.shadowFlat ?? 9, Math.max(meta?.shadowFlat0 ?? 0.16, sp / cp)),
    );
    const sc = pal(opt.shadowInk ?? view.shadowColor);
    gl.uniform3f(U(pComp, 'uShadowC'), sc[0] / 255, sc[1] / 255, sc[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return { stamps: st, pitch: pitchDeg };
  }
  function readData() {
    const buf = new Uint8Array(N * N * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fD.f);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out: number[][][] = [];
    for (let y = N - 1; y >= 0; y--) {
      const row: number[][] = [];
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        const a = buf[i + 3] as number;
        row.push([
          (((buf[i] as number) * 256 + (buf[i + 1] as number)) / 65535) * ZR * 2,
          buf[i + 2] as number,
          a & 15,
          (a >> 4) & 1,
          a >> 5,
        ]);
      }
      out.push(row);
    }
    return out;
  }
  function warm() {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
  function dispose() {
    mesh = null;
    meta = null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return { gl, N, S, setModel, draw, readData, warm, dispose };
}
