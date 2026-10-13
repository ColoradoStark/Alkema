import { defineConfig } from 'vite';

const gameServer = process.env.GAME_SERVER_URL || 'http://localhost:3001';
const legacyGen = process.env.LEGACY_GENERATOR_URL || 'http://localhost:8080';
const api = process.env.API_URL || 'http://localhost:8000';

// The About / Contact / Terms / Privacy pages live in assets/<page>/index.html.
// nginx serves /privacy/ as that folder's index; do the same in development.
const pagesInFolders = {
  name: 'pages-in-folders',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const page = req.url.match(/^\/(about|contact|terms|privacy)\/?(\?.*)?$/);
      if (page) req.url = `/${page[1]}/index.html`;
      next();
    });
  },
};

export default defineConfig({
  plugins: [pagesInFolders],
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
