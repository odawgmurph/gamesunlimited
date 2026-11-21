import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import crcast from './api/crcast.js';
import ice from './api/ice.js';

/** Serves the /api functions (normally run by Vercel) from the dev and preview servers. */
const apiRoutes = {
  name: 'api-routes',
  configureServer(server) {
    server.middlewares.use('/api/crcast', (req, res) => crcast(req, res));
    server.middlewares.use('/api/ice', (req, res) => ice(req, res));
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/crcast', (req, res) => crcast(req, res));
    server.middlewares.use('/api/ice', (req, res) => ice(req, res));
  },
};

export default defineConfig({
  plugins: [preact(), apiRoutes],
  server: { host: true },
});
