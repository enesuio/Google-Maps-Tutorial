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
  source: GoalSource;    // Phase 3 (T11): goals with source != manual are filled by the Health import
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
  health: HealthDay | null; // Phase 3 (T11): null when nothing imported for that date
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
  // Phase 3 (T14) measurements, same null-clears rule; ranges 30–250 cm
  hipsCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
}
/** Phase 3 (T14): latest non-null / earliest-since-start measurement of each kind. */
export interface Measurements {
  waistCm: number | null;
  hipsCm: number | null;
  chestCm: number | null;
  armCm: number | null;
  thighCm: number | null;
}
export interface MetricsSeries {
  userId: number; name: string; isMe: boolean;
  shared: boolean;           // the user's metrics_shared flag
  points: MetricPoint[];     // one per entered date, ascending; partner's series is [] when not shared
  latestWeightKg: number | null;
  startWeightKg: number | null; // earliest entry since startDate
  latest: Measurements | null;  // Phase 3 (T14): own user only; partner gets null
  start: Measurements | null;   // Phase 3 (T14): earliest since startDate; own user only
}
export interface MetricsView { challenge: Challenge; today: string; series: MetricsSeries[] }
export interface PutMetricsBody {
  weightKg?: number | null; waistCm?: number | null; // null clears
  hipsCm?: number | null; chestCm?: number | null; armCm?: number | null; thighCm?: number | null; // Phase 3 (T14)
}
export interface PutMetricsSharingBody { shared: boolean }

export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushStatus { enabled: boolean; publicKey: string | null; subscribed: boolean }

// ---- Phase 3 additions (T11–T14), copied verbatim from docs/API.md ----

export type GoalSource = "manual" | "health_steps" | "health_active_kcal";

export interface ImportBody {
  date?: string;        // YYYY-MM-DD, default Toronto today; must be within [startDate, today]
  steps?: number;       // integer ≥ 0
  activeKcal?: number;  // ≥ 0
}
export interface ImportResult { date: string; steps: number | null; activeKcal: number | null; goalsUpdated: number }
export interface ImportStatus {
  hasToken: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  lastImport: { date: string; steps: number | null; activeKcal: number | null } | null;
}
export interface HealthDay { steps: number | null; activeKcal: number | null }

export interface UserRecap {
  userId: number; name: string; isMe: boolean;
  daysCheckedIn: number;        // 0–7 (only days within the challenge count toward the denominator)
  daysInChallenge: number;      // how many of the 7 days fall inside [startDate, min(today, endDate)]
  goalsHit: number; goalsTotal: number;
  weeklyGoals: Array<{ goalId: number; label: string; count: number; target: number }>; // e.g. F45 2 of 3
  streakEnd: number;            // current streak as of the week's last day
  cheersReceived: number; cheersSent: number;
  steps: number | null;         // sum of imported steps, null if none
  weightChangeKg: number | null; // own user only (first vs last entry in the week); null for the partner
  bestDay: { date: string; hit: number; total: number } | null;
}
export interface RecapView {
  weekStart: string; weekEnd: string;      // Monday, Sunday
  weekNumber: number;                      // 1-based from the challenge start week
  dayRange: { from: number; to: number };  // challenge days covered
  today: string;
  users: UserRecap[];                      // me first
  team: { checkins: number; possible: number } // sum over both users for the week
}

export interface Milestone { day: number; date: string; label: string; reached: boolean; isToday: boolean }
export interface TeamView {
  today: string; day: number; challenge: Challenge;
  ring: { done: number; target: number };     // done = sum of both users' checked-in days; target = 2 × lengthDays
  perUser: Array<{ userId: number; name: string; isMe: boolean; checkins: number }>;
  milestones: Milestone[];                     // days 7, 15, 30, 45 with labels "One week", "A third in", "Two thirds", "Finish line"
}

export type PhotoKind = "start" | "progress" | "end";
export interface Photo { id: number; date: string; kind: PhotoKind; mime: string; bytes: number;
                         width: number | null; height: number | null; createdAt: string; url: string } // url = /api/photos/:id/file
export interface PhotosView { photos: Photo[] }  // newest first

// ---- Phase 4 additions (T15–T16), copied verbatim from docs/API.md ----

export interface FinishTest { id: number; userId: number; key: string; label: string;
                              passed: boolean | null; result: string | null; testedOn: string | null }
export interface PutFinishTestBody { passed: boolean | null; result?: string | null; testedOn?: string | null }
export interface PostFinishTestBody { label: string }   // key derived: slug of label + short random suffix

export interface GoalSummary {
  goalId: number; label: string; kind: GoalKind; unit: string | null; source: GoalSource;
  dailyTarget: number | null; weeklyTarget: number | null;
  enteredDays: number; hitDays: number;
  average: number | null;          // number goals: mean of entered values
  weeklyHits: { weeks: number; weeksHit: number; total: number } | null; // weekly goals: weeks with count ≥ target
}
/** One row of body numbers (the contract's `{ same shape }`), caller only. */
export interface BodyNumbers {
  date: string; weightKg: number | null; waistCm: number | null; hipsCm: number | null; chestCm: number | null; armCm: number | null; thighCm: number | null;
}
export interface BodySummary {      // caller only; null for the partner
  start: BodyNumbers | null;
  latest: BodyNumbers | null;
  change: { weightKg: number | null; waistCm: number | null; hipsCm: number | null; chestCm: number | null; armCm: number | null; thighCm: number | null } | null;
}
export interface UserSummary {
  userId: number; name: string; isMe: boolean;
  daysCheckedIn: number; daysSoFar: number;   // daysSoFar = min(day, lengthDays), 0 before start
  goalsHit: number; goalsTotal: number;        // over active goals × daysSoFar
  bestStreak: number; currentStreak: number;
  cheersSent: number; cheersReceived: number; topEmojiReceived: string | null;
  steps: { total: number | null; avgPerDay: number | null; bestDay: { date: string; steps: number } | null };
  goals: GoalSummary[];
  body: BodySummary | null;
  photos: { start: Photo | null; end: Photo | null } | null;  // caller only
  finishTests: FinishTest[];                                  // both users' tests are visible
}
export interface SummaryView {
  challenge: Challenge; today: string; day: number; endDate: string; complete: boolean;
  team: { checkins: number; possible: number; cheers: number; bestWeek: { weekStart: string; checkins: number } | null };
  users: UserSummary[];   // me first
}
