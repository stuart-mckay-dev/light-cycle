import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  build: {
    // Vite 8 bundles with rolldown rather than rollup; `rollupOptions` and the
    // object form of `manualChunks` are both deprecated in favour of these.
    rolldownOptions: {
      output: {
        // mapbox-gl is ~1.8 MB and changes only when we bump it. Splitting it
        // out means the 5-minute autodeploy cycle re-downloads app code only,
        // which matters when testers are on cellular.
        codeSplitting: {
          groups: [{ name: 'mapbox', test: /[\\/]node_modules[\\/]mapbox-gl[\\/]/ }],
        },
      },
    },
    // Above the known mapbox-gl chunk, so the warning only fires on a real
    // regression rather than on the dependency we already decided to ship.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    // Expose on the LAN so a phone on the same wifi can reach the dev server.
    host: true,
    port: 5173,
    fs: {
      // The `shared/` package lives outside the client root.
      allow: ['..'],
    },
  },
});
