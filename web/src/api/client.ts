import type {
  Cheer,
  DayView,
  FinishTest,
  HistoryView,
  ImportStatus,
  Me,
  MetricsView,
  Photo,
  PhotosView,
  PostCheerBody,
  PostFinishTestBody,
  PushStatus,
  PushSubscriptionBody,
  PutCheckinsBody,
  PutFinishTestBody,
  PutMetricsBody,
  PutMetricsSharingBody,
  RecapView,
  SummaryView,
  TeamView,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ---- global "unauthenticated" state (any 401 flips it; logout flips it too) ----

let unauthenticated = false;
const listeners = new Set<() => void>();

export function isUnauthenticated(): boolean {
  return unauthenticated;
}

export function setUnauthenticated(value: boolean): void {
  if (unauthenticated === value) return;
  unauthenticated = value;
  for (const fn of listeners) fn();
}

export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---- fetch wrapper ----

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

async function readError(res: Response): Promise<ApiError> {
  let code = 'unknown';
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as ErrorBody;
    if (body.error) {
      if (typeof body.error.code === 'string') code = body.error.code;
      if (typeof body.error.message === 'string' && body.error.message) message = body.error.message;
    }
  } catch {
    // non-JSON error body; keep defaults
  }
  return new ApiError(res.status, code, message);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (body instanceof FormData) {
    init.body = body; // the browser sets the multipart boundary itself
  } else if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network', "Couldn't reach the server. Check your connection.");
  }

  if (res.status === 401) {
    setUnauthenticated(true);
    throw new ApiError(401, 'unauthenticated', 'Not signed in');
  }
  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T; // e.g. 202 Accepted with an empty body
  return JSON.parse(text) as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  today: () => request<DayView>('GET', '/api/today'),
  day: (date: string) => request<DayView>('GET', `/api/days/${encodeURIComponent(date)}`),
  history: () => request<HistoryView>('GET', '/api/history'),
  putCheckins: (date: string, body: PutCheckinsBody) =>
    request<DayView>('PUT', `/api/checkins/${encodeURIComponent(date)}`, body),
  logout: () => request<void>('POST', '/api/logout'),

  // ---- Phase 2 ----
  postCheer: (body: PostCheerBody) => request<Cheer>('POST', '/api/cheers', body),
  deleteCheer: (id: number) => request<void>('DELETE', `/api/cheers/${id}`),
  metrics: () => request<MetricsView>('GET', '/api/metrics'),
  putMetrics: (date: string, body: PutMetricsBody) =>
    request<MetricsView>('PUT', `/api/metrics/${encodeURIComponent(date)}`, body),
  putMetricsSharing: (body: PutMetricsSharingBody) => request<MetricsView>('PUT', '/api/metrics/sharing', body),
  pushStatus: () => request<PushStatus>('GET', '/api/push/status'),
  pushSubscribe: (body: PushSubscriptionBody) => request<{ ok: true }>('POST', '/api/push/subscribe', body),
  pushUnsubscribe: (endpoint: string) => request<void>('DELETE', '/api/push/subscribe', { endpoint }),
  pushTest: () => request<void>('POST', '/api/push/test'),

  // ---- Phase 3 ----
  importStatus: () => request<ImportStatus>('GET', '/api/import/status'),
  createImportToken: () => request<{ token: string }>('POST', '/api/import/token'),
  deleteImportToken: () => request<void>('DELETE', '/api/import/token'),
  recap: (week?: string) =>
    request<RecapView>('GET', week ? `/api/recap?week=${encodeURIComponent(week)}` : '/api/recap'),
  team: () => request<TeamView>('GET', '/api/team'),
  photos: () => request<PhotosView>('GET', '/api/photos'),
  /** Multipart upload: fields `date`, `kind`, file `photo`. */
  uploadPhoto: (form: FormData) => request<Photo>('POST', '/api/photos', form),
  deletePhoto: (id: number) => request<void>('DELETE', `/api/photos/${id}`),

  // ---- Phase 4 ----
  summary: () => request<SummaryView>('GET', '/api/summary'),
  putFinishTest: (id: number, body: PutFinishTestBody) => request<FinishTest>('PUT', `/api/finish-tests/${id}`, body),
  postFinishTest: (body: PostFinishTestBody) => request<FinishTest>('POST', '/api/finish-tests', body),
  deleteFinishTest: (id: number) => request<void>('DELETE', `/api/finish-tests/${id}`),
};

/**
 * Export downloads (T16). Plain `<a href download>` anchors, not fetches: the session cookie
 * carries auth and the API answers with `Content-Disposition: attachment`.
 */
export const EXPORTS = [
  { href: '/api/export.json', label: 'Everything as JSON', detail: 'Users, goals, every check-in, cheers, Health days, body metrics, finish tests and photo details.' },
  { href: '/api/export.csv', label: 'Check-ins (CSV)', detail: 'One row per entered goal per day, for both of you.' },
  { href: '/api/export/metrics.csv', label: 'My measurements (CSV)', detail: 'Your weight, waist, hips, chest, arm and thigh by day. Only yours.' },
  { href: '/api/export/health.csv', label: 'Apple Health (CSV)', detail: 'Steps and active calories by day, for both of you.' },
] as const;

/** Max photo upload the API accepts (docs/API.md, T14). Checked client-side before uploading. */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

/** Human-friendly text for an ApiError (used by toasts and inline messages). */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 413) return 'That photo is too large (max 12 MB).';
    switch (err.code) {
      case 'future_date':
        return "That day hasn't happened yet.";
      case 'before_start':
        return 'That day is before the challenge started.';
      case 'not_your_goal':
        return "You can only edit your own goals.";
      case 'network':
        return err.message;
      case 'bad_request':
        return 'That request was not valid.';
      case 'push_disabled':
        return 'Notifications are not configured on the server.';
      case 'auto_goal':
        return 'That goal is filled from Apple Health, not by hand.';
      case 'bad_token':
        return 'That import token is not valid any more.';
      case 'not_found':
        return "That isn't there any more.";
      case 'too_many':
        return 'You can have up to 5 finish-line tests.';
      default:
        return err.message || 'Something went wrong.';
    }
  }
  return 'Something went wrong.';
}
