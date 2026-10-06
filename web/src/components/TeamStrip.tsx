import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { TeamView } from '../api/types';
import { milestoneBanner, nextMilestone, nextMilestoneLabel, todayMilestone } from '../lib/milestones';
import { ringArc, ringDescription } from '../lib/ring';

const RING_SIZE = 64;
const RING_STROKE = 6;

/**
 * Team ring (T13): a part-of-whole meter. One hue, a lighter track of the same hue, the
 * number in the middle in text ink. Decorative only (`aria-hidden`); the strip's text and
 * the ring's own aria-label carry the numbers.
 */
export function TeamRing({ done, target, label, size = RING_SIZE }: { done: number; target: number; label?: string; size?: number }) {
  const arc = ringArc(done, target, size, RING_STROKE);
  const c = size / 2;
  return (
    <div className="team-ring" style={{ width: size, height: size }}>
      <svg
        className="team-ring-svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={label ?? ringDescription(done, target)}
      >
        <circle className="team-ring-track" cx={c} cy={c} r={arc.radius} strokeWidth={RING_STROKE} />
        <circle
          className="team-ring-fill"
          cx={c}
          cy={c}
          r={arc.radius}
          strokeWidth={RING_STROKE}
          strokeDasharray={arc.dashArray}
          strokeDashoffset={arc.dashOffset}
          transform={`rotate(-90 ${c} ${c})`}
          data-full={arc.fraction >= 1}
        />
      </svg>
      <div className="team-ring-number" aria-hidden="true">
        <span className="team-ring-done">{done}</span>
        <span className="team-ring-target">/ {target}</span>
      </div>
    </div>
  );
}

/**
 * Compact strip between the header and the cards on the today screen: ring, "Team days
 * logged", and the next milestone (or a celebratory banner on a milestone day).
 * Fails quietly: a missing `/api/team` just hides the strip.
 */
export function TeamStrip() {
  const [team, setTeam] = useState<TeamView | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .team()
      .then((t) => {
        if (!cancelled) setTeam(t);
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof ApiError && err.status === 401)) return;
        setTeam(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!team) return <div className="team-strip team-strip-placeholder" aria-hidden="true" />;

  const celebrating = todayMilestone(team.milestones);
  const next = nextMilestone(team.milestones, team.day);
  const perUser = team.perUser.map((u) => `${u.isMe ? 'You' : u.name} ${u.checkins}`).join(' · ');

  return (
    <section className="team-strip" data-celebrate={celebrating !== null} aria-label="Team progress">
      <TeamRing done={team.ring.done} target={team.ring.target} />
      <div className="team-text">
        <span className="team-label">
          Team days logged
          <span className="team-per-user"> · {perUser}</span>
        </span>
        {celebrating ? (
          <strong className="team-banner" role="status">
            {milestoneBanner(celebrating)}
          </strong>
        ) : next ? (
          <span className="team-next">
            <span className="team-next-label">{next.milestone.label}</span>
            <span className="team-next-when"> · {nextMilestoneLabel(next)}</span>
          </span>
        ) : (
          <span className="team-next">Every milestone reached</span>
        )}
      </div>
    </section>
  );
}
