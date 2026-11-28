/**
 * 화면이 쓰는 입구: 모습(Look) → 복셀 모형(캐시) → 메시.
 *
 *   const key = voxelKey(look)                    같은 그림이면 같은 키(기분·호봉이 달라도 그려지는 것이 같으면 같다)
 *   cachedModel(key)                              이미 만든 모형(없으면 null)
 *   const job = modelJob(look, (m) => …)          프레임마다 한 단계씩(fx/core 의 wake(job) 에 그대로 올린다)
 *   buildModel(look)                              한 번에(테스트·점검용)
 *   meshOf(model)                                 그릴 메시(마지막 하나만 들고 있는다)
 *
 * 모형(복셀 바이트, 3만 바이트 안팎)은 32개까지 기억하고, 메시(1MB 남짓)는 마지막 하나만 기억한다.
 */
import type { Look } from '../look.ts';
import { voxelInput, voxelKey } from './from-look.ts';
import { generateSteps, STEP_COUNT, type VoxelResult } from './generate.ts';
import { buildMesh, type VoxelMesh } from './mesh.ts';

export { voxelKey, STEP_COUNT };

export interface VoxelModel {
  key: string;
  res: VoxelResult;
  /** 같은 모습의 2D 그림(48×48, 0° 와 견줄 때) */
  ref: Uint8Array;
  /** 만드는 데 든 시간(ms, 단계 합) */
  genMs: number;
}

const LIMIT = 32;
const cache = new Map<string, VoxelModel>();
let lastMesh: { model: VoxelModel; mesh: VoxelMesh } | null = null;

function remember(m: VoxelModel) {
  cache.delete(m.key);
  cache.set(m.key, m);
  while (cache.size > LIMIT) {
    const first = cache.keys().next();
    if (first.done) break;
    cache.delete(first.value);
  }
}

export function cachedModel(key: string): VoxelModel | null {
  const m = cache.get(key);
  if (!m) return null;
  remember(m); // 최근에 쓴 것을 뒤로
  return m;
}

/** 캐시를 비운다(테스트용) */
export function clearModels(): void {
  cache.clear();
  lastMesh = null;
}

/**
 * 프레임마다 한 단계씩 만드는 일. 돌려준 함수를 부를 때마다 한 단계(가장 긴 단계도 수십 ms 안)를 하고,
 * 더 할 일이 있으면 true, 끝났으면 done(모형 또는 null — 몸통 그림이 없을 때)을 부르고 false.
 * 캐시에 있으면 첫 호출에 바로 끝난다. cancel() 하면 다음 호출에서 아무것도 하지 않고 false.
 */
export function modelJob(
  look: Look,
  done: (m: VoxelModel | null) => void,
): { (): boolean; cancel(): void } {
  const key = voxelKey(look);
  let it: Generator<unknown, VoxelResult, void> | null = null;
  let ref: Uint8Array | null = null;
  let ms = 0;
  let over = false;
  const run = () => {
    if (over) return false;
    const hit = cachedModel(key);
    if (hit) {
      over = true;
      done(hit);
      return false;
    }
    const t0 = performance.now();
    if (!it) {
      const input = voxelInput(look);
      if (!input) {
        over = true;
        done(null);
        return false;
      }
      ref = input.ref;
      it = generateSteps(input);
    }
    const r = it.next();
    ms += performance.now() - t0;
    if (!r.done) return true;
    over = true;
    const m: VoxelModel = { key, res: r.value, ref: ref as Uint8Array, genMs: ms };
    remember(m);
    done(m);
    return false;
  };
  run.cancel = () => {
    over = true;
  };
  return run;
}

/** 한 번에 만든다(캐시를 쓴다) */
export function buildModel(look: Look): VoxelModel | null {
  let out: VoxelModel | null = null;
  const job = modelJob(look, (m) => {
    out = m;
  });
  while (job());
  return out;
}

/** 모형의 메시(마지막으로 부른 모형 하나만 기억한다) */
export function meshOf(model: VoxelModel): VoxelMesh {
  if (lastMesh?.model !== model)
    lastMesh = { model, mesh: buildMesh(model.res.bytes, model.res.meta.zoff) };
  return lastMesh.mesh;
}
