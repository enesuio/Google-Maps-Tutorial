import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, describeError, EXPORTS } from '../api/client';
import type { FinishTest, GoalSummary, Photo, SummaryView, UserSummary } from '../api/types';
import { Header } from '../components/Header';
import { TeamRing } from '../components/TeamStrip';
import { Toast } from '../components/Toast';
import { formatShortDate, isValidISODate } from '../lib/dates';
import { ringFraction } from '../lib/ring';
import {
  bestWeekLabel,
  bodyRows,
  cheersSummaryParts,
  FINISH_TEST_LABEL_MAX,
  FINISH_TEST_RESULT_MAX,
  FINISH_TESTS_MAX,
  finishTestState,
  finishTestStatus,
  goalDetail,
  goalHitLabel,
  stepsLabel,
  streakDays,
  summaryHeading,
  teamDaysLabel,
  userDaysLabel,
} from '../lib/summary';

/**
 * Day 45 summary (T15) and export (T16). "So far" from Day 1, final once `complete`.
 * Team first, then one card per person (me first). Body numbers and photos only on my own
 * card; finish-line tests on both, editable only on mine. Never a ranking.
 */
export function SummaryScreen() {
  const [view, setView] = useState<SummaryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [open, setOpen] = useState<{ photo: Photo; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .summary()
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

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  /** Replace one user's finish tests (optimistic updates and server replies both land here). */
  const setTests = useCallback((userId: number, fn: (tests: FinishTest[]) => FinishTest[]) => {
    setView((v) => (v ? { ...v, users: v.users.map((u) => (u.userId === userId ? { ...u, finishTests: fn(u.finishTests) } : u)) } : v));
  }, []);

  const fail = useCallback((err: unknown) => {
    if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
  }, []);

  const heading = view ? summaryHeading(view) : null;

  return (
    <div className="app">
      <Header day={view?.day ?? null} lengthDays={view?.challenge.lengthDays ?? null} />
      <main className="main">
        <div className="summary-head" data-complete={view?.complete ?? false}>
          <h1 className="page-title">{heading?.title ?? 'Summary'}</h1>
          {heading && <p className="summary-sub">{heading.sub}</p>}
        </div>
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
        {view && (
          <>
            <TeamBlock view={view} />
            <div className="cards summary-cards">
              {view.users.map((u) => (
                <PersonCard
                  key={u.userId}
                  user={u}
                  view={view}
                  onTests={(fn) => setTests(u.userId, fn)}
                  onError={fail}
                  onOpenPhoto={(photo, title) => setOpen({ photo, title })}
                />
              ))}
            </div>
            <ExportSection />
          </>
        )}
      </main>
      <Toast message={toast} onDismiss={() => setToast(null)} />
      {open && <Lightbox photo={open.photo} title={open.title} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---- team ----

function TeamBlock({ view }: { view: SummaryView }) {
  const { team } = view;
  const fraction = ringFraction(team.checkins, team.possible);
  const best = bestWeekLabel(team.bestWeek);
  return (
    <section className="card summary-team" aria-labelledby="team-title">
      <header className="card-header">
        <h2 className="card-title" id="team-title">
          Together
        </h2>
        <span className="card-subtitle">{view.users.map((u) => (u.isMe ? 'You' : u.name)).join(' and ')}</span>
      </header>
      <p className="team-hero">
        <span className="team-hero-number">{team.checkins}</span>
        <span className="team-hero-of">of {team.possible} days checked in</span>
      </p>
      <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={team.possible} aria-valuenow={team.checkins} aria-label={`${teamDaysLabel(team)} checked in together`}>
        <span className="meter-fill" style={{ width: `${Math.round(fraction * 1000) / 10}%` }} data-full={fraction >= 1} />
      </div>
      <dl className="stat-grid team-grid">
        <Stat label="Cheers exchanged" value={String(team.cheers)} />
        <Stat label="Best week" value={best ? best.split(' · ')[0] ?? best : 'not yet'} note={best ? best.split(' · ')[1] : undefined} />
      </dl>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
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

// ---- one person ----

interface PersonProps {
  user: UserSummary;
  view: SummaryView;
  onTests: (fn: (tests: FinishTest[]) => FinishTest[]) => void;
  onError: (err: unknown) => void;
  onOpenPhoto: (photo: Photo, title: string) => void;
}

function PersonCard({ user, view, onTests, onError, onOpenPhoto }: PersonProps) {
  const title = user.isMe ? 'You' : user.name;
  const steps = stepsLabel(user.steps);
  const days = userDaysLabel(user);
  const rows = user.isMe ? bodyRows(user.body) : [];
  const photos = user.isMe ? user.photos : null;
  const showPhotos = photos !== null && (photos.start !== null || photos.end !== null);

  return (
    <section className={`card summary-card ${user.isMe ? 'card-me' : 'card-partner'}`} aria-labelledby={`sum-${user.userId}`}>
      <header className="card-header">
        <div className="card-title-wrap">
          <h2 className="card-title" id={`sum-${user.userId}`}>
            {title}
          </h2>
          {user.isMe && <span className="card-subtitle">{user.name}</span>}
        </div>
      </header>

      <div className="summary-top">
        <TeamRing done={user.daysCheckedIn} target={user.daysSoFar} size={72} label={`${days} checked in`} />
        <div className="summary-top-text">
          <span className="summary-days">
            {days} <small>checked in</small>
          </span>
          <span className="summary-goals-hit">
            Goals hit {user.goalsHit} of {user.goalsTotal}
          </span>
        </div>
      </div>

      <dl className="stat-grid">
        <Stat label="Best streak" value={streakDays(user.bestStreak)} />
        <Stat label="Current streak" value={streakDays(user.currentStreak)} />
        <Stat label="Cheers" value={cheersSummaryParts(user).received} note={cheersSummaryParts(user).sent} />
        {steps && <Stat label="Steps" value={steps.total} note={steps.note || undefined} />}
      </dl>

      <GoalTable goals={user.goals} />

      {user.isMe && rows.length > 0 && (
        <section className="summary-section" aria-labelledby={`body-${user.userId}`}>
          <div className="section-head">
            <h3 className="section-title" id={`body-${user.userId}`}>
              Before → after
            </h3>
            <span className="private-tag">
              <LockIcon />
              Only you can see this
            </span>
          </div>
          <table className="measure-table body-table">
            <thead className="sr-only">
              <tr>
                <th scope="col">Measure</th>
                <th scope="col">Start</th>
                <th scope="col">Latest</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td>{r.start}</td>
                  <td className="measure-arrow" aria-hidden="true">
                    →
                  </td>
                  <td>{r.latest}</td>
                  <td className="measure-delta">{r.change ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {showPhotos && photos && (
        <section className="summary-section" aria-labelledby={`photos-${user.userId}`}>
          <div className="section-head">
            <h3 className="section-title" id={`photos-${user.userId}`}>
              Start and Day {view.challenge.lengthDays}
            </h3>
            <span className="private-tag">
              <LockIcon />
              Only you can see this
            </span>
          </div>
          <div className="compare-row">
            <PhotoCell photo={photos.start} label="Day 1" onOpen={onOpenPhoto} />
            <PhotoCell photo={photos.end} label={`Day ${view.challenge.lengthDays}`} onOpen={onOpenPhoto} />
          </div>
        </section>
      )}

      <FinishTests user={user} view={view} onTests={onTests} onError={onError} />
    </section>
  );
}

function GoalTable({ goals }: { goals: GoalSummary[] }) {
  if (goals.length === 0) return <p className="muted card-empty">No goals yet.</p>;
  return (
    <table className="summary-table">
      <caption className="sr-only">Goals, hit days over entered days</caption>
      <thead>
        <tr>
          <th scope="col">Goal</th>
          <th scope="col">Hit / entered</th>
          <th scope="col">
            <span className="sr-only">Detail</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {goals.map((g) => (
          <tr key={g.goalId}>
            <th scope="row">
              {g.label}
              {g.source !== 'manual' && (
                <span className="goal-source">
                  <HealthIcon />
                  Apple Health
                </span>
              )}
            </th>
            <td>{goalHitLabel(g)}</td>
            <td>{goalDetail(g)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PhotoCell({ photo, label, onOpen }: { photo: Photo | null; label: string; onOpen: (p: Photo, title: string) => void }) {
  if (!photo) {
    return (
      <Link to="/photos" className="compare-cell compare-empty">
        <span className="compare-empty-text">
          No {label} photo yet
          <span className="muted">Add it on Photos</span>
        </span>
      </Link>
    );
  }
  const title = `${label} · ${formatShortDate(photo.date)}`;
  return (
    <button type="button" className="compare-cell" onClick={() => onOpen(photo, title)}>
      <img src={photo.url} alt={title} loading="lazy" />
      <span className="compare-caption">
        <strong>{label}</strong>
        <span className="muted"> · {formatShortDate(photo.date)}</span>
      </span>
    </button>
  );
}

// ---- finish-line tests ----

interface TestsProps {
  user: UserSummary;
  view: SummaryView;
  onTests: (fn: (tests: FinishTest[]) => FinishTest[]) => void;
  onError: (err: unknown) => void;
}

function FinishTests({ user, view, onTests, onError }: TestsProps) {
  const own = user.isMe;
  const tests = user.finishTests;
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const labelId = useId();
  const labelInput = useRef<HTMLInputElement>(null);
  const trimmed = label.trim();
  const tooLong = trimmed.length > FINISH_TEST_LABEL_MAX;

  useEffect(() => {
    if (adding) labelInput.current?.focus();
  }, [adding]);

  async function save(test: FinishTest, patch: Partial<Pick<FinishTest, 'passed' | 'result' | 'testedOn'>>) {
    const next: FinishTest = { ...test, ...patch };
    // A result needs a date: default to today the first time Passed / Not this time is chosen.
    if (next.passed !== null && next.testedOn === null) next.testedOn = view.today;
    if (next.passed === test.passed && next.result === test.result && next.testedOn === test.testedOn) return;
    onTests((ts) => ts.map((t) => (t.id === test.id ? next : t)));
    try {
      const saved = await api.putFinishTest(test.id, { passed: next.passed, result: next.result, testedOn: next.testedOn });
      onTests((ts) => ts.map((t) => (t.id === test.id ? saved : t)));
    } catch (err: unknown) {
      onTests((ts) => ts.map((t) => (t.id === test.id ? test : t)));
      onError(err);
    }
  }

  async function remove(test: FinishTest) {
    if (!window.confirm(`Delete the test “${test.label}”?`)) return;
    onTests((ts) => ts.filter((t) => t.id !== test.id));
    try {
      await api.deleteFinishTest(test.id);
    } catch (err: unknown) {
      onTests((ts) => [...ts, test]);
      onError(err);
    }
  }

  async function add() {
    if (busy || !trimmed || tooLong) return;
    setBusy(true);
    try {
      const created = await api.postFinishTest({ label: trimmed });
      onTests((ts) => [...ts, created]);
      setLabel('');
      setAdding(false);
    } catch (err: unknown) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  function onLabelKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void add();
    } else if (e.key === 'Escape') {
      setAdding(false);
      setLabel('');
    }
  }

  return (
    <section className="summary-section tests" aria-labelledby={`tests-${user.userId}`}>
      <div className="section-head">
        <h3 className="section-title" id={`tests-${user.userId}`}>
          Finish-line tests
        </h3>
        {own && !adding && tests.length < FINISH_TESTS_MAX && (
          <button type="button" className="link-button tests-add" onClick={() => setAdding(true)}>
            Add a test
          </button>
        )}
      </div>
      {tests.length === 0 && !adding && (
        <p className="muted tests-empty">
          {own
            ? `Something you couldn't do on Day 1, tested on Day ${view.challenge.lengthDays}.`
            : `${user.name} hasn't added a test yet.`}
        </p>
      )}
      {tests.length > 0 && (
        <ul className="test-list">
          {tests.map((t) =>
            own ? (
              <OwnTest key={t.id} test={t} min={view.challenge.startDate} max={view.today} onSave={(patch) => void save(t, patch)} onDelete={() => void remove(t)} />
            ) : (
              <li key={t.id} className="test" data-state={finishTestState(t.passed)}>
                <div className="test-head">
                  <span className="test-label">{t.label}</span>
                </div>
                <p className="test-status">{finishTestStatus(t)}</p>
              </li>
            ),
          )}
        </ul>
      )}
      {own && adding && (
        <form
          className="add-test"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="sr-only" htmlFor={labelId}>
            Name of the test
          </label>
          <input
            ref={labelInput}
            id={labelId}
            className="text-input"
            type="text"
            placeholder="e.g. 10 push-ups"
            maxLength={FINISH_TEST_LABEL_MAX + 10}
            value={label}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={tooLong}
            aria-describedby={`${labelId}-hint`}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={onLabelKey}
            disabled={busy}
          />
          <button type="submit" className="button" disabled={busy || !trimmed || tooLong}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setAdding(false);
              setLabel('');
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <p className="tests-hint muted" id={`${labelId}-hint`} data-over={tooLong}>
            {tooLong ? `Keep it under ${FINISH_TEST_LABEL_MAX} characters.` : `Up to ${FINISH_TESTS_MAX} tests · ${trimmed.length}/${FINISH_TEST_LABEL_MAX}`}
          </p>
        </form>
      )}
      {own && !adding && tests.length >= FINISH_TESTS_MAX && <p className="tests-hint muted">That's the full set of {FINISH_TESTS_MAX}.</p>}
    </section>
  );
}

interface OwnTestProps {
  test: FinishTest;
  min: string;
  max: string;
  onSave: (patch: Partial<Pick<FinishTest, 'passed' | 'result' | 'testedOn'>>) => void;
  onDelete: () => void;
}

const STATES: ReadonlyArray<{ passed: boolean | null; label: string; tone: string }> = [
  { passed: null, label: 'Not yet', tone: 'pending' },
  { passed: true, label: 'Passed', tone: 'passed' },
  { passed: false, label: 'Not this time', tone: 'failed' },
];

function OwnTest({ test, min, max, onSave, onDelete }: OwnTestProps) {
  const resultId = useId();
  const dateId = useId();
  const [result, setResult] = useState(test.result ?? '');
  const [seen, setSeen] = useState(test.result);
  const focused = useRef(false);
  if (test.result !== seen) {
    setSeen(test.result);
    if (!focused.current) setResult(test.result ?? '');
  }
  const trimmed = result.trim();
  const tooLong = trimmed.length > FINISH_TEST_RESULT_MAX;

  function commitResult() {
    if (tooLong) return;
    const value = trimmed ? trimmed : null;
    if (value !== test.result) onSave({ result: value });
  }

  return (
    <li className="test" data-state={finishTestState(test.passed)}>
      <div className="test-head">
        <span className="test-label">{test.label}</span>
        <button type="button" className="link-button test-delete" onClick={onDelete} aria-label={`Delete the test ${test.label}`}>
          Delete
        </button>
      </div>
      <div className="segmented segmented-tests" role="group" aria-label={`${test.label}: result`}>
        {STATES.map((s) => (
          <button
            key={s.label}
            type="button"
            className="segment"
            data-tone={s.tone}
            aria-pressed={test.passed === s.passed}
            onClick={() => onSave({ passed: s.passed })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="test-fields">
        <div className="test-field">
          <label className="sheet-label" htmlFor={resultId}>
            Result
          </label>
          <input
            id={resultId}
            className="text-input"
            type="text"
            placeholder="e.g. 2 push-ups"
            maxLength={FINISH_TEST_RESULT_MAX + 10}
            value={result}
            autoComplete="off"
            enterKeyHint="done"
            aria-invalid={tooLong}
            onFocus={() => {
              focused.current = true;
            }}
            onChange={(e) => setResult(e.target.value)}
            onBlur={() => {
              focused.current = false;
              commitResult();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <div className="test-field">
          <label className="sheet-label" htmlFor={dateId}>
            Tested on
          </label>
          <input
            id={dateId}
            type="date"
            className="date-input"
            min={min}
            max={max}
            value={test.testedOn ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') onSave({ testedOn: null });
              else if (isValidISODate(v) && v >= min && v <= max) onSave({ testedOn: v });
            }}
          />
        </div>
      </div>
      {tooLong && (
        <p className="tests-hint muted" data-over="true" role="alert">
          Keep the result under {FINISH_TEST_RESULT_MAX} characters.
        </p>
      )}
      <p className="test-status" aria-live="polite">
        {finishTestStatus(test)}
      </p>
    </li>
  );
}

// ---- export (T16) ----

function ExportSection() {
  return (
    <section className="card export" aria-labelledby="export-title">
      <header className="card-header">
        <h2 className="card-title settings-title" id="export-title">
          Export your data
        </h2>
      </header>
      <p className="muted export-intro">Downloads, so the data outlives the challenge.</p>
      <ul className="export-list">
        {EXPORTS.map((e) => (
          <li key={e.href}>
            <a href={e.href} download className="export-link">
              <DownloadIcon />
              <span className="export-text">
                <span className="export-label">{e.label}</span>
                <span className="export-detail">{e.detail}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="muted export-note">
        Photos are not bundled. Save each one from the <Link to="/photos">Photos</Link> screen.
      </p>
    </section>
  );
}

// ---- lightbox for the start / end photos ----

function Lightbox({ photo, title, onClose }: { photo: Photo; title: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="viewer-bar">
        <div className="viewer-title" id={titleId}>
          <strong>{title}</strong>
          <span className="viewer-kind">Only you can see this</span>
        </div>
        <button ref={closeRef} type="button" className="viewer-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="viewer-stage" onClick={onClose}>
        <img className="viewer-img" src={photo.url} alt={title} onClick={(e) => e.stopPropagation()} />
      </div>
      <div className="viewer-actions">
        <Link to="/photos" className="link-button viewer-link">
          Open Photos
        </Link>
      </div>
    </div>
  );
}

// ---- icons ----

function LockIcon() {
  return (
    <svg width="11" height="12" viewBox="0 0 24 26" aria-hidden="true" focusable="false">
      <rect x="4" y="11" width="16" height="13" rx="2.5" fill="currentColor" />
      <path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg className="health-icon" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 21s-7.5-4.6-9.6-9.4C.9 8.2 3 4.5 6.8 4.5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.8 0 5.9 3.7 4.4 7.1C19.5 16.4 12 21 12 21z"
        fill="currentColor"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="export-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11M7.5 10.5l4.5 4.5 4.5-4.5" />
      <path d="M4.5 17.5v1a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  );
}
