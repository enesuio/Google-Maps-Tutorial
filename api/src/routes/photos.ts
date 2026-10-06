import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dateSchema, todayInToronto } from '../dates.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import {
  PHOTO_HEADER_BYTES,
  PHOTO_MAX_BYTES,
  PHOTO_MIME_EXT,
  imageDimensions,
  isPhotoMime,
  photoView,
  sniffImage,
  type PhotoMime,
  type PhotosView,
} from '../photos.js';
import { parse } from '../validate.js';
import { loadChallenge } from '../views.js';
import { me, type RouteContext } from './context.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const photoFields = z.object({ date: dateSchema, kind: z.enum(['start', 'progress', 'end']) });

const tooLarge = (): HttpError =>
  new HttpError(413, 'too_large', `Photos must be ${PHOTO_MAX_BYTES / (1024 * 1024)} MB or smaller.`);

interface SavedFile {
  tmpPath: string;
  bytes: number;
  head: Buffer;
}

/** Streams `file` to a temp name in `dir`, keeping the first bytes for sniffing. */
async function saveToTemp(file: Readable, dir: string): Promise<SavedFile> {
  const tmpPath = path.join(dir, `.upload-${randomBytes(8).toString('hex')}`);
  const headChunks: Buffer[] = [];
  let headLength = 0;
  let bytes = 0;
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (headLength < PHOTO_HEADER_BYTES) {
        const take = chunk.subarray(0, PHOTO_HEADER_BYTES - headLength);
        headChunks.push(take);
        headLength += take.length;
      }
      cb(null, chunk);
    },
  });
  await pipeline(file, tap, createWriteStream(tmpPath, { flags: 'wx', mode: 0o600 }));
  return { tmpPath, bytes, head: Buffer.concat(headChunks) };
}

const unlinkQuietly = async (file: string): Promise<void> => {
  try {
    await unlink(file);
  } catch {
    /* already gone */
  }
};

const drain = (file: Readable): void => {
  file.resume();
};

export async function photoRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now, uploadsDir } = ctx;

  // Only this context parses multipart bodies; the file-size limit makes busboy truncate and flag the stream.
  await api.register(fastifyMultipart, {
    limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 10, parts: 20, fieldSize: 1024 },
  });

  api.get('/photos', async (req): Promise<PhotosView> => {
    const rows = await db
      .selectFrom('photos')
      .select(['id', 'date', 'kind', 'mime', 'bytes', 'width', 'height', 'created_at'])
      .where('user_id', '=', me(req).id)
      .orderBy('date', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return { photos: rows.map(photoView) };
  });

  api.post('/photos', async (req, reply) => {
    const user = me(req);
    if (!req.isMultipart()) {
      throw badRequest('bad_request', 'Expected multipart/form-data with fields "date", "kind" and the file "photo".');
    }
    // Refuse an obviously oversize upload before reading it (headers and boundaries add a little).
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > PHOTO_MAX_BYTES + 64 * 1024) throw tooLarge();

    const userDir = path.join(uploadsDir, String(user.id));
    await mkdir(userDir, { recursive: true });

    const fields: Record<string, string> = {};
    let saved: SavedFile | null = null;
    let mime: PhotoMime | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (typeof part.value === 'string') fields[part.fieldname] = part.value;
          continue;
        }
        if (part.fieldname !== 'photo' || saved) {
          drain(part.file);
          throw badRequest('bad_request', 'Send exactly one file, in the field "photo".');
        }
        const declared = (part.mimetype.split(';')[0] ?? '').trim().toLowerCase();
        if (!isPhotoMime(declared)) {
          drain(part.file);
          throw badRequest('bad_request', `Unsupported type "${declared}". Accepted: ${Object.keys(PHOTO_MIME_EXT).join(', ')}.`);
        }
        saved = await saveToTemp(part.file, userDir);
        if (part.file.truncated) throw tooLarge();
        const sniffed = sniffImage(saved.head);
        if (sniffed !== declared) {
          throw badRequest('bad_request', `The file is not a ${declared} image.`);
        }
        mime = sniffed;
      }
    } catch (err) {
      if (saved) await unlinkQuietly(saved.tmpPath);
      const e = err as { code?: string; statusCode?: number };
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413) throw tooLarge();
      throw err;
    }

    try {
      if (!saved || !mime) throw badRequest('bad_request', 'Missing file "photo".');
      const { date, kind } = parse(photoFields, fields, 'body');
      const today = todayInToronto(now());
      if (date > today) throw badRequest('future_date', `${date} is after today (${today}).`);
      const challenge = await loadChallenge(db);
      if (date < challenge.startDate) {
        throw badRequest('before_start', `${date} is before the challenge start (${challenge.startDate}).`);
      }
      const dims = imageDimensions(mime, saved.head);
      const ext = PHOTO_MIME_EXT[mime]!;

      // Insert first to get the id; the row briefly points at the temp file, which does exist.
      const row = await db
        .insertInto('photos')
        .values({
          user_id: user.id,
          date,
          kind,
          path: path.relative(uploadsDir, saved.tmpPath),
          mime,
          bytes: saved.bytes,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
        })
        .returning(['id', 'date', 'kind', 'mime', 'bytes', 'width', 'height', 'created_at'])
        .executeTakeFirstOrThrow();
      const finalRel = path.join(String(user.id), `${row.id}.${ext}`);
      try {
        await rename(saved.tmpPath, path.join(uploadsDir, finalRel));
        await db.updateTable('photos').set({ path: finalRel }).where('id', '=', row.id).execute();
      } catch (err) {
        await db.deleteFrom('photos').where('id', '=', row.id).execute();
        await unlinkQuietly(path.join(uploadsDir, finalRel));
        throw err;
      }
      return reply.status(201).send(photoView(row));
    } catch (err) {
      if (saved) await unlinkQuietly(saved.tmpPath);
      throw err;
    }
  });

  api.get('/photos/:id/file', async (req, reply) => {
    const user = me(req);
    const { id } = parse(idParams, req.params, 'params');
    const row = await db
      .selectFrom('photos')
      .select(['path', 'mime', 'bytes'])
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    if (!row) throw notFound(`No photo ${id}.`);
    const abs = path.join(uploadsDir, row.path);
    const info = await stat(abs).catch(() => null);
    if (!info || !info.isFile()) throw notFound(`No photo ${id}.`);
    return reply
      .header('content-type', row.mime)
      .header('content-length', String(info.size))
      .header('cache-control', 'private, max-age=31536000')
      .send(createReadStream(abs));
  });

  api.delete('/photos/:id', async (req, reply) => {
    const user = me(req);
    const { id } = parse(idParams, req.params, 'params');
    const row = await db
      .deleteFrom('photos')
      .where('id', '=', id)
      .where('user_id', '=', user.id)
      .returning('path')
      .executeTakeFirst();
    if (!row) throw notFound(`No photo ${id}.`);
    await unlinkQuietly(path.join(uploadsDir, row.path));
    return reply.status(204).send();
  });
}
