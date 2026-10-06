import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, setUnauthenticated } from '../api/client';

interface Props {
  /** Which nav link to show (the one you are not on). */
  current: 'today' | 'history' | 'day';
}

export function Footer({ current }: Props) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await api.logout();
    } catch {
      // Either way the cookie is gone or we were already signed out.
    } finally {
      setUnauthenticated(true);
      setBusy(false);
    }
  }

  return (
    <footer className="footer">
      <nav className="footer-nav" aria-label="Pages">
        {current !== 'today' && <Link to="/">Today</Link>}
        {current !== 'history' && <Link to="/history">History</Link>}
      </nav>
      <button type="button" className="link-button" onClick={signOut} disabled={busy}>
        Sign out
      </button>
    </footer>
  );
}
