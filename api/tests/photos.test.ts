import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { imageDimensions, sniffImage, type Photo, type PhotosView } from '../src/photos.js';
import { closeDb, cookieHeader, db, login, makeApp, migrateOnce, resetDb, userId } from './helpers.js';

// Saturday Oct 10 2026 → challenge day 5.
const NOW = () => new Date('2026-10-10T16:00:00Z');

let app: Awaited<ReturnType<typeof makeApp>>;
let uploadsDir: string;

beforeAll(async () => {
  await migrateOnce();
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await resetDb();
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'hx-uploads-'));
  app = await makeApp({ now: NOW, config: { UPLOADS_DIR: uploadsDir } });
});
afterEach(async () => {
  await app.close();
  await rm(uploadsDir, { recursive: true, force: true });
});

const json = <T>(res: { body: string }): T => JSON.parse(res.body) as T;
const codeOf = (res: { body: string }) => json<{ error: { code: string } }>(res).error.code;

// ---- A real PNG, generated here (no fixtures): width × height opaque pixels ----

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((1 + width * 3) * height, 0x7f);
  for (let y = 0; y < height; y++) raw[y * (1 + width * 3)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A minimal JPEG head: SOI, an APP0 segment, then a baseline SOF0 for width × height. */
function jpegHead(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]), sof, Buffer.alloc(32)]);
}

interface Part {
  name: string;
  value: string | { data: Buffer; filename: string; type: string };
}

/** Builds a multipart/form-data body by hand so field order is under the test's control. */
function multipart(parts: Part[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----hx45test' + Math.random().toString(36).slice(2);
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (typeof p.value === 'string') {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.value.filename}"\r\nContent-Type: ${p.value.type}\r\n\r\n`,
        ),
        p.value.data,
        Buffer.from('\r\n'),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(chunks);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(payload.length) } };
}

async function upload(cookie: string, parts: Part[]) {
  const { payload, headers } = multipart(parts);
  return app.inject({ method: 'POST', url: '/api/photos', headers: { ...cookieHeader(cookie), ...headers }, payload });
}
const file = (data: Buffer, type = 'image/png', filename = 'me.png'): Part['value'] => ({ data, filename, type });

describe('image sniffing', () => {
  it('detects png/jpeg/webp/heic by magic bytes and reads png/jpeg dimensions', () => {
    const png = makePng(12, 7);
    expect(sniffImage(png)).toBe('image/png');
    expect(imageDimensions('image/png', png)).toEqual({ width: 12, height: 7 });
    const jpg = jpegHead(640, 480);
    expect(sniffImage(jpg)).toBe('image/jpeg');
    expect(imageDimensions('image/jpeg', jpg)).toEqual({ width: 640, height: 480 });
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
    expect(sniffImage(webp)).toBe('image/webp');
    expect(imageDimensions('image/webp', webp)).toBeNull();
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(4), Buffer.from('mif1heic'), Buffer.alloc(8)]);
    expect(sniffImage(heic)).toBe('image/heic');
    const mif1 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmif1'), Buffer.alloc(4), Buffer.from('mif1heic'), Buffer.alloc(8)]);
    expect(sniffImage(mif1)).toBe('image/heic');
    expect(sniffImage(Buffer.from('GIF89a' + '\0'.repeat(20)))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.4' + '\0'.repeat(20)))).toBeNull();
  });
});

