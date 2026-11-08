import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const ENGINE_PORT = Number(process.env.PLICO_PORT ?? 7317);

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${ENGINE_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
