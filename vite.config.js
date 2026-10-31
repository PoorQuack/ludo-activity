import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
