import type { Cheer, DayView } from '../api/types';

export const CHEER_NOTE_MAX = 140;

function sortCheers(cheers: Cheer[]): Cheer[] {
  return [...cheers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/** New DayView with `cheer` added to its receiver's card (oldest first). */
export function addCheer(view: DayView, cheer: Cheer): DayView {
  return {
    ...view,
    users: view.users.map((u) => (u.id === cheer.toUserId ? { ...u, cheers: sortCheers([...u.cheers, cheer]) } : u)),
  };
}

/** Replace the optimistic cheer `tempId` with the server's copy. */
export function replaceCheer(view: DayView, tempId: number, saved: Cheer): DayView {
  return {
    ...view,
    users: view.users.map((u) => ({
      ...u,
      cheers: sortCheers(u.cheers.map((c) => (c.id === tempId ? saved : c))),
    })),
  };
}

export function removeCheer(view: DayView, id: number): DayView {
  return {
    ...view,
    users: view.users.map((u) => ({ ...u, cheers: u.cheers.filter((c) => c.id !== id) })),
  };
}
