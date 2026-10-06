import type { UserDayView } from '../api/types';
import { summarize, summaryLabel } from '../lib/goals';
import { healthLine } from '../lib/health';
import { CheerBar, CheerChips } from './Cheers';
import { GoalRow } from './GoalRow';
import { StreakBadge } from './StreakBadge';

interface Props {
  user: UserDayView;
  editable: boolean;
  onChange?: (goalId: number, value: number | null) => void;
  /** "Saving…" / "Saved" / null */
  status?: string | null;
  /** The signed-in user's id (to tell "from you" apart and allow deleting own cheers). */
  meId: number;
  nameOf: (userId: number) => string;
  /** Partner card only: send a cheer to this user. */
  onCheer?: (emoji: string, note: string | null) => void;
  onDeleteCheer?: (id: number) => void;
}

export function UserCard({ user, editable, onChange, status = null, meId, nameOf, onCheer, onDeleteCheer }: Props) {
  const summary = summarize(user.goals);
  const title = user.isMe ? 'You' : user.name;
  const health = healthLine(user.health);

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
      {health && (
        <p className="health-line">
          <span className="sr-only">From Apple Health: </span>
          {health}
        </p>
      )}
      <StreakBadge streak={user.streak} totalCheckins={user.totalCheckins} />
      <CheerChips cheers={user.cheers} meId={meId} nameOf={nameOf} {...(onDeleteCheer ? { onDelete: onDeleteCheer } : {})} />
      {user.goals.length === 0 ? (
        <p className="muted card-empty">No goals yet.</p>
      ) : (
        <ul className="goal-list">
          {user.goals.map((g) => (
            <GoalRow key={g.id} goal={g} editable={editable} {...(onChange ? { onChange } : {})} />
          ))}
        </ul>
      )}
      {onCheer && !user.isMe && <CheerBar toName={user.name} onCheer={onCheer} />}
    </section>
  );
}
