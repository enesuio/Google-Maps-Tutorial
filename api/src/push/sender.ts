import webpush from 'web-push';
import type { VapidConfig } from '../config.js';

/** Notification payload, JSON-encoded into the push body (docs/API.md). */
export interface PushPayload {
  title: string;
  body: string;
  /** In-app path to open on tap, e.g. `/` or `/day/2026-10-08`. */
  url: string;
  /** Dedupe key: `reminder-<date>`, `checkin-<userId>-<date>`, `cheer-<id>`. */
  tag: string;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Thrown by a sender when the push service answers with a non-2xx status. */
export class PushSendError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PushSendError';
  }
}

export interface PushSender {
  send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<void>;
}

/** Real Web Push over VAPID (the `web-push` package). */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: VapidConfig) {}

  async send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 60 * 60 * 12,
        urgency: 'normal',
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      });
    } catch (err) {
      if (err instanceof webpush.WebPushError) throw new PushSendError(err.statusCode, err.message);
      throw err;
    }
  }
}

/** Used when push is disabled: accepts every send and does nothing. */
export class NoopSender implements PushSender {
  async send(): Promise<void> {
    /* push disabled */
  }
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
