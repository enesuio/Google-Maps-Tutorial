import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, describeError } from '../api/client';
import type { HistoryView } from '../api/types';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { daysBetween, formatShortDate } from '../lib/dates';

export function HistoryScreen() {
  const [view, setView] = useState<HistoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .history()
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // HistoryView has no "today's day number"; derive it from the server's `today` and
  // `startDate` (never from the browser clock).
  const todayDay = view ? daysBetween(view.challenge.startDate, view.today) + 1 : null;
  const users = view?.users ?? [];

  return (
    <div className="app">
      <Header day={todayDay} lengthDays={view?.challenge.lengthDays ?? null} />
      <main className="main">
        <h1 className="page-title">History</h1>
        {loading && (
          <p className="muted loading" role="status">
            Loading…
          </p>
        )}
        {error && (
          <div className="notice" role="alert">
            <p>{error}</p>
          </div>
        )}
        {view && view.days.length === 0 && <p className="muted">No days yet. Check back after Day 1.</p>}
        {view && view.days.length > 0 && (
          <div className="history">
            <div className="history-head" aria-hidden="true">
              <span className="history-date">Goals hit</span>
              <span className="history-chips">
                {users.map((u) => (
                  <span key={u.id} className="history-name">
                    {u.isMe ? 'You' : u.name}
                  </span>
                ))}
              </span>
            </div>
            <ul className="history-list">
              {view.days.map((d) => (
                <li key={d.date}>
                  <Link
                    to={`/day/${d.date}`}
                    className="history-row"
                    aria-label={`${formatShortDate(d.date)}, day ${d.day}. Open to edit.`}
                  >
                    <span className="history-date">
                      <span className="history-date-text">{formatShortDate(d.date)}</span>
                      <span className="history-day">
                        {d.date === view.today ? 'Today · ' : ''}Day {d.day}
                      </span>
                    </span>
                    <span className="history-chips">
                      {users.map((u) => {
                        const s = d.users.find((x) => x.userId === u.id);
                        const entered = s?.entered ?? false;
                        const full = s && s.total > 0 && s.hit === s.total;
                        return (
                          <span
                            key={u.id}
                            className="chip"
                            data-entered={entered}
                            data-full={entered && full}
                            aria-label={`${u.isMe ? 'You' : u.name}: ${
                              s ? `${s.hit} of ${s.total} hit` : 'no goals'
                            }${entered ? '' : ', not entered'}`}
                          >
                            {s ? `${s.hit}/${s.total}` : '–'}
                          </span>
                        );
                      })}
                      <span className="chevron" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
      <Footer current="history" />
    </div>
  );
}
