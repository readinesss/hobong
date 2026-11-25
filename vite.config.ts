import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// 업무망 PC의 구형 Chromium 계열(Edge/Chrome)과 iOS Safari, 삼성 인터넷을 고려한 빌드 타깃.
// 문법은 이 버전에 맞춰 낮춘다. 화면이 온전하려면 Svelte가 쓰는 :where() 선택자(Chrome·Edge 88,
// Firefox 78, Safari 14)와 flex gap(Safari 14.1)이 필요하므로 이보다 낮출 수는 없다.
const BROWSER_TARGETS = ['chrome88', 'edge88', 'firefox78', 'safari14'];

export default defineConfig({
  // 단일 HTML은 어느 경로·file:// 에서든 열리므로 상대 경로 기준으로 빌드한다.
  base: './',
  plugins: [
    svelte(),
    // JS·CSS·폰트를 모두 index.html 하나에 인라인한다(외부 요청 0건, 내부망 반입용).
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: BROWSER_TARGETS,
    cssTarget: BROWSER_TARGETS,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
  },
});
