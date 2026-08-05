import { describe, expect, it } from 'vitest';
import { panelFor, type PanelConditionInput } from '../../src/engines/health/panel';
import type { AllelePool } from '../../src/engines/founding/pool';

function condition(code: string, locus: string, mutant: string): PanelConditionInput {
  return { code, locus_code: locus, trigger: JSON.stringify({ v: 1, locus, mutant, mode: 'recessive' }) };
}

const HYPP = condition('HYPP', 'HYPP', 'H');
const HERDA = condition('HERDA', 'HERDA', 'Hrd');
const SCID = condition('SCID', 'SCID', 'Sc');
const CA = condition('CA', 'CA', 'Ca');
const LFS = condition('LFS', 'LFS', 'Lv');
const NO_LOCUS = { code: 'FUTURE', locus_code: null, trigger: '{}' };

const QH_POOL: AllelePool = { HYPP: { N: 0.98, H: 0.02 }, HERDA: { N: 0.94, Hrd: 0.06 }, SCID: { N: 1.0 }, CA: { N: 1.0 }, LFS: { N: 1.0 } };
const AR_POOL: AllelePool = { HYPP: { N: 1.0 }, HERDA: { N: 1.0 }, SCID: { N: 0.97, Sc: 0.03 }, CA: { N: 0.95, Ca: 0.05 }, LFS: { N: 0.98, Lv: 0.02 } };

const POOLS = new Map([
  ['QH', QH_POOL],
  ['AR', AR_POOL],
]);

describe('panelFor', () => {
  it('a Quarter Horse gets the QH conditions and none of the Arabian ones', () => {
    const panel = panelFor([HYPP, HERDA, SCID, CA, LFS], POOLS, new Set(['QH']));
    expect(panel.map((c) => c.code).sort()).toEqual(['HERDA', 'HYPP']);
  });

  it('an Arabian gets SCID/CA/LFS only', () => {
    const panel = panelFor([HYPP, HERDA, SCID, CA, LFS], POOLS, new Set(['AR']));
    expect(panel.map((c) => c.code).sort()).toEqual(['CA', 'LFS', 'SCID']);
  });

  it('a horse with both breed codes in its pedigree gets every condition either breed carries', () => {
    const panel = panelFor([HYPP, HERDA, SCID, CA, LFS], POOLS, new Set(['QH', 'AR']));
    expect(panel.map((c) => c.code).sort()).toEqual(['CA', 'HERDA', 'HYPP', 'LFS', 'SCID']);
  });

  it('a condition with no locus_code is always kept, since there is nothing to check it against', () => {
    const panel = panelFor([NO_LOCUS], POOLS, new Set(['QH']));
    expect(panel).toEqual([NO_LOCUS]);
  });

  it('throws naming the breed when a pool is missing entirely', () => {
    expect(() => panelFor([HYPP], POOLS, new Set(['FR']))).toThrow(/FR/);
  });

  it('throws naming the locus when a pool is missing it - an error, not a default', () => {
    const incompletePool: AllelePool = { HERDA: { N: 1.0 } };
    expect(() => panelFor([HYPP], new Map([['QH', incompletePool]]), new Set(['QH']))).toThrow(/HYPP/);
  });
});
