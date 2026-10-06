// Pure helpers for the Apple Health import (T11).
import type { HealthDay, ImportStatus } from '../api/types';

/** "8,421" — thousands separators for step counts and calories (never for typed goal values). */
export function formatThousands(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const [int = '0', frac] = String(Math.abs(rounded)).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '−' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** "8,421 steps · 512 kcal active"; null when there is nothing to show. */
export function healthLine(health: HealthDay | null): string | null {
  if (!health) return null;
  const parts: string[] = [];
  if (health.steps !== null) parts.push(`${formatThousands(health.steps)} steps`);
  if (health.activeKcal !== null) parts.push(`${formatThousands(health.activeKcal)} kcal active`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * One-line connection state for the settings card:
 *  - no token             → null (the section shows its intro copy instead)
 *  - token, no import yet → "Token created, nothing received yet"
 *  - imported             → "Connected · last import Oct 14 (8,421 steps)"
 */
export function importStatusLine(status: ImportStatus, formatDate: (date: string) => string): string | null {
  if (!status.hasToken) return null;
  if (!status.lastImport) return 'Token created, nothing received yet';
  const { date, steps, activeKcal } = status.lastImport;
  const detail =
    steps !== null ? `${formatThousands(steps)} steps` : activeKcal !== null ? `${formatThousands(activeKcal)} kcal` : null;
  return `Connected · last import ${formatDate(date)}${detail ? ` (${detail})` : ''}`;
}
