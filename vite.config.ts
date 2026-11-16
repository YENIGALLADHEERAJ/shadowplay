/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-only endpoint for Shadowplay's ?capture mode: the headset POSTs a
 * captured hand shadow and it is saved to captures/ in the project.
 */
function shadowCaptures(): Plugin {
  const dir = resolve(process.cwd(), 'captures');
  return {
    name: 'shadowplay-captures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk;
          if (body.length > 200_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as { n: number };
            mkdirSync(dir, { recursive: true });
            const file = resolve(dir, `capture-${Date.now()}-${data.n}.json`);
            writeFileSync(file, JSON.stringify(data, null, 1));
            res.statusCode = 201;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

// `vite --mode http` serves plain HTTP on localhost for desktop browsers that
// reject the self-signed dev certificate. Headsets need the default HTTPS.
export default defineConfig(({ mode }) => ({
  plugins: [iwsdkDev({ https: mode !== 'http' }), shadowCaptures()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
}));