describe('POST /api/photos', () => {
  it('stores a PNG under <uploads>/<userId>/<id>.png and returns 201 with its dimensions', async () => {
    const enes = await login(app, 'enes');
    const png = makePng(40, 30);
    const res = await upload(enes, [{ name: 'date', value: '2026-10-06' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(png) }]);
    expect(res.statusCode, res.body).toBe(201);
    const photo = json<Photo>(res);
    expect(photo).toMatchObject({ id: 1, date: '2026-10-06', kind: 'start', mime: 'image/png', bytes: png.length, width: 40, height: 30, url: '/api/photos/1/file' });
    expect(new Date(photo.createdAt).toISOString()).toBe(photo.createdAt);

    const enesId = await userId('enes');
    const row = await db.selectFrom('photos').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ user_id: enesId, path: `${enesId}/1.png`, mime: 'image/png', bytes: png.length, width: 40, height: 30 });
    expect(await readdir(path.join(uploadsDir, String(enesId)))).toEqual(['1.png']); // no temp file left behind
  });

  it('accepts the file before the fields, a jpeg with its header, and heic/webp without dimensions', async () => {
    const enes = await login(app, 'enes');
    let res = await upload(enes, [{ name: 'photo', value: file(makePng(2, 2)) }, { name: 'kind', value: 'progress' }, { name: 'date', value: '2026-10-10' }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(json<Photo>(res)).toMatchObject({ kind: 'progress', date: '2026-10-10', width: 2, height: 2 });

    res = await upload(enes, [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'end' }, { name: 'photo', value: file(jpegHead(800, 600), 'image/jpeg', 'a.jpg') }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(json<Photo>(res)).toMatchObject({ mime: 'image/jpeg', width: 800, height: 600 });
    expect(existsSync(path.join(uploadsDir, String(await userId('enes')), `${json<Photo>(res).id}.jpg`))).toBe(true);

    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(4), Buffer.from('mif1heic'), Buffer.alloc(64)]);
    res = await upload(enes, [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'progress' }, { name: 'photo', value: file(heic, 'image/heic', 'a.heic') }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(json<Photo>(res)).toMatchObject({ mime: 'image/heic', width: null, height: null });
  });

  it('rejects a wrong or mismatched type, a missing file, bad fields and bad dates; nothing is left on disk', async () => {
    const enes = await login(app, 'enes');
    const png = makePng(4, 4);
    const base = [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'progress' }];

    let res = await upload(enes, [...base, { name: 'photo', value: file(Buffer.from('GIF89a' + '\0'.repeat(64)), 'image/gif', 'a.gif') }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    // Declared png, bytes are not.
    res = await upload(enes, [...base, { name: 'photo', value: file(Buffer.from('%PDF-1.4' + '\0'.repeat(64)), 'image/png') }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    // Declared jpeg, bytes are png.
    res = await upload(enes, [...base, { name: 'photo', value: file(png, 'image/jpeg', 'a.jpg') }]);
    expect(res.statusCode).toBe(400);
    // Missing file / wrong field name.
    res = await upload(enes, base);
    expect(res.statusCode).toBe(400);
    res = await upload(enes, [...base, { name: 'image', value: file(png) }]);
    expect(res.statusCode).toBe(400);
    // Bad kind / malformed date / missing date.
    res = await upload(enes, [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'selfie' }, { name: 'photo', value: file(png) }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');
    res = await upload(enes, [{ name: 'date', value: '10/10/2026' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(png) }]);
    expect(res.statusCode).toBe(400);
    res = await upload(enes, [{ name: 'kind', value: 'start' }, { name: 'photo', value: file(png) }]);
    expect(res.statusCode).toBe(400);
    // Future / before start.
    res = await upload(enes, [{ name: 'date', value: '2026-10-11' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(png) }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('future_date');
    res = await upload(enes, [{ name: 'date', value: '2026-10-05' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(png) }]);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('before_start');
    // Not multipart at all.
    res = await app.inject({ method: 'POST', url: '/api/photos', headers: cookieHeader(enes), payload: { date: '2026-10-10', kind: 'start' } });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('bad_request');

    expect(await db.selectFrom('photos').select('id').execute()).toEqual([]);
    const dir = path.join(uploadsDir, String(await userId('enes')));
    expect(existsSync(dir) ? await readdir(dir) : []).toEqual([]);
  });

  it('413 over 12 MB (streamed past the limit, or announced by content-length); nothing is kept', async () => {
    const enes = await login(app, 'enes');
    const limit = 12 * 1024 * 1024;
    const big = Buffer.concat([makePng(1, 1), Buffer.alloc(limit)]); // one byte over once the real header is counted
    let res = await upload(enes, [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(big) }]);
    expect(res.statusCode).toBe(413);
    expect(codeOf(res)).toBe('too_large');

    res = await app.inject({
      method: 'POST',
      url: '/api/photos',
      headers: { ...cookieHeader(enes), 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(limit + 1024 * 1024) },
      payload: Buffer.alloc(16),
    });
    expect(res.statusCode).toBe(413);

    expect(await db.selectFrom('photos').select('id').execute()).toEqual([]);
    const dir = path.join(uploadsDir, String(await userId('enes')));
    expect(existsSync(dir) ? await readdir(dir) : []).toEqual([]);
    // Exactly at the limit is fine.
    const exact = Buffer.concat([makePng(1, 1), Buffer.alloc(limit - makePng(1, 1).length)]);
    res = await upload(enes, [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(exact) }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(json<Photo>(res).bytes).toBe(limit);
  });
});

describe('GET /api/photos, GET /api/photos/:id/file, DELETE /api/photos/:id', () => {
  it('lists own photos newest first, streams the bytes to the owner only, and delete removes the file', async () => {
    const enes = await login(app, 'enes');
    const agnes = await login(app, 'agnes');
    const a = makePng(3, 3);
    const b = makePng(5, 2);
    const first = json<Photo>(await upload(enes, [{ name: 'date', value: '2026-10-06' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(a) }]));
    const second = json<Photo>(await upload(enes, [{ name: 'date', value: '2026-10-10' }, { name: 'kind', value: 'progress' }, { name: 'photo', value: file(b) }]));
    const hers = json<Photo>(await upload(agnes, [{ name: 'date', value: '2026-10-06' }, { name: 'kind', value: 'start' }, { name: 'photo', value: file(makePng(1, 1)) }]));

    let list = json<PhotosView>(await app.inject({ method: 'GET', url: '/api/photos', headers: cookieHeader(enes) }));
    expect(list.photos.map((p) => p.id)).toEqual([second.id, first.id]);
    expect(list.photos[0]).toEqual(second);
    list = json<PhotosView>(await app.inject({ method: 'GET', url: '/api/photos', headers: cookieHeader(agnes) }));
    expect(list.photos.map((p) => p.id)).toEqual([hers.id]);

    // File: bytes, mime, private cache header; the partner gets 404.
    let res = await app.inject({ method: 'GET', url: first.url, headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-length']).toBe(String(a.length));
    expect(res.headers['cache-control']).toBe('private, max-age=31536000');
    expect(res.rawPayload.equals(a)).toBe(true);
    res = await app.inject({ method: 'GET', url: first.url, headers: cookieHeader(agnes) });
    expect(res.statusCode).toBe(404);
    expect(codeOf(res)).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: first.url })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/photos/999/file', headers: cookieHeader(enes) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/photos/abc/file', headers: cookieHeader(enes) })).statusCode).toBe(400);

    // Delete: partner 404 (file stays), owner 204 (file gone), again 404.
    const enesId = await userId('enes');
    const onDisk = path.join(uploadsDir, String(enesId), `${first.id}.png`);
    expect(existsSync(onDisk)).toBe(true);
    res = await app.inject({ method: 'DELETE', url: `/api/photos/${first.id}`, headers: cookieHeader(agnes) });
    expect(res.statusCode).toBe(404);
    expect(existsSync(onDisk)).toBe(true);
    res = await app.inject({ method: 'DELETE', url: `/api/photos/${first.id}`, headers: cookieHeader(enes) });
    expect(res.statusCode).toBe(204);
    expect(existsSync(onDisk)).toBe(false);
    expect((await app.inject({ method: 'DELETE', url: `/api/photos/${first.id}`, headers: cookieHeader(enes) })).statusCode).toBe(404);
    expect(await readdir(path.join(uploadsDir, String(enesId)))).toEqual([`${second.id}.png`]);
    list = json<PhotosView>(await app.inject({ method: 'GET', url: '/api/photos', headers: cookieHeader(enes) }));
    expect(list.photos.map((p) => p.id)).toEqual([second.id]);
  });
});
