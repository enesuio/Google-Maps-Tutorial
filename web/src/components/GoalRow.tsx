import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { GoalView } from '../api/types';
import { formatNumber, formatValue, parseNumberInput, targetLabel, weeklyLabel } from '../lib/goals';
import { StatusIcon } from './StatusIcon';

interface Props {
  goal: GoalView;
  editable: boolean;
  onChange?: (goalId: number, value: number | null) => void;
}

export function GoalRow({ goal, editable, onChange }: Props) {
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
