import { Link } from 'react-router-dom';
import { dayCounterLabel, formatLongDate } from '../lib/dates';

interface Props {
  /** Challenge day for the date shown (null while loading). */
  day: number | null;
  lengthDays: number | null;
  /** Set when viewing a day other than today (`/day/:date`). */
  editingDate?: string | null;
  /** Server today; used to tell "editing today" apart from editing a past day. */
  today?: string | null;
}

export function Header({ day, lengthDays, editingDate = null, today = null }: Props) {
  const counter = day !== null && lengthDays !== null ? dayCounterLabel(day, lengthDays) : null;
  const isPast = editingDate !== null && editingDate !== today;

  return (
    <header className="header">
      <div className="header-row">
        <Link to="/" className="brand" aria-label="Hydrox 45, today">
          Hydrox 45
        </Link>
        {counter && <span className="day-counter">{counter}</span>}
      </div>
      {isPast && editingDate && (
        <div className="header-sub">
          <span className="editing-label">Editing {formatLongDate(editingDate)}</span>
          <Link to="/history" className="back-link">
            ← Back to history
          </Link>
        </div>
      )}
      {editingDate !== null && !isPast && (
        <div className="header-sub">
          <span className="editing-label">Today</span>
          <Link to="/history" className="back-link">
            ← Back to history
          </Link>
        </div>
      )}
    </header>
  );
}
