import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * 供应商分包规则（顺序即优先级）。
 *
 * 只给「首屏一定会用到、且长期不变」的库命名 chunk，其余 node_modules 一律返回
 * undefined 交给 Rollup 按引用关系自动落位 —— 这样 recharts 及其依赖
 * （victory-vendor / d3-* / react-redux / immer / es-toolkit / decimal.js-light …）
 * 只会待在 /analytics 图表模块自己的 async chunk 里，绝不会被首屏那条
 * modulepreload 链拉下来预加载。
 */
const VENDOR_CHUNKS: [RegExp, string][] = [
  [/node_modules\/(react-router-dom|react-router|react-dom|react|scheduler)\//, 'vendor-react'],
  [/node_modules\/dexie\//, 'vendor-db'],
  [/node_modules\/(zustand|clsx|tailwind-merge|class-variance-authority)\//, 'vendor-utils'],
]

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 兼容基线 ES2020（Chrome 87+ / Edge 88+ / Firefox 78+ / Safari 14+）
    target: 'es2020',
    // CSS 单独定基线：cssTarget 默认跟随 build.target，跟着 es2020 一起降级会把
    // Tailwind v4 的现代语法（嵌套 / :where / @property）展开成旧写法，
    // 实测 CSS 从 45.4 kB 涨到 48.3 kB（gzip +0.21 kB），而 Tailwind v4 本身
    // 就要求 Chrome 111+ / Safari 16.4+，降到 es2020 换不来任何真实兼容性。
    cssTarget: 'chrome111',
    // 线上不发 sourcemap：省掉 ~1MB 的 .map 请求，源码映射留在本地调试用
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replace(/\\/g, '/')
          if (!path.includes('/node_modules/')) return
          for (const [pattern, chunk] of VENDOR_CHUNKS) {
            if (pattern.test(path)) return chunk
          }
          return
        },
      },
    },
  },
  server: {
    // 允许通过 Cloudflare Tunnel 访问（默认只放行 localhost 和 IP）
    allowedHosts: ['creator.creator-app.xyz', '.creator-app.xyz', '.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
