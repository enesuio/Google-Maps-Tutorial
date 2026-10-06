import type { DayView, GoalView } from '../api/types';

/** "≤ 1600 kcal" / "≥ 160 g" / null for bool goals or number goals without a target. */
export function targetLabel(goal: Pick<GoalView, 'kind' | 'direction' | 'dailyTarget' | 'unit'>): string | null {
  if (goal.kind !== 'number' || goal.dailyTarget === null) return null;
  const sign = goal.direction === 'at_most' ? '≤' : goal.direction === 'at_least' ? '≥' : '';
  const unit = goal.unit ? ` ${goal.unit}` : '';
  return `${sign ? `${sign} ` : ''}${formatNumber(goal.dailyTarget)}${unit}`;
}

/** "2 of 3 this week" for weekly goals; null otherwise. */
export function weeklyLabel(goal: Pick<GoalView, 'weeklyTarget' | 'weekCount'>): string | null {
  if (goal.weeklyTarget === null) return null;
  return `${goal.weekCount ?? 0} of ${formatNumber(goal.weeklyTarget)} this week`;
}

export interface Summary {
  hit: number;
  total: number;
  entered: number;
}

export function summarize(goals: ReadonlyArray<Pick<GoalView, 'hit' | 'value'>>): Summary {
  let hit = 0;
  let entered = 0;
  for (const g of goals) {
    if (g.hit === true) hit += 1;
    if (g.value !== null) entered += 1;
  }
  return { hit, total: goals.length, entered };
}

/** "3 of 4 hit" */
export function summaryLabel(s: Summary): string {
  return `${s.hit} of ${s.total} hit`;
}

export function formatNumber(n: number): string {
  // Up to 1 decimal, no trailing ".0", no thousands separator (matches how people type it).
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Display value for a goal, e.g. "1550 kcal" or "—". */
export function formatValue(goal: Pick<GoalView, 'kind' | 'value' | 'unit'>): string {
  if (goal.value === null) return '—';
  if (goal.kind === 'bool') return goal.value === 1 ? 'Done' : 'Not done';
  return goal.unit ? `${formatNumber(goal.value)} ${goal.unit}` : formatNumber(goal.value);
}

/**
 * Same `hit` rules as docs/API.md, used for optimistic updates before the server replies:
 * bool → value === 1; at_most → value <= target; at_least → value >= target; no target → entered.
 */
export function computeHit(
  goal: Pick<GoalView, 'kind' | 'direction' | 'dailyTarget'>,
  value: number | null,
): boolean | null {
  if (value === null) return null;
  if (goal.kind === 'bool') return value === 1;
  if (goal.dailyTarget === null) return true;
  if (goal.direction === 'at_most') return value <= goal.dailyTarget;
  if (goal.direction === 'at_least') return value >= goal.dailyTarget;
  return true;
}

/**
 * Parse what the user typed into a number input. Empty → null (clears the entry).
 * Accepts "1,550" style decimal commas. Returns `undefined` when not a number.
 */
export function parseNumberInput(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.?\d*$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/**
 * Return a new DayView with `goalId` for `userId` set to `value`, recomputing `hit`
 * locally and nudging `weekCount` for weekly goals. The server response replaces this.
 */
export function applyValue(view: DayView, userId: number, goalId: number, value: number | null): DayView {
  return {
    ...view,
    users: view.users.map((u) => {
      if (u.id !== userId) return u;
      return {
        ...u,
        goals: u.goals.map((g) => {
          if (g.id !== goalId) return g;
          const hit = computeHit(g, value);
          let weekCount = g.weekCount;
          if (g.weeklyTarget !== null && weekCount !== null) {
            const was = g.hit === true ? 1 : 0;
            const now = hit === true ? 1 : 0;
            weekCount = Math.max(0, weekCount - was + now);
          }
          return { ...g, value, hit, weekCount };
        }),
      };
    }),
  };
}

export function findGoal(view: DayView, userId: number, goalId: number): GoalView | undefined {
  return view.users.find((u) => u.id === userId)?.goals.find((g) => g.id === goalId);
}
