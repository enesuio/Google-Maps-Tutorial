import { describe, expect, it } from 'vitest';
import { activeMoreItem, activeTab, MORE_ITEMS, TABS } from './nav';

describe('activeTab', () => {
  it('maps the today flow, including past days and the Health setup page', () => {
    expect(activeTab('/')).toBe('today');
    expect(activeTab('/day/2026-10-09')).toBe('today');
    expect(activeTab('/health-setup')).toBe('today');
  });
  it('maps the three plain tabs', () => {
    expect(activeTab('/history')).toBe('history');
    expect(activeTab('/trend')).toBe('trend');
    expect(activeTab('/photos')).toBe('photos');
    expect(activeTab('/photos/')).toBe('photos');
  });
  it('sends the sheet pages to More', () => {
    expect(activeTab('/recap')).toBe('more');
    expect(activeTab('/recap?week=2026-10-12'.split('?')[0] ?? '')).toBe('more');
    expect(activeTab('/summary')).toBe('more');
    expect(activeMoreItem('/summary')).toBe('summary');
    expect(activeMoreItem('/recap')).toBe('recap');
    expect(activeMoreItem('/')).toBeNull();
  });
  it('does not match prefixes of other routes', () => {
    expect(activeTab('/historyx')).toBeNull();
    expect(activeTab('/nope')).toBeNull();
  });
  it('lists five tabs with More last and two More items', () => {
    expect(TABS.map((t) => t.tab)).toEqual(['today', 'history', 'trend', 'photos', 'more']);
    expect(MORE_ITEMS.map((t) => t.to)).toEqual(['/recap', '/summary']);
  });
});
