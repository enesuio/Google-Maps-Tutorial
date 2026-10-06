import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../errors.js';
import { testPayload } from '../push/jobs.js';
import { deleteSubscription, hasSubscription, sendToUser, upsertSubscription } from '../push/subscriptions.js';
import { parse } from '../validate.js';
import { me, type RouteContext } from './context.js';

export interface PushStatus {
  enabled: boolean;
  publicKey: string | null;
  subscribed: boolean;
}

const subscribeBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(512), auth: z.string().min(1).max(512) }),
});
const unsubscribeBody = z.object({ endpoint: z.string().min(1).max(2048) });

const pushDisabled = (): HttpError =>
  new HttpError(503, 'push_disabled', 'Push notifications are not configured on this server.');

export async function pushRoutes(api: FastifyInstance, ctx: RouteContext): Promise<void> {
  const { db, config, sender, pushEnabled } = ctx;

  api.get('/push/status', async (req): Promise<PushStatus> => {
    const user = me(req);
    return {
      enabled: pushEnabled,
      publicKey: pushEnabled ? (config.VAPID_PUBLIC_KEY ?? null) : null,
      subscribed: await hasSubscription(db, user.id),
    };
  });

  api.post('/push/subscribe', async (req, reply) => {
    const user = me(req);
    if (!pushEnabled) throw pushDisabled();
    const body = parse(subscribeBody, req.body, 'body');
    await upsertSubscription(db, user.id, body);
    return reply.status(201).send({ ok: true });
  });

  api.delete('/push/subscribe', async (req, reply) => {
    const user = me(req);
    const { endpoint } = parse(unsubscribeBody, req.body, 'body');
    await deleteSubscription(db, user.id, endpoint);
    return reply.status(204).send();
  });

  api.post('/push/test', async (req, reply) => {
    const user = me(req);
    if (!pushEnabled) throw pushDisabled();
    await sendToUser(db, sender, user.id, testPayload());
    return reply.status(202).send({ ok: true });
  });
}
