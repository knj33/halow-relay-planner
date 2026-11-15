import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { cloudflare } from "@cloudflare/vite-plugin";

/**
 * Dev server only: stop React's development build from calling `console.createTask` for every
 * element. That call links async stack traces in DevTools and costs more than the whole render
 * of the survey map (about 1.4 s of 1.9 s per three map redraws at 6× CPU throttle with DevTools
 * open). Owner stacks in React's error messages still work. Production builds never use it.
 * To get the DevTools async stacks back: localStorage.setItem('halow.devStacks', '1'), then reload.
 * See docs/PERFORMANCE.md.
 */
function fastDevReact(): Plugin {
  return {
    name: 'halow-fast-dev-react',
    apply: 'serve',
    transformIndexHtml: () => [
      {
        tag: 'script',
        injectTo: 'head-prepend',
        children: "try{if(localStorage.getItem('halow.devStacks')!=='1')console.createTask=undefined}catch(e){console.createTask=undefined}",
      },
    ],
  };
}

export default defineConfig({
  plugins: [fastDevReact(), react(), cloudflare()],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});