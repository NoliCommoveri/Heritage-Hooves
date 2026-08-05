/**
 * Slice 0026 stage 2, the half that reads the source off disk - the way router-paths.test.ts reads
 * src/router.ts, and for the same reason: the rule being guarded lives in two dozen places at once
 * and a new one added later would break it silently.
 *
 * The rule is §2.2's "every POST handler on this page redirects back to its own tab". A redirect
 * built by hand instead of through horsePageUrl lands the player on the default tab with their
 * success notice sitting behind a button they are not looking at - which looks, from the outside,
 * exactly like the action having done nothing at all.
 *
 * Excluded from tsc (see tsconfig.json) because node:fs conflicts with @cloudflare/workers-types.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HORSE_TABS } from '../src/lib/horseTab';

describe('every horse-page redirect names a tab', () => {
  const ROUTES = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'horses.ts'), 'utf8');

  it('routes/horses.ts builds no /horses/:id redirect by hand (§2.2)', () => {
    // A hand-built one looks like redirect(`/horses/${String(horseId)}...`) and carries no ?tab=.
    const handBuilt = [...ROUTES.matchAll(/redirect\(\s*`\/horses\/\$\{[^`]*`/g)].map((m) => m[0]);
    expect(handBuilt, `use horsePageUrl(horseId, tab) instead:\n${handBuilt.join('\n')}`).toEqual([]);
  });

  it('names a real tab at every horsePageUrl call site', () => {
    const tabs = [...ROUTES.matchAll(/horsePageUrl\((?:horseId|horse\.id), '([a-z]+)'/g)].map((m) => m[1]);
    expect(tabs.length).toBeGreaterThan(15);
    const known = new Set<string>(HORSE_TABS.map((t) => t.key));
    for (const tab of tabs) expect(known.has(tab), `${tab} is not a tab`).toBe(true);
  });
});

describe('every tab has cards behind it', () => {
  const RENDER = fs.readFileSync(path.join(process.cwd(), 'src', 'render', 'horses.ts'), 'utf8');

  it('renderHorsePage assigns cards to all four tabs', () => {
    const start = RENDER.indexOf('const tabCards: Record<HorseTab, SafeHtml[]> = {');
    expect(start, 'renderHorsePage no longer builds a tabCards map').toBeGreaterThan(-1);
    const block = RENDER.slice(start, RENDER.indexOf('const emptyTabLine', start));
    for (const tab of HORSE_TABS) {
      expect(block.includes(`${tab.key}: [`), `no cards behind the ${tab.key} tab`).toBe(true);
    }
  });

  it('every tab has its own muted line for a viewer who can see nothing in it (§2.2)', () => {
    const start = RENDER.indexOf('const emptyTabLine: Record<HorseTab, string> = {');
    expect(start).toBeGreaterThan(-1);
    const block = RENDER.slice(start, RENDER.indexOf('};', start));
    for (const tab of HORSE_TABS) {
      expect(block.includes(`${tab.key}:`), `no empty-tab line for ${tab.key}`).toBe(true);
    }
  });
});
