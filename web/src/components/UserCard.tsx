import type { UserDayView } from '../api/types';
import { summarize, summaryLabel } from '../lib/goals';
import { GoalRow } from './GoalRow';

interface Props {
  user: UserDayView;
  editable: boolean;
  onChange?: (goalId: number, value: number | null) => void;
  /** "Saving…" / "Saved" / null */
  status?: string | null;
}

export function UserCard({ user, editable, onChange, status = null }: Props) {
  const summary = summarize(user.goals);
  const title = user.isMe ? 'You' : user.name;

  return (
    <section className={`card ${user.isMe ? 'card-me' : 'card-partner'}`} aria-labelledby={`card-${user.id}`}>
      <header className="card-header">
        <div className="card-title-wrap">
          <h2 className="card-title" id={`card-${user.id}`}>
            {title}
          </h2>
          {user.isMe && <span className="card-subtitle">{user.name}</span>}
          {!user.isMe && user.name !== 'Partner' && <span className="card-subtitle">Partner</span>}
        </div>
        <div className="card-right">
          <span className="card-summary" data-complete={summary.hit === summary.total && summary.total > 0}>
            {summaryLabel(summary)}
          </span>
          {editable && (
            <span className="save-status" aria-live="polite">
              {status ?? ''}
            </span>
          )}
        </div>
      </header>
      {user.goals.length === 0 ? (
        <p className="muted card-empty">No goals yet.</p>
      ) : (
        <ul className="goal-list">
          {user.goals.map((g) => (
            <GoalRow key={g.id} goal={g} editable={editable} {...(onChange ? { onChange } : {})} />
          ))}
        </ul>
      )}
    </section>
  );
}
