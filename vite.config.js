import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { resolve } from 'path'

export default defineConfig({
  base: '',
  plugins: [
    vue(),
    crx({ manifest })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'index.html'),
        'tool-window': resolve(__dirname, 'tool-window.html')
      }
    }
  },
  server: {
    port: 5175,
    strictPort: true, // 端口被占用则直接失败，绝不回退到 5173
    origin: 'http://localhost:5175',
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5175,
      clientPort: 5175
    }
  }
})
