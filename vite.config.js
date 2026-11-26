import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) return 'vendor-discord';
          if (id.includes('/client/draw-') || id.includes('\\client\\draw-') || id.includes('/client/renderer.js') || id.includes('\\client\\renderer.js') || id.includes('/client/skins.js') || id.includes('\\client\\skins.js') || id.includes('/client/taunts.js') || id.includes('\\client\\taunts.js') || id.includes('/client/signatures.js') || id.includes('\\client\\signatures.js') || id.includes('/client/scene.js') || id.includes('\\client\\scene.js')) {
            return 'board-engine';
          }
          if (id.includes('/client/shop-ui.js') || id.includes('\\client\\shop-ui.js') || id.includes('/client/item-view.js') || id.includes('\\client\\item-view.js') || id.includes('/client/coin-store.js') || id.includes('\\client\\coin-store.js') || id.includes('/client/demo.js') || id.includes('\\client\\demo.js')) {
            return 'shop-ui';
          }
          if (id.includes('/client/audio.js') || id.includes('\\client\\audio.js')) return 'audio';
        },
      },
    },
  },
});
