import { defineConfig } from 'vite';

const gameServer = process.env.GAME_SERVER_URL || 'http://localhost:3001';
const legacyGen = process.env.LEGACY_GENERATOR_URL || 'http://localhost:8080';
const api = process.env.API_URL || 'http://localhost:8000';

export default defineConfig({
  publicDir: 'assets',
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/socket.io': { target: gameServer, ws: true },
      // Same as production (Caddy): /api is the FastAPI service, prefix stripped
      '/api/': { target: api, rewrite: path => path.replace(/^\/api/, '') },
      '/sprites/': { target: gameServer },
      '/spritesheets/': { target: legacyGen }
    }
  },
  build: {
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser']
        }
      }
    }
  }
});
