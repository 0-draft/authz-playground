import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  base: './',
  plugins: [react(), wasm()],
  optimizeDeps: {
    // cedar-wasm ships ESM plus a wasm binary; let Vite leave it alone.
    exclude: ['@cedar-policy/cedar-wasm'],
  },
  build: {
    target: 'es2022',
  },
  test: {
    // Node cannot fetch the wasm the way the browser build does, so the tests use
    // the package's nodejs binding, which initializes itself on import.
    alias: { '@cedar-policy/cedar-wasm/web': '@cedar-policy/cedar-wasm/nodejs' },
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 60_000,
  },
});
