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
  streak: Streak;        // Phase 2 (T9)
  totalCheckins: number; // Phase 2 (T9): checked-in days since startDate
  cheers: Cheer[];       // Phase 2 (T8): cheers received by this user for `date`, oldest first
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

// ---- Phase 2 additions (T6–T10), copied verbatim from docs/API.md ----

export interface Streak {
  current: number;
  best: number;
  graceUsed: boolean;   // true when the most recent day before today was missed (one more miss breaks it)
}

export interface Cheer {
  id: number;
  fromUserId: number;
  toUserId: number;
  date: string;          // the day the cheer is about
  emoji: string;         // one of the allowed set
  note: string | null;   // ≤ 140 chars
  createdAt: string;     // ISO timestamp
}
export const CHEER_EMOJI = ["👏", "🔥", "💪", "❤️", "😂", "🫡"] as const;
export interface PostCheerBody { toUserId: number; date: string; emoji: string; note?: string }

export interface MetricPoint {
  date: string;
  weightKg: number | null;
  waistCm: number | null;
  weightAvg7: number | null; // mean of the entered weights in the 7 days ending on `date` (inclusive); null when none
}
export interface MetricsSeries {
  userId: number; name: string; isMe: boolean;
  shared: boolean;           // the user's metrics_shared flag
  points: MetricPoint[];     // one per entered date, ascending; partner's series is [] when not shared
  latestWeightKg: number | null;
  startWeightKg: number | null; // earliest entry since startDate
}
export interface MetricsView { challenge: Challenge; today: string; series: MetricsSeries[] }
export interface PutMetricsBody { weightKg?: number | null; waistCm?: number | null } // null clears
export interface PutMetricsSharingBody { shared: boolean }

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushStatus { enabled: boolean; publicKey: string | null; subscribed: boolean }
