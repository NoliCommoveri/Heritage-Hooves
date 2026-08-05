/**
 * Slice 0026 stage 2: the horse page's four tabs - the pure module (src/lib/horseTab.ts).
 *
 * The other half of this slice's cover, test/horse-tabs-source.test.ts, reads the route and render
 * files off disk; it lives in its own file because reading disk needs @types/node, which tsconfig
 * excludes. See that file's header for what it guards.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_HORSE_TAB, HORSE_TABS, horsePageUrl, parseHorseTab, type HorseTab } from '../src/lib/horseTab';

describe('the tab list', () => {
  it('is the four tabs of §2.1, in the order the bar draws them', () => {
    expect(HORSE_TABS.map((t) => t.key)).toEqual(['genetics', 'care', 'shows', 'market']);
  });

  it('defaults to the first one', () => {
    expect(DEFAULT_HORSE_TAB).toBe(HORSE_TABS[0].key);
  });
});

describe('parseHorseTab', () => {
  it('passes every real tab key through unchanged', () => {
    for (const tab of HORSE_TABS) {
      expect(parseHorseTab(tab.key)).toBe(tab.key);
    }
  });

  it('falls back to the default for a missing, empty or nonsense value (§2.2)', () => {
    expect(parseHorseTab(null)).toBe(DEFAULT_HORSE_TAB);
    expect(parseHorseTab(undefined)).toBe(DEFAULT_HORSE_TAB);
    expect(parseHorseTab('')).toBe(DEFAULT_HORSE_TAB);
    expect(parseHorseTab('pedigree')).toBe(DEFAULT_HORSE_TAB);
    expect(parseHorseTab('Genetics')).toBe(DEFAULT_HORSE_TAB);
  });
});

describe('horsePageUrl', () => {
  it('always names the tab', () => {
    expect(horsePageUrl(42, 'care')).toBe('/horses/42?tab=care');
  });

  it('escapes the extra parameters it is given', () => {
    const url = horsePageUrl(7, 'shows', { show_error: "Bluebell isn't old enough yet & can't enter." });
    expect(url.startsWith('/horses/7?tab=shows&show_error=')).toBe(true);
    expect(new URL(url, 'https://example.test').searchParams.get('show_error')).toBe("Bluebell isn't old enough yet & can't enter.");
  });

  it('round-trips back through parseHorseTab for every tab', () => {
    for (const tab of HORSE_TABS) {
      const url = new URL(horsePageUrl(1, tab.key), 'https://example.test');
      expect(parseHorseTab(url.searchParams.get('tab'))).toBe(tab.key);
    }
  });
});

// A compile-time check that the four keys above really are the whole union - if a fifth tab is added
// to HorseTab without being added to HORSE_TABS, this stops building.
const _exhaustive: Record<HorseTab, true> = { genetics: true, care: true, shows: true, market: true };
void _exhaustive;
