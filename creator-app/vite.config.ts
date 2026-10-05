import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
