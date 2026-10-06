import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, cookieHeader, login, makeApp, migrateOnce, resetDb } from './helpers.js';

let app: FastifyInstance;
let dir: string;

beforeAll(async () => {
  await migrateOnce();
  await resetDb();
  dir = mkdtempSync(path.join(tmpdir(), 'hydrox-web-dist-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Hydrox</title><div id="root"></div>');
  writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("hi")');
  writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({ name: 'Hydrox 45', display: 'standalone' }));
  writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("push", () => {})');
  app = await makeApp({ serveStatic: true, webDist: dir, now: () => new Date('2026-10-10T16:00:00Z') });
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('static web build', () => {
  it('serves index.html and assets', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.body).toContain('id="root"');
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('console.log');
  });

  it('falls back to index.html for client routes but not for /api or missing files', async () => {
    const spa = await app.inject({ method: 'GET', url: '/history/2026-10-07' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('id="root"');

    // Unknown /api paths are JSON 404s, never the SPA shell (with or without a session).
    const api = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(JSON.parse(api.body)).toMatchObject({ error: { code: 'not_found' } });
    const cookie = await login(app, 'enes');
    const api2 = await app.inject({ method: 'GET', url: '/api/nope', headers: cookieHeader(cookie) });
    expect(api2.statusCode).toBe(404);
    expect(JSON.parse(api2.body)).toMatchObject({ error: { code: 'not_found' } });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
  });

  it('serves the PWA manifest and service worker with the right headers', async () => {
    const manifest = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['content-type']).toContain('application/manifest+json');
    expect(JSON.parse(manifest.body)).toMatchObject({ name: 'Hydrox 45' });

    const sw = await app.inject({ method: 'GET', url: '/sw.js' });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers['content-type']).toContain('javascript');
    expect(sw.headers['cache-control']).toBe('no-cache');
    expect(sw.body).toContain('addEventListener');

    // Other files keep their normal caching, and a missing file is a 404, not the SPA shell.
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(asset.headers['cache-control']).not.toBe('no-cache');
    const missing = await app.inject({ method: 'GET', url: '/assets/gone.js' });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).not.toContain('id="root"');
  });

  it('starts without a web build', async () => {
    const bare = await makeApp({ serveStatic: true, webDist: path.join(dir, 'missing') });
    const res = await bare.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });
});
