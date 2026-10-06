// Pure helpers for the bottom tab bar / inline nav. No DOM here.

export type Tab = 'today' | 'history' | 'trend' | 'photos' | 'more';

export interface NavItem {
  tab: Tab | 'recap' | 'summary';
  to: string;
  label: string;
}

/** The five bar items on a phone. "More" holds the rest. */
export const TABS: ReadonlyArray<NavItem & { tab: Tab }> = [
  { tab: 'today', to: '/', label: 'Today' },
  { tab: 'history', to: '/history', label: 'History' },
  { tab: 'trend', to: '/trend', label: 'Trend' },
  { tab: 'photos', to: '/photos', label: 'Photos' },
  { tab: 'more', to: '', label: 'More' },
];

/** Pages reached through "More" on a phone, inline at ≥720px. */
export const MORE_ITEMS: ReadonlyArray<NavItem> = [
  { tab: 'recap', to: '/recap', label: 'Recap' },
  { tab: 'summary', to: '/summary', label: 'Summary' },
];

/**
 * Which tab a path belongs to, so it can be highlighted and carry `aria-current="page"`:
 *  - `/` and `/day/:date` → today (editing a past day is still the today flow)
 *  - `/history`, `/trend`, `/photos` and anything beneath them → that tab
 *  - `/recap`, `/summary` → more (their link inside the sheet is the current page)
 *  - `/health-setup` → today (it is reached from the today screen's settings)
 *  - anything else → null
 */
export function activeTab(pathname: string): Tab | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/day' || path.startsWith('/day/') || path === '/health-setup') return 'today';
  for (const t of ['history', 'trend', 'photos'] as const) {
    if (path === `/${t}` || path.startsWith(`/${t}/`)) return t;
  }
  if (activeMoreItem(pathname) !== null) return 'more';
  return null;
}

/** The "More" sheet item that is the current page, or null. */
export function activeMoreItem(pathname: string): NavItem['tab'] | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const item of MORE_ITEMS) {
    if (path === item.to || path.startsWith(`${item.to}/`)) return item.tab;
  }
  return null;
}
