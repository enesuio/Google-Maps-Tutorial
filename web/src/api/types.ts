// Copied verbatim from docs/API.md ("Shared TypeScript types"). Change the contract there first.

export type GoalKind = "bool" | "number";
export type GoalDirection = "at_least" | "at_most";

export interface Challenge {
  name: string;
  startDate: string;     // YYYY-MM-DD
  lengthDays: number;    // 45
}

export interface GoalView {
  id: number;
  key: string;           // stable seed key, e.g. "kcal"
  label: string;         // "Calories"
  kind: GoalKind;
  unit: string | null;   // "kcal", "g", null for bool
  direction: GoalDirection | null; // number goals only
  dailyTarget: number | null;
  weeklyTarget: number | null;     // e.g. 3 for "3+ F45 classes a week"
  value: number | null;  // bool goals: 1 or 0; null = not entered
  hit: boolean | null;   // null when value is null
  weekCount: number | null; // weekly goals only: hits in the Mon–Sun week containing `date`
}

export interface UserDayView {
  id: number;
  slug: string;
  name: string;
  isMe: boolean;
  goals: GoalView[];     // active goals, ordered by sort
}

export interface DayView {
  date: string;          // the day shown
  day: number;           // challenge day number for `date`
  today: string;         // server's Toronto today
  challenge: Challenge;
  users: UserDayView[];  // me first, then partner
}

export interface HistoryDay {
  date: string;
  day: number;
  users: Array<{ userId: number; hit: number; total: number; entered: boolean }>;
}

export interface HistoryView {
  challenge: Challenge;
  today: string;
  users: Array<{ id: number; slug: string; name: string; isMe: boolean }>;
  days: HistoryDay[];    // newest first, from startDate to today only
}

export interface CheckinEntry {
  goalId: number;
  value: number | boolean | null; // null clears the entry; booleans stored as 1/0
}

export interface PutCheckinsBody {
  entries: CheckinEntry[];
}

export interface Me {
  user: { id: number; slug: string; name: string };
}
