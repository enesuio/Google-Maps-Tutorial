import { describe, expect, it } from 'vitest';
import { pushSupport, urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes URL-safe base64 without padding', () => {
    // "hello?" → aGVsbG8_ in URL-safe alphabet (standard: aGVsbG8/)
    const bytes = urlBase64ToUint8Array('aGVsbG8_');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111, 63]);
  });
  it('handles - and _ and restores padding', () => {
    // 0xfb 0xff → "+/8=" standard, "-_8" URL-safe
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });
  it('decodes a 65-byte uncompressed P-256 key', () => {
    const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
    expect(urlBase64ToUint8Array(key).length).toBe(65);
  });
});

describe('pushSupport', () => {
  const ok = { hasPushManager: true, hasServiceWorker: true, isIOS: false, isStandalone: false };
  it('is ok on a desktop browser with PushManager', () => {
    expect(pushSupport(ok)).toBe('ok');
  });
  it('asks iOS Safari in the browser to install first', () => {
    expect(pushSupport({ ...ok, isIOS: true })).toBe('ios-needs-install');
    expect(pushSupport({ ...ok, isIOS: true, hasPushManager: false })).toBe('ios-needs-install');
  });
  it('is ok on an installed iOS PWA', () => {
    expect(pushSupport({ ...ok, isIOS: true, isStandalone: true })).toBe('ok');
  });
  it('is unsupported without PushManager elsewhere', () => {
    expect(pushSupport({ ...ok, hasPushManager: false })).toBe('unsupported');
  });
});
