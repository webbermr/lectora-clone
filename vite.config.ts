import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * SCORM's server key while developing (`npm run dev` / `npm run preview`): with ANTHROPIC_API_KEY set, requests
 * to /api/anthropic are passed on to Anthropic with that key, as the Docker image's nginx does.
 */
const key = process.env.ANTHROPIC_API_KEY ?? '';
const anthropicProxy = key
  ? {
      '/api/anthropic/v1/messages': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (p: string) => p.replace(/^\/api\/anthropic/, ''),
        headers: { 'x-api-key': key },
        configure: (proxy: { on: (e: 'proxyReq', fn: (req: { removeHeader: (h: string) => void }) => void) => void }) => {
          proxy.on('proxyReq', (req) => {
            for (const h of ['authorization', 'cookie', 'origin', 'referer']) req.removeHeader(h);
          });
        },
      },
    }
  : undefined;

const scormStatus: Plugin = {
  name: 'scorm-ai-status',
  configureServer(server) {
    server.middlewares.use('/api/scorm-ai/status', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ server: !!key }));
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/scorm-ai/status', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ server: !!key }));
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), scormStatus],
  server: { proxy: anthropicProxy },
  preview: { proxy: anthropicProxy },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
