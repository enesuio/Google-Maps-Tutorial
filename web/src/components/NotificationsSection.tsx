import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, describeError } from '../api/client';
import type { PushStatus } from '../api/types';
import { detectSupportEnv, ensureServiceWorker, pushSupport, urlBase64ToUint8Array, type PushSupport } from '../lib/push';

interface Props {
  partnerName: string | null;
}

type Phase = 'loading' | 'error' | 'ready';

/**
 * "Notifications" settings block (T7). Lives under the cards on the today screen.
 * Reads `GET /api/push/status`, then subscribes this device with the VAPID key.
 */
export function NotificationsSection({ partnerName }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [support, setSupport] = useState<PushSupport>('unsupported');
  const [local, setLocal] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator)) return setLocal(null);
      const reg = await navigator.serviceWorker.getRegistration('/');
      setLocal(reg ? await reg.pushManager.getSubscription() : null);
    } catch {
      setLocal(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSupport(pushSupport(detectSupportEnv()));
    if ('Notification' in window) setPermission(Notification.permission);
    api
      .pushStatus()
      .then(async (s) => {
        if (cancelled) return;
        setStatus(s);
        await refreshLocal();
        if (!cancelled) setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        setMessage(describeError(err));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshLocal]);

  async function turnOn() {
    if (!status?.publicKey || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        if (perm === 'denied') setMessage('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
        return;
      }
      const reg = await ensureServiceWorker();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(status.publicKey).buffer as ArrayBuffer,
        }));
      const json = sub.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!json.endpoint || !p256dh || !auth) throw new Error('Subscription is missing keys');
      await api.pushSubscribe({ endpoint: json.endpoint, keys: { p256dh, auth } });
      setLocal(sub);
      setStatus({ ...status, subscribed: true });
      setMessage('Notifications are on for this device.');
    } catch (err: unknown) {
      if (err instanceof ApiError) setMessage(describeError(err));
      else setMessage("Couldn't turn on notifications on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!local || busy) return;
    setBusy(true);
    setMessage(null);
    const endpoint = local.endpoint;
    try {
      await local.unsubscribe();
      setLocal(null);
      await api.pushUnsubscribe(endpoint);
      setStatus(await api.pushStatus());
      setMessage('Notifications are off on this device.');
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? describeError(err) : "Couldn't turn notifications off.");
    } finally {
      setBusy(false);
      void refreshLocal();
    }
  }

  async function sendTest() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.pushTest();
      setMessage('Test sent. It should arrive in a moment.');
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? describeError(err) : "Couldn't send a test.");
    } finally {
      setBusy(false);
    }
  }

  const on = local !== null;
  const partner = partnerName ?? 'your partner';

  let body: React.ReactNode;
  if (phase === 'loading') {
    body = <p className="muted settings-text">Checking…</p>;
  } else if (phase === 'error') {
    body = <p className="muted settings-text">{message ?? 'Could not load notification settings.'}</p>;
  } else if (!status?.enabled) {
    body = <p className="muted settings-text">Not configured on the server.</p>;
  } else if (!on && support === 'ios-needs-install') {
    body = (
      <p className="muted settings-text">
        Add to Home Screen first (Share → Add to Home Screen), then enable here.
      </p>
    );
  } else if (!on && support === 'unsupported') {
    body = <p className="muted settings-text">This browser doesn't support notifications.</p>;
  } else if (!on && permission === 'denied') {
    body = (
      <p className="muted settings-text">
        Notifications are blocked for this site. Allow them in your browser settings, then reload.
      </p>
    );
  } else if (!on) {
    body = (
      <>
        <p className="muted settings-text">
          A 9 pm nudge if nothing is logged, and a ping when {partner} checks in or cheers.
          {status.subscribed ? ' Already on for another device.' : ''}
        </p>
        <button type="button" className="button" onClick={() => void turnOn()} disabled={busy}>
          {busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      </>
    );
  } else {
    body = (
      <div className="settings-actions">
        <button type="button" className="button button-secondary" onClick={() => void sendTest()} disabled={busy}>
          Send a test
        </button>
        <button type="button" className="link-button" onClick={() => void turnOff()} disabled={busy}>
          Turn off
        </button>
      </div>
    );
  }

  return (
    <section className="card settings-card" aria-labelledby="notifications-title">
      <header className="card-header">
        <h2 className="card-title settings-title" id="notifications-title">
          Notifications
        </h2>
        <span className="settings-state" data-on={on}>
          {phase === 'ready' && status?.enabled ? (on ? 'On' : 'Off') : ''}
        </span>
      </header>
      {body}
      {message && phase === 'ready' && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
