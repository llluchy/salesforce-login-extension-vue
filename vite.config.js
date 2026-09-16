import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { resolve } from 'path'

export default defineConfig({
  base: '',
  // Chrome MV3 CSP 禁止 unsafe-eval；开启 JIT 避免 vue-i18n 使用 new Function
  define: {
    __INTLIFY_JIT_COMPILATION__: true
  },
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
    emptyOutDir: true
  },
  server: {
    port: 5175,
    strictPort: true,
    hmr: {
      port: 5175,
      host: 'localhost'
    },
    origin: 'http://localhost:5175'
  }
})