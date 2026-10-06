// Web Push helpers. Pure where possible; the browser-sniffing bits are isolated here.

/** Decode a URL-safe base64 VAPID public key into the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushSupport = 'ok' | 'unsupported' | 'ios-needs-install';

export interface SupportEnv {
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  isIOS: boolean;
  isStandalone: boolean;
}

/** Decide what the Notifications section can offer. Pure so it can be unit-tested. */
export function pushSupport(env: SupportEnv): PushSupport {
  if (env.isIOS && !env.isStandalone) return 'ios-needs-install';
  if (!env.hasPushManager || !env.hasServiceWorker) return env.isIOS ? 'ios-needs-install' : 'unsupported';
  return 'ok';
}

export function detectSupportEnv(): SupportEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const isStandalone =
    nav.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return {
    hasPushManager: 'PushManager' in window && 'Notification' in window,
    hasServiceWorker: 'serviceWorker' in navigator,
    isIOS,
    isStandalone,
  };
}

/** Existing registration, or register `/sw.js` on demand (production registers at boot). */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}
