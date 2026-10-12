import { defineConfig } from 'vite';

const gameServer = process.env.GAME_SERVER_URL || 'http://localhost:3001';
const legacyGen = process.env.LEGACY_GENERATOR_URL || 'http://localhost:8080';

export default defineConfig({
  publicDir: 'assets',
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/socket.io': { target: gameServer, ws: true },
      '/api/': { target: gameServer },
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
