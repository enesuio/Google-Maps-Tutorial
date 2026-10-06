import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, describeError } from '../api/client';
import type { RecapView, TeamView, UserRecap } from '../api/types';
import { Header } from '../components/Header';
import { formatShortDate, isValidISODate } from '../lib/dates';
import { formatThousands } from '../lib/health';
import {
  cheersLabel,
  dayDots,
  daysLabel,
  hasNextWeek,
  hasPreviousWeek,
  nextWeek,
  previousWeek,
  recapTitle,
  teamLabel,
  weightChangeLabel,
} from '../lib/recap';

/** Weekly recap (T12): one calm card per person, me first. No ranking, no weight on the partner's card. */
export function RecapScreen() {
  const [params, setParams] = useSearchParams();
  const week = params.get('week');
  const [view, setView] = useState<RecapView | null>(null);
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .team()
      .then((t) => {
        if (!cancelled) setTeam(t);
      })
      .catch(() => {
        // header only
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (week !== null && !isValidISODate(week)) {
      setError('That is not a valid week.');
      setLoading(false);
      return undefined;
    }
    api
      .recap(week ?? undefined)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof ApiError && err.status === 400 ? 'There is no recap for that week.' : describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [week]);

  function go(monday: string) {
    setParams({ week: monday });
  }

  const title = view ? recapTitle(view) : 'Recap';

  return (
    <div className="app">
      <Header day={team?.day ?? null} lengthDays={team?.challenge.lengthDays ?? null} />
      <main className="main">
        <div className="recap-nav">
          <button
            type="button"
            className="week-arrow"
            aria-label="Previous week"
            disabled={!view || !hasPreviousWeek(view)}
            onClick={() => view && go(previousWeek(view.weekStart))}
          >
            ‹
          </button>
          <h1 className="page-title recap-title" aria-live="polite">
            {title}
          </h1>
          <button
            type="button"
            className="week-arrow"
            aria-label="Next week"
            disabled={!view || !hasNextWeek(view)}
            onClick={() => view && go(nextWeek(view.weekStart))}
          >
            ›
          </button>
        </div>
        {loading && (
          <p className="muted loading" role="status">
            Loading…
          </p>
        )}
        {error && (
          <div className="notice" role="alert">
            <p>{error}</p>
            {week !== null && (
              <p>
                <Link to="/recap">Show the latest week</Link>
              </p>
            )}
          </div>
        )}
        {view && !loading && (
          <>
            <p className="team-line">{teamLabel(view.team)}</p>
            <div className="cards">
              {view.users.map((u) => (
                <RecapCard key={u.userId} recap={u} view={view} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function RecapCard({ recap, view }: { recap: UserRecap; view: RecapView }) {
  const dots = dayDots(recap, view);
  // Weight is personal: the label is only ever computed for the signed-in user's own card.
  const weight = recap.isMe ? weightChangeLabel(recap.weightChangeKg) : null;
  const title = recap.isMe ? 'You' : recap.name;

  return (
    <section className={`card ${recap.isMe ? 'card-me' : 'card-partner'}`} aria-labelledby={`recap-${recap.userId}`}>
      <header className="card-header">
        <div className="card-title-wrap">
          <h2 className="card-title" id={`recap-${recap.userId}`}>
            {title}
          </h2>
          {recap.isMe && <span className="card-subtitle">{recap.name}</span>}
        </div>
        <span className="card-summary">{daysLabel(recap)}</span>
      </header>
      <div className="day-dots" role="img" aria-label={`${daysLabel(recap)} checked in`}>
        {dots.map((d, i) => (
          // eslint-disable-next-line react/no-array-index-key -- positional dots, no identity
          <span key={i} className="day-dot" data-state={d} />
        ))}
      </div>
      <dl className="stat-grid">
        <Stat label="Goals hit" value={`${recap.goalsHit} of ${recap.goalsTotal}`} />
        {recap.weeklyGoals.map((g) => (
          <Stat key={g.goalId} label={g.label} value={`${g.count} of ${g.target}`} note="this week" />
        ))}
        <Stat label="Streak at week end" value={recap.streakEnd > 0 ? `${recap.streakEnd} ${recap.streakEnd === 1 ? 'day' : 'days'}` : 'none yet'} />
        <Stat label="Cheers" value={cheersLabel(recap)} />
        {recap.steps !== null && <Stat label="Steps" value={formatThousands(recap.steps)} note="from Apple Health" />}
        {recap.bestDay && (
          <Stat label="Best day" value={formatShortDate(recap.bestDay.date)} note={`${recap.bestDay.hit} of ${recap.bestDay.total} hit`} />
        )}
        {weight && <Stat label="Weight" value={weight} />}
      </dl>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">
        {value}
        {note && <span className="stat-note">{note}</span>}
      </dd>
    </div>
  );
}
