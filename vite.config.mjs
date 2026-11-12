// Owns local frontend serving/builds; Rust output must not trigger frontend reloads.
import { defineConfig } from 'vite';
import { mcpPlugin } from './scripts/mcp.mjs';

export default defineConfig({
  plugins: [mcpPlugin()],
  publicDir: false,
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/benchmarks/**'] },
  },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
});

