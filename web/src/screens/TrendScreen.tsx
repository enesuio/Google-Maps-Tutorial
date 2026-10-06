import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, ApiError, describeError } from '../api/client';
import type { Measurements, MetricPoint, MetricsSeries, MetricsView, PutMetricsBody } from '../api/types';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { Toast } from '../components/Toast';
import { WeightChart } from '../components/WeightChart';
import { formatCm, formatKg } from '../lib/chart';
import { daysBetween, formatLongDate, isValidISODate } from '../lib/dates';
import { parseNumberInput } from '../lib/goals';

/** Weight & waist trend (T10): one chart per person, never overlaid or compared. */
export function TrendScreen() {
  const [view, setView] = useState<MetricsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null); // entry date; null = today
  const [pickPast, setPickPast] = useState(false);
  const [inflight, setInflight] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const dateInputId = useId();
  const shareId = useId();
  const moreId = useId();

  useEffect(() => {
    let cancelled = false;
    api
      .metrics()
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

  const prevInflight = useRef(0);
  useEffect(() => {
    if (prevInflight.current > 0 && inflight === 0) {
      setSavedFlash(true);
      const t = setTimeout(() => setSavedFlash(false), 1500);
      prevInflight.current = inflight;
      return () => clearTimeout(t);
    }
    prevInflight.current = inflight;
    return undefined;
  }, [inflight]);

  const me = view?.series.find((s) => s.isMe) ?? null;
  const partner = view?.series.find((s) => !s.isMe) ?? null;
  const today = view?.today ?? null;
  const entryDate = date ?? today;
  const todayDay = view ? daysBetween(view.challenge.startDate, view.today) + 1 : null;
  const entryPoint: MetricPoint | null =
    me && entryDate ? (me.points.find((p) => p.date === entryDate) ?? null) : null;

  const save = useCallback(
    async (body: PutMetricsBody) => {
      if (!entryDate) return;
      setInflight((n) => n + 1);
      setSavedFlash(false);
      try {
        const next = await api.putMetrics(entryDate, body);
        setView(next);
      } catch (err: unknown) {
        if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
      } finally {
        setInflight((n) => n - 1);
      }
    },
    [entryDate],
  );

  async function setSharing(shared: boolean) {
    if (sharingBusy || !view) return;
    setSharingBusy(true);
    const previous = view;
    setView({ ...view, series: view.series.map((s) => (s.isMe ? { ...s, shared } : s)) });
    try {
      setView(await api.putMetricsSharing({ shared }));
    } catch (err: unknown) {
      setView(previous);
      if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
    } finally {
      setSharingBusy(false);
    }
  }

  const status = inflight > 0 ? 'Saving…' : savedFlash ? 'Saved' : null;
  const entryDay = view && entryDate ? daysBetween(view.challenge.startDate, entryDate) + 1 : null;

  return (
    <div className="app">
      <Header day={todayDay} lengthDays={view?.challenge.lengthDays ?? null} />
      <main className="main">
        <h1 className="page-title">Trend</h1>
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
        {view && me && today && entryDate && (
          <div className="cards trend-cards">
            {/* ---- entry ---- */}
            <section className="card card-me" aria-labelledby="entry-title">
              <header className="card-header">
                <div className="card-title-wrap">
                  <h2 className="card-title" id="entry-title">
                    {entryDate === today ? 'Today' : formatLongDate(entryDate)}
                  </h2>
                  {entryDay !== null && <span className="card-subtitle">Day {entryDay}</span>}
                </div>
                <div className="card-right">
                  <button
                    type="button"
                    className="link-button entry-past"
                    aria-expanded={pickPast}
                    aria-controls={dateInputId}
                    onClick={() => {
                      if (pickPast) {
                        setPickPast(false);
                        setDate(null);
                      } else setPickPast(true);
                    }}
                  >
                    {pickPast ? 'Back to today' : 'Log a past day'}
                  </button>
                  <span className="save-status" aria-live="polite">
                    {status ?? ''}
                  </span>
                </div>
              </header>
              {pickPast && (
                <div className="entry-date-row">
                  <label htmlFor={dateInputId}>Day to log</label>
                  <input
                    id={dateInputId}
                    type="date"
                    className="date-input"
                    min={view.challenge.startDate}
                    max={today}
                    value={entryDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!isValidISODate(v)) return;
                      if (v < view.challenge.startDate || v > today) return;
                      setDate(v === today ? null : v);
                    }}
                  />
                </div>
              )}
              <ul className="goal-list">
                <MetricRow
                  key={`w-${entryDate}`}
                  label="Weight"
                  unit="kg"
                  value={entryPoint?.weightKg ?? null}
                  min={20}
                  max={400}
                  onCommit={(v) => void save({ weightKg: v })}
                />
                <MetricRow
                  key={`c-${entryDate}`}
                  label="Waist"
                  unit="cm"
                  value={entryPoint?.waistCm ?? null}
                  min={30}
                  max={250}
                  onCommit={(v) => void save({ waistCm: v })}
                />
              </ul>
              <button
                type="button"
                className="link-button more-toggle"
                aria-expanded={moreOpen}
                aria-controls={moreId}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <svg className="more-chevron" data-open={moreOpen} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                More measurements
              </button>
              {moreOpen && (
                <ul className="goal-list" id={moreId}>
                  {MEASUREMENTS.filter((m) => m.key !== 'waistCm').map((m) => (
                    <MetricRow
                      key={`${m.key}-${entryDate}`}
                      label={m.label}
                      unit="cm"
                      value={entryPoint?.[m.key] ?? null}
                      min={30}
                      max={250}
                      onCommit={(v) => void save({ [m.key]: v })}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* ---- my trend ---- */}
            <SeriesCard series={me} startDate={view.challenge.startDate} today={today} title="You" partnerName={partner?.name ?? null}>
              <div className="share-row">
                <label className="share-label" htmlFor={shareId}>
                  Share my trend with {partner?.name ?? 'my partner'}
                </label>
                <button
                  id={shareId}
                  type="button"
                  role="switch"
                  aria-checked={me.shared}
                  className="switch"
                  disabled={sharingBusy}
                  onClick={() => void setSharing(!me.shared)}
                >
                  <span className="switch-knob" />
                </button>
              </div>
            </SeriesCard>

            {/* ---- partner ---- */}
            {partner && <SeriesCard series={partner} startDate={view.challenge.startDate} today={today} title={partner.name} partnerName={null} />}
          </div>
        )}
      </main>
      <Footer current="trend" />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// ---- one person's card: numbers (own card only) + chart ----

interface SeriesCardProps {
  series: MetricsSeries;
  startDate: string;
  today: string;
  title: string;
  partnerName: string | null;
  children?: React.ReactNode;
}

function SeriesCard({ series, startDate, today, title, children }: SeriesCardProps) {
  const hasWeights = series.points.some((p) => p.weightKg !== null);
  const hasAny = series.points.length > 0;
  return (
    <section className={`card ${series.isMe ? 'card-me' : 'card-partner'}`} aria-labelledby={`trend-${series.userId}`}>
      <header className="card-header">
        <div className="card-title-wrap">
          <h2 className="card-title" id={`trend-${series.userId}`}>
            {title}
          </h2>
          {series.isMe && <span className="card-subtitle">{series.name}</span>}
        </div>
        {series.isMe && hasWeights && (
          <span className="trend-numbers">
            Start {formatKg(series.startWeightKg)} → latest {formatKg(series.latestWeightKg)}
          </span>
        )}
      </header>
      {!series.isMe && !series.shared ? (
        <p className="muted trend-private">{series.name} keeps her trend private.</p>
      ) : !hasAny ? (
        <p className="muted trend-private">
          {series.isMe ? 'No entries yet. Add today’s weight above and the trend will start here.' : `${series.name} hasn’t logged anything yet.`}
        </p>
      ) : (
        <WeightChart name={series.isMe ? 'you' : series.name} points={series.points} startDate={startDate} endDate={today} />
      )}
      {series.isMe && <MeasurementsTable start={series.start} latest={series.latest} />}
      {children}
    </section>
  );
}

// ---- measurements (T14): own card only ----

const MEASUREMENTS: Array<{ key: keyof Measurements; label: string }> = [
  { key: 'waistCm', label: 'Waist' },
  { key: 'hipsCm', label: 'Hips' },
  { key: 'chestCm', label: 'Chest' },
  { key: 'armCm', label: 'Arm' },
  { key: 'thighCm', label: 'Thigh' },
];

/** "Start → latest" for each measurement with at least one value. Never rendered for the partner. */
function MeasurementsTable({ start, latest }: { start: Measurements | null; latest: Measurements | null }) {
  if (!start || !latest) return null;
  const rows = MEASUREMENTS.filter((m) => start[m.key] !== null || latest[m.key] !== null);
  if (rows.length === 0) return null;
  return (
    <table className="measure-table">
      <caption className="measure-caption">Measurements · start → latest</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Measurement</th>
          <th scope="col">Start</th>
          <th scope="col">Latest</th>
          <th scope="col">Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const a = start[m.key];
          const b = latest[m.key];
          const delta = a !== null && b !== null ? Math.round((b - a) * 10) / 10 : null;
          return (
            <tr key={m.key}>
              <th scope="row">{m.label}</th>
              <td>{formatCm(a)}</td>
              <td className="measure-arrow" aria-hidden="true">
                →
              </td>
              <td>{formatCm(b)}</td>
              <td className="measure-delta">
                {delta === null ? '' : delta === 0 ? '±0' : `${delta < 0 ? '−' : '+'}${Math.abs(delta)} cm`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- decimal entry row, saves on blur / Enter (same feel as GoalRow numbers) ----

interface MetricRowProps {
  label: string;
  unit: string;
  value: number | null;
  min: number;
  max: number;
  onCommit: (value: number | null) => void;
}

function toText(v: number | null): string {
  return v === null ? '' : String(Math.round(v * 10) / 10);
}

function MetricRow({ label, unit, value, min, max, onCommit }: MetricRowProps) {
  const id = useId();
  const focused = useRef(false);
  const [text, setText] = useState(() => toText(value));
  const [seen, setSeen] = useState(value);
  const [invalid, setInvalid] = useState<string | null>(null);
  if (value !== seen) {
    setSeen(value);
    if (!focused.current) setText(toText(value));
  }

  function commit() {
    const parsed = parseNumberInput(text);
    if (parsed === undefined) {
      setText(toText(value));
      return;
    }
    if (parsed !== null && (parsed < min || parsed > max)) {
      setInvalid(`Enter ${min}–${max} ${unit}`);
      setText(toText(value));
      return;
    }
    setInvalid(null);
    if (parsed === value) {
      setText(toText(value));
      return;
    }
    onCommit(parsed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setText(toText(value));
      e.currentTarget.blur();
    }
  }

  return (
    <li className="goal-row goal-number">
      <label className="goal-text" htmlFor={id}>
        <span className="goal-label">{label}</span>
        <span className="goal-meta">{invalid ?? (value === null ? 'Not entered' : '')}</span>
      </label>
      <div className="goal-value">
        <input
          id={id}
          className="number-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="–"
          value={text}
          aria-label={`${label} in ${unit}`}
          aria-invalid={invalid !== null}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => {
            setText(e.target.value);
            setInvalid(null);
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={onKeyDown}
        />
        <span className="unit">{unit}</span>
      </div>
    </li>
  );
}
