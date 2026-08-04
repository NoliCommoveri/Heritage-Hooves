/**
 * The router keeps the same fact in two places: a path regex whose second group lists the allowed
 * sub-paths, and a block of `if (sub === '/x')` handlers below it. When the two drift, the handler
 * is unreachable - the request falls past the whole block to the router's closing notFound(), and
 * the player gets a bare "Not found" page from a button that looks perfectly ordinary.
 *
 * That is exactly what happened to slice 0020's "Call the vet" button: POST /horses/:id/treat had a
 * handler from the day it shipped and was never in HORSE_ROUTE's alternation, so every press 404'd.
 *
 * This test reads src/router.ts itself rather than a hand-copied list, so a future sub-path added to
 * a handler and forgotten in its regex fails here, named, instead of failing in front of the
 * children.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(path.join(process.cwd(), 'src', 'router.ts'), 'utf8');

/** The regex literal assigned to `const <name> = /.../;`, rebuilt as a real RegExp. */
function routeRegex(name: string): RegExp {
  const match = SOURCE.match(new RegExp(`const ${name} = /(.+)/;`));
  if (!match) throw new Error(`router.ts has no ${name} declaration`);
  return new RegExp(match[1]);
}

/**
 * Every `sub === '/x'` literal inside the handler block that `path.match(<name>)` opens - the block
 * runs to the next `path.match(` in the file, which is where the following route's block begins.
 */
function handledSubPaths(name: string): string[] {
  const start = SOURCE.indexOf(`path.match(${name})`);
  if (start === -1) throw new Error(`router.ts never matches against ${name}`);
  const rest = SOURCE.slice(start + `path.match(${name})`.length);
  const nextBlock = rest.indexOf('path.match(');
  const block = nextBlock === -1 ? rest : rest.slice(0, nextBlock);
  return [...block.matchAll(/sub === '(\/[a-z-]+)'/g)].map((m) => m[1]);
}

const ROUTES: { name: string; sample: string }[] = [
  { name: 'STABLE_ROUTE', sample: '/stables/1' },
  { name: 'HORSE_ROUTE', sample: '/horses/1' },
  { name: 'LISTING_ROUTE', sample: '/market/1' },
  { name: 'OFFER_ROUTE', sample: '/market/offers/1' },
  { name: 'STUD_ROUTE', sample: '/market/stud/1' },
];

describe('every handled sub-path is reachable through its route regex', () => {
  for (const route of ROUTES) {
    it(`${route.name} matches every sub-path its block handles`, () => {
      const regex = routeRegex(route.name);
      const subs = handledSubPaths(route.name);
      expect(subs.length).toBeGreaterThan(0);
      for (const sub of subs) {
        expect(`${route.sample}${sub}`, `${route.name} does not match ${route.sample}${sub}`).toMatch(regex);
      }
    });
  }

  it('POST /horses/:id/treat reaches the treat handler (the bug this file exists for)', () => {
    const match = '/horses/42/treat'.match(routeRegex('HORSE_ROUTE'));
    expect(match).not.toBeNull();
    expect(match![1]).toBe('42');
    expect(match![2]).toBe('/treat');
  });
});
