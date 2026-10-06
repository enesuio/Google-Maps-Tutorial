import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, describeError } from '../api/client';
import type { ImportStatus } from '../api/types';
import { formatShortDate } from '../lib/dates';
import { importStatusLine } from '../lib/health';

type Phase = 'loading' | 'error' | 'ready';

/**
 * "Apple Health" settings block (T11). Sits next to Notifications on the today screen.
 * Reads `GET /api/import/status`; creates, rotates and revokes the per-user import token.
 * The token is shown exactly once, right after it is created.
 */
export function HealthSection() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [token, setToken] = useState<string | null>(null); // fresh token, shown once
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tokenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .importStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        setPhase('ready');
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
  }, []);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function createToken(rotate: boolean) {
    if (busy) return;
    if (rotate && !window.confirm('Rotate the token? The old one stops working right away, so update the Shortcut with the new one.'))
      return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.createImportToken();
      setToken(res.token);
      setCopied(false);
      setStatus(await api.importStatus());
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.status === 401)) setMessage(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    if (!window.confirm('Disconnect Apple Health? The Shortcut will stop working until you create a new token.')) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteImportToken();
      setToken(null);
      setStatus(await api.importStatus());
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.status === 401)) setMessage(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Clipboard blocked (http, old WebView): select the text so a long-press copies it.
      const el = tokenRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setMessage('Copy blocked by the browser. Long-press the token to copy it.');
    }
  }

  const connected = status?.hasToken === true;
  const state = phase !== 'ready' ? '' : !connected ? 'Off' : status?.lastImport ? 'On' : 'Waiting';
  const statusLine = status ? importStatusLine(status, formatShortDate) : null;

  let body: React.ReactNode;
  if (phase === 'loading') {
    body = <p className="muted settings-text">Checking…</p>;
  } else if (phase === 'error') {
    body = <p className="muted settings-text">{message ?? 'Could not load Apple Health settings.'}</p>;
  } else if (!connected) {
    body = (
      <>
        <p className="muted settings-text">Let your iPhone send steps and active calories every evening.</p>
        <button type="button" className="button" onClick={() => void createToken(false)} disabled={busy}>
          {busy ? 'Creating…' : 'Create import token'}
        </button>
      </>
    );
  } else {
    body = (
      <>
        {statusLine && <p className="settings-text health-status">{statusLine}</p>}
        <div className="settings-actions">
          <button type="button" className="button button-secondary" onClick={() => void createToken(true)} disabled={busy}>
            Rotate token
          </button>
          <button type="button" className="link-button" onClick={() => void disconnect()} disabled={busy}>
            Disconnect
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="card settings-card" aria-labelledby="health-title">
      <header className="card-header">
        <h2 className="card-title settings-title" id="health-title">
          Apple Health
        </h2>
        <span className="settings-state" data-on={state === 'On'}>
          {state}
        </span>
      </header>
      {token && (
        <div className="token-box" role="group" aria-label="Your new import token">
          <p className="token-hint">
            Your token. It is shown <strong>only once</strong> — paste it into the Shortcut now.
          </p>
          <div className="token-row">
            <code className="token" ref={tokenRef}>
              {token}
            </code>
            <button type="button" className="button button-secondary token-copy" onClick={() => void copyToken()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <Link to="/health-setup" className="token-link">
            How to set up the Shortcut →
          </Link>
        </div>
      )}
      {body}
      {message && phase === 'ready' && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
