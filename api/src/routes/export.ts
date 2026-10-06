import type { FastifyInstance, FastifyReply } from 'fastify';
import { todayInToronto } from '../dates.js';
import { buildCheckinsCsv, buildExportJson, buildHealthCsv, buildMetricsCsv } from '../export.js';
import { me, type RouteContext } from './context.js';

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
/** Fastify adds the charset to any JSON body, so this matches every other JSON route. */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** `attachment; filename="hydrox45-<kind>-<today>.<ext>"` */
export function exportFilename(kind: string, today: string, ext: 'json' | 'csv'): string {
  return `hydrox45-${kind}-${today}.${ext}`;
}

function download(reply: FastifyReply, contentType: string, filename: string, body: string): FastifyReply {
  return reply
    .header('content-type', contentType)
    .header('content-disposition', `attachment; filename="${filename}"`)
    .header('cache-control', 'private, no-store')
    .send(body);
}

export async function exportRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, now } = ctx;

  api.get('/export.json', async (req, reply) => {
    const at = now();
    const data = await buildExportJson(db, me(req).id, at);
    return download(reply, JSON_CONTENT_TYPE, exportFilename('export', todayInToronto(at), 'json'), JSON.stringify(data, null, 2));
  });

  api.get('/export.csv', async (req, reply) => {
    me(req);
    return download(reply, CSV_CONTENT_TYPE, exportFilename('checkins', todayInToronto(now()), 'csv'), await buildCheckinsCsv(db));
  });

  api.get('/export/metrics.csv', async (req, reply) =>
    download(reply, CSV_CONTENT_TYPE, exportFilename('metrics', todayInToronto(now()), 'csv'), await buildMetricsCsv(db, me(req).id)),
  );

  api.get('/export/health.csv', async (req, reply) => {
    me(req);
    return download(reply, CSV_CONTENT_TYPE, exportFilename('health', todayInToronto(now()), 'csv'), await buildHealthCsv(db));
  });
}
