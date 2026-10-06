import { describe, expect, it } from 'vitest';
import { formatThousands, healthLine, importStatusLine } from './health';

describe('health helpers', () => {
  it('groups thousands', () => {
    expect(formatThousands(8421)).toBe('8,421');
    expect(formatThousands(512)).toBe('512');
    expect(formatThousands(1234567.5)).toBe('1,234,567.5');
  });
  it('builds the health line', () => {
    expect(healthLine({ steps: 8421, activeKcal: 512 })).toBe('8,421 steps · 512 kcal active');
    expect(healthLine({ steps: 8421, activeKcal: null })).toBe('8,421 steps');
    expect(healthLine({ steps: null, activeKcal: null })).toBeNull();
    expect(healthLine(null)).toBeNull();
  });
  it('describes the import status', () => {
    const fmt = (d: string) => d;
    expect(importStatusLine({ hasToken: false, createdAt: null, lastUsedAt: null, lastImport: null }, fmt)).toBeNull();
    expect(importStatusLine({ hasToken: true, createdAt: 'x', lastUsedAt: null, lastImport: null }, fmt)).toBe(
      'Token created, nothing received yet',
    );
    expect(
      importStatusLine(
        { hasToken: true, createdAt: 'x', lastUsedAt: 'y', lastImport: { date: '2026-10-14', steps: 8421, activeKcal: 512 } },
        fmt,
      ),
    ).toBe('Connected · last import 2026-10-14 (8,421 steps)');
  });
});
