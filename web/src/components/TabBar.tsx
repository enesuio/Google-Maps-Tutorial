import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, setUnauthenticated } from '../api/client';
import { activeMoreItem, activeTab, MORE_ITEMS, TABS, type Tab } from '../lib/nav';

/**
 * Site navigation. On a phone it is a fixed 56px bottom tab bar with five items (Today,
 * History, Trend, Photos, More); "More" opens a small sheet with Recap, Summary and Sign out.
 * At ≥720px the same markup renders inline at the top right, with every link visible and the
 * More button hidden (CSS does the switching, so hidden links are never focusable).
 */
export function TabBar() {
  const { pathname } = useLocation();
  const active = activeTab(pathname);
  const activeMore = activeMoreItem(pathname);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheetId = useId();

  // Close the sheet whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

  function closeSheet() {
    setOpen(false);
    moreButton.current?.focus();
  }

  return (
    <>
      <nav className="tabbar" aria-label="Pages">
        <ul className="tabbar-list">
          {TABS.map((t) =>
            t.tab === 'more' ? (
              <li key={t.tab} className="tabbar-item tabbar-more">
                <button
                  ref={moreButton}
                  type="button"
                  className="tab"
                  data-active={active === 'more'}
                  aria-expanded={open}
                  aria-controls={sheetId}
                  aria-haspopup="dialog"
                  onClick={() => setOpen((o) => !o)}
                >
                  <TabIcon tab="more" />
                  <span className="tab-label">{t.label}</span>
                </button>
              </li>
            ) : (
              <li key={t.tab} className="tabbar-item">
                <Link to={t.to} className="tab" data-active={active === t.tab} aria-current={active === t.tab ? 'page' : undefined}>
                  <TabIcon tab={t.tab} />
                  <span className="tab-label">{t.label}</span>
                </Link>
              </li>
            ),
          )}
          {MORE_ITEMS.map((m) => (
            <li key={m.tab} className="tabbar-item tabbar-inline-only">
              <Link to={m.to} className="tab" data-active={activeMore === m.tab} aria-current={activeMore === m.tab ? 'page' : undefined}>
                <span className="tab-label">{m.label}</span>
              </Link>
            </li>
          ))}
          <li className="tabbar-item tabbar-inline-only">
            <button type="button" className="tab tab-signout" onClick={() => void signOut()} disabled={busy}>
              <span className="tab-label">Sign out</span>
            </button>
          </li>
        </ul>
      </nav>
      {open && (
        <MoreSheet id={sheetId} activeMore={activeMore} busy={busy} onClose={closeSheet} onSignOut={() => void signOut()} />
      )}
    </>
  );
}

interface SheetProps {
  id: string;
  activeMore: ReturnType<typeof activeMoreItem>;
  busy: boolean;
  onClose: () => void;
  onSignOut: () => void;
}

function MoreSheet({ id, activeMore, busy, onClose, onSignOut }: SheetProps) {
  const titleId = useId();
  const first = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    first.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop more-backdrop" onClick={onClose}>
      <div id={id} className="sheet more-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 className="sheet-title more-title" id={titleId}>
          More
        </h2>
        <ul className="more-list">
          {MORE_ITEMS.map((m, i) => (
            <li key={m.tab}>
              <Link
                ref={i === 0 ? first : undefined}
                to={m.to}
                className="more-link"
                aria-current={activeMore === m.tab ? 'page' : undefined}
                onClick={() => onClose()}
              >
                <TabIcon tab={m.tab} />
                {m.label}
                {activeMore === m.tab && <span className="more-current">Current</span>}
              </Link>
            </li>
          ))}
          <li className="more-divider" role="presentation" />
          <li>
            <button type="button" className="more-link more-signout" onClick={onSignOut} disabled={busy}>
              <TabIcon tab="signout" />
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </li>
        </ul>
        <button type="button" className="button button-secondary more-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

type IconName = Tab | 'recap' | 'summary' | 'signout';

/** 24px line icons, `currentColor`, decorative (the label beside each carries the name). */
function TabIcon({ tab }: { tab: IconName }) {
  let path: React.ReactNode;
  switch (tab) {
    case 'today':
      path = (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 12.2l2.3 2.3 4.7-4.8" />
        </>
      );
      break;
    case 'history':
      path = (
        <>
          <path d="M5 6.5h14M5 12h14M5 17.5h9" />
        </>
      );
      break;
    case 'trend':
      path = <path d="M4 16.5l4.5-5 3.5 3 4-6 4 3.5" />;
      break;
    case 'photos':
      path = (
        <>
          <rect x="4" y="5.5" width="16" height="13" rx="2.5" />
          <circle cx="9" cy="10.5" r="1.4" />
          <path d="M4.5 16.5l4.3-4 3.2 3 3-2.6 4.5 3.6" />
        </>
      );
      break;
    case 'more':
      path = (
        <>
          <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </>
      );
      break;
    case 'recap':
      path = (
        <>
          <rect x="4" y="5" width="16" height="15" rx="2.5" />
          <path d="M4 10h16M8.5 3.5v3M15.5 3.5v3" />
        </>
      );
      break;
    case 'summary':
      path = (
        <>
          <path d="M6 20V11M12 20V5M18 20v-7" />
          <path d="M4 20h16" />
        </>
      );
      break;
    case 'signout':
      path = (
        <>
          <path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
          <path d="M14.5 8l4 4-4 4M18.5 12H9.5" />
        </>
      );
      break;
  }
  return (
    <svg
      className="tab-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}
