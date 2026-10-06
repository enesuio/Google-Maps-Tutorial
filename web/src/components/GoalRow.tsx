import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { GoalView } from '../api/types';
import { formatNumber, formatValue, parseNumberInput, targetLabel, weeklyLabel } from '../lib/goals';
import { formatThousands } from '../lib/health';
import { StatusIcon } from './StatusIcon';

interface Props {
  goal: GoalView;
  editable: boolean;
  onChange?: (goalId: number, value: number | null) => void;
}

export function GoalRow({ goal, editable, onChange }: Props) {
  if (goal.source !== 'manual') return <AutoRow goal={goal} />;
  return goal.kind === 'bool' ? (
    <BoolRow goal={goal} editable={editable} {...(onChange ? { onChange } : {})} />
  ) : (
    <NumberRow goal={goal} editable={editable} {...(onChange ? { onChange } : {})} />
  );
}

function hitState(hit: boolean | null): string {
  return hit === null ? 'none' : hit ? 'hit' : 'miss';
}

function BoolRow({ goal, editable, onChange }: Props) {
  const done = goal.value === 1;
  const weekly = weeklyLabel(goal);
  const inner = (
    <>
      <StatusIcon hit={goal.hit} size={28} />
      <span className="goal-text">
        <span className="goal-label">{goal.label}</span>
        {weekly && <span className="goal-meta">{weekly}</span>}
      </span>
      <span className="goal-state">{done ? 'Done' : goal.value === null ? '' : 'Not yet'}</span>
    </>
  );

  if (!editable) {
    return (
      <li className="goal-row goal-bool readonly" data-hit={hitState(goal.hit)}>
        <div className="goal-toggle">
          {inner}
          <span className="sr-only">{formatValue(goal)}</span>
        </div>
      </li>
    );
  }

  return (
    <li className="goal-row goal-bool" data-hit={hitState(goal.hit)}>
      <button
        type="button"
        className="goal-toggle"
        aria-pressed={done}
        onClick={() => onChange?.(goal.id, done ? 0 : 1)}
      >
        {inner}
      </button>
    </li>
  );
}

/**
 * A goal filled from Apple Health (T11): read-only on both cards, no input, no toggle.
 * While the evening import has not arrived the value reads "waiting for tonight's import".
 */
function AutoRow({ goal }: { goal: GoalView }) {
  const target = targetLabel(goal);
  const waiting = goal.value === null;
  return (
    <li className="goal-row goal-number goal-auto" data-hit={hitState(goal.hit)}>
      <div className="goal-text">
        <span className="goal-label">{goal.label}</span>
        <span className="goal-meta">
          {target && <span className="goal-target">{target}</span>}
          <span className="goal-source">
            <HealthIcon />
            from Apple Health
          </span>
        </span>
      </div>
      <div className="goal-value">
        {waiting ? (
          <span className="goal-waiting">waiting for tonight's import</span>
        ) : (
          <>
            <span className="number-static">{goal.value === null ? '—' : formatThousands(goal.value)}</span>
            {goal.unit && <span className="unit">{goal.unit}</span>}
          </>
        )}
        <StatusIcon hit={goal.hit} />
      </div>
    </li>
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

function valueToText(value: number | null): string {
  return value === null ? '' : formatNumber(value);
}

function NumberRow({ goal, editable, onChange }: Props) {
  const id = useId();
  const target = targetLabel(goal);
  const weekly = weeklyLabel(goal);
  const focused = useRef(false);

  // Local text while typing; re-synced from the server value when not focused.
  const [text, setText] = useState(() => valueToText(goal.value));
  const [seenValue, setSeenValue] = useState(goal.value);
  if (goal.value !== seenValue) {
    setSeenValue(goal.value);
    if (!focused.current) setText(valueToText(goal.value));
  }

  function commit() {
    const parsed = parseNumberInput(text);
    if (parsed === undefined) {
      setText(valueToText(goal.value)); // not a number: revert
      return;
    }
    if (parsed === goal.value) {
      setText(valueToText(goal.value));
      return;
    }
    onChange?.(goal.id, parsed);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur(); // blur commits and closes the iOS keyboard
    } else if (e.key === 'Escape') {
      setText(valueToText(goal.value));
      e.currentTarget.blur();
    }
  }

  return (
    <li className="goal-row goal-number" data-hit={hitState(goal.hit)}>
      <label className="goal-text" htmlFor={editable ? id : undefined}>
        <span className="goal-label">{goal.label}</span>
        {(target || weekly) && (
          <span className="goal-meta">
            {target}
            {target && weekly ? ' · ' : ''}
            {weekly}
          </span>
        )}
      </label>
      <div className="goal-value">
        {editable ? (
          <input
            id={id}
            className="number-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="–"
            value={text}
            aria-label={`${goal.label}${goal.unit ? ` in ${goal.unit}` : ''}`}
            onFocus={() => {
              focused.current = true;
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              focused.current = false;
              commit();
            }}
            onKeyDown={onKeyDown}
          />
        ) : (
          <span className="number-static">{goal.value === null ? '—' : formatNumber(goal.value)}</span>
        )}
        {goal.unit && <span className="unit">{goal.unit}</span>}
        <StatusIcon hit={goal.hit} />
      </div>
    </li>
  );
}
