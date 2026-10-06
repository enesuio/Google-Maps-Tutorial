import type { Streak } from '../api/types';
import { bestLabel, streakHint, streakLabel, totalCheckinsLabel } from '../lib/streaks';

interface Props {
  streak: Streak;
  totalCheckins: number;
}

/** Compact streak line for a card header: "🔥 5-day streak · best 9" + "12 days checked in". */
export function StreakBadge({ streak, totalCheckins }: Props) {
  const live = streak.current > 0;
  const best = bestLabel(streak);
  const hint = streakHint(streak);
  return (
    <div className="streak" data-live={live}>
      <div className="streak-row">
        <span className="streak-main">
          {live && <FlameIcon />}
          <span className="streak-label">{streakLabel(streak)}</span>
          {best && <span className="streak-best"> · {best}</span>}
        </span>
        <span className="streak-total">{totalCheckinsLabel(totalCheckins)}</span>
      </div>
      {hint && <div className="streak-hint">{hint}</div>}
    </div>
  );
}

function FlameIcon() {
  return (
    <svg className="flame" width="14" height="16" viewBox="0 0 14 16" aria-hidden="true" focusable="false">
      <path
        d="M7.2 0.6c0.4 2.6-1.1 3.9-2.4 5.2C3.4 7.2 2 8.6 2 11a5 5 0 0 0 10 0c0-2.1-0.9-3.6-2.1-5-0.2 1.2-0.8 1.9-1.6 2.3 0.3-2.4-0.3-5.3-1.1-7.7z"
        fill="currentColor"
      />
    </svg>
  );
}
