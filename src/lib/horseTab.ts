// Slice 0026 stage 2 §2: the horse page's four tabs. A pure module so the tab list, the parse rule
// and the URL builder live in one place - the render layer draws the bar from HORSE_TABS, and every
// POST handler on the page builds its redirect with horsePageUrl so a success notice is never left
// behind a tab the player is not looking at (§2.2).
//
// Tabs are plain links with a query parameter, exactly like the barn list's (src/lib/barnFilter.ts
// and renderBarnList) - no JavaScript anywhere in this game's front end.

export type HorseTab = 'genetics' | 'care' | 'shows' | 'market';

/** Order matters: this is the order the tab bar draws in, and the first entry is the default. */
export const HORSE_TABS: { key: HorseTab; label: string }[] = [
  { key: 'genetics', label: 'Genetics' },
  { key: 'care', label: 'Health & care' },
  { key: 'shows', label: 'Shows' },
  { key: 'market', label: 'Buying & selling' },
];

export const DEFAULT_HORSE_TAB: HorseTab = 'genetics';

/** §2.2: an unrecognised or missing tab renders the default rather than 404ing - a stale link a
 * child pasted to a sibling should still open the horse. */
export function parseHorseTab(value: string | null | undefined): HorseTab {
  const found = HORSE_TABS.find((t) => t.key === value);
  return found ? found.key : DEFAULT_HORSE_TAB;
}

/**
 * The horse page's URL on a given tab, with any extra query parameters (an error message, a "done"
 * flag) appended. Built with URLSearchParams so the escaping is done once, here, rather than at
 * each of the two dozen call sites.
 */
export function horsePageUrl(horseId: number, tab: HorseTab, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ tab, ...params });
  return `/horses/${String(horseId)}?${search.toString()}`;
}
