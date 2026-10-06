import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError, describeError } from '../api/client';
import type { Cheer, DayView } from '../api/types';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { HealthSection } from '../components/HealthSection';
import { NotificationsSection } from '../components/NotificationsSection';
import { TeamStrip } from '../components/TeamStrip';
import { Toast } from '../components/Toast';
import { UserCard } from '../components/UserCard';
import { addCheer, removeCheer, replaceCheer } from '../lib/cheers';
import { isValidISODate } from '../lib/dates';
import { applyValue, findGoal } from '../lib/goals';

interface Props {
  mode: 'today' | 'date';
}

/**
 * The shared today screen. In `date` mode it is fed by `GET /api/days/:date` and lets you
 * backfill a past day; otherwise `GET /api/today`.
 */
export function DayScreen({ mode }: Props) {
  const params = useParams<{ date: string }>();
  const routeDate = mode === 'date' ? (params.date ?? '') : null;

  const [view, setView] = useState<DayView | null>(null);
  const viewRef = useRef<DayView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [toast, setToast] = useState<string | null>(null);
  const [inflight, setInflight] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const pending = useRef(new Map<number, number | null>()); // goalId → optimistic value in flight

  const update = useCallback((next: DayView | null) => {
    viewRef.current = next;
    setView(next);
  }, []);

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    update(null);
    pending.current.clear();

    if (routeDate !== null && !isValidISODate(routeDate)) {
      setLoadError('That is not a valid date.');
      setLoading(false);
      return;
    }

    const req = routeDate === null ? api.today() : api.day(routeDate);
    req
      .then((v) => {
        if (!cancelled) update(v);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return; // App switches to SetupNeeded
        setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeDate, update]);

  // ---- "Saved" flash when the last save lands ----
  const prevInflight = useRef(0);
  useEffect(() => {
    if (prevInflight.current > 0 && inflight === 0) {
      setSavedFlash(true);
      const t = setTimeout(() => setSavedFlash(false), 1500);
      prevInflight.current = inflight;
      return () => clearTimeout(t);
    }
    prevInflight.current = inflight;
    return undefined;
  }, [inflight]);

  // ---- toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- save one change, optimistically ----
  const change = useCallback(
    async (goalId: number, value: number | null) => {
      const current = viewRef.current;
      if (!current) return;
      const me = current.users.find((u) => u.isMe);
      if (!me) return;
      const goal = findGoal(current, me.id, goalId);
      if (!goal || goal.value === value) return;
      const previous = goal.value;

      update(applyValue(current, me.id, goalId, value));
      pending.current.set(goalId, value);
      setInflight((n) => n + 1);
      setSavedFlash(false);

      try {
        const res = await api.putCheckins(current.date, { entries: [{ goalId, value }] });
        if (pending.current.get(goalId) === value) pending.current.delete(goalId);
        // Replace with the server's view, keeping any newer edits still in flight.
        let merged = res;
        for (const [gid, val] of pending.current) merged = applyValue(merged, me.id, gid, val);
        if (viewRef.current && viewRef.current.date === res.date) update(merged);
      } catch (err: unknown) {
        if (pending.current.get(goalId) === value) {
          pending.current.delete(goalId);
          const now = viewRef.current;
          if (now && now.date === current.date) update(applyValue(now, me.id, goalId, previous));
        }
        if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
      } finally {
        setInflight((n) => n - 1);
      }
    },
    [update],
  );

  // ---- cheers: optimistic post / delete ----
  const cheer = useCallback(
    async (toUserId: number, emoji: string, note: string | null) => {
      const current = viewRef.current;
      if (!current) return;
      const me = current.users.find((u) => u.isMe);
      if (!me) return;
      const temp: Cheer = {
        id: -Date.now(),
        fromUserId: me.id,
        toUserId,
        date: current.date,
        emoji,
        note,
        createdAt: new Date().toISOString(),
      };
      update(addCheer(current, temp));
      try {
        const saved = await api.postCheer({ toUserId, date: current.date, emoji, ...(note ? { note } : {}) });
        const now = viewRef.current;
        if (now && now.date === current.date) update(replaceCheer(now, temp.id, saved));
      } catch (err: unknown) {
        const now = viewRef.current;
        if (now && now.date === current.date) update(removeCheer(now, temp.id));
        if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
      }
    },
    [update],
  );

  const deleteCheer = useCallback(
    async (id: number) => {
      const current = viewRef.current;
      if (!current) return;
      const existing = current.users.flatMap((u) => u.cheers).find((c) => c.id === id);
      if (!existing) return;
      update(removeCheer(current, id));
      try {
        await api.deleteCheer(id);
      } catch (err: unknown) {
        const now = viewRef.current;
        if (now && now.date === current.date) update(addCheer(now, existing));
        if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
      }
    },
    [update],
  );

  const me = view?.users.find((u) => u.isMe) ?? null;
  const others = view?.users.filter((u) => !u.isMe) ?? [];
  const status = inflight > 0 ? 'Saving…' : savedFlash ? 'Saved' : null;
  const nameOf = (userId: number) => view?.users.find((u) => u.id === userId)?.name ?? 'Partner';

  return (
    <div className="app">
      <Header
        day={view?.day ?? null}
        lengthDays={view?.challenge.lengthDays ?? null}
        editingDate={routeDate}
        today={view?.today ?? null}
      />
      <main className="main">
        {loading && (
          <p className="muted loading" role="status">
            Loading…
          </p>
        )}
        {loadError && (
          <div className="notice" role="alert">
            <p>{loadError}</p>
          </div>
        )}
        {view && routeDate === null && <TeamStrip />}
        {view && (
          <div className="cards">
            {me && (
              <UserCard
                user={me}
                editable
                onChange={change}
                status={status}
                meId={me.id}
                nameOf={nameOf}
              />
            )}
            {me &&
              others.map((u) => (
                <UserCard
                  key={u.id}
                  user={u}
                  editable={false}
                  meId={me.id}
                  nameOf={nameOf}
                  onCheer={(emoji, note) => void cheer(u.id, emoji, note)}
                  onDeleteCheer={(id) => void deleteCheer(id)}
                />
              ))}
          </div>
        )}
        {view && routeDate === null && (
          <div className="settings-grid">
            <NotificationsSection partnerName={others[0]?.name ?? null} />
            <HealthSection />
          </div>
        )}
      </main>
      <Footer current={routeDate === null ? 'today' : 'day'} />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
