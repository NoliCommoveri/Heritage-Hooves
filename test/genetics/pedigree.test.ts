import { describe, expect, it } from 'vitest';
import { coefficientOfInbreeding, buildAncestorRows, type PedigreeHorse } from '../../src/engines/genetics/pedigree';
import { PEDIGREE_DEPTH } from '../../src/engines/genetics/loci';

function founder(coi = 0): PedigreeHorse {
  return { sireId: null, damId: null, coi };
}

describe('coefficientOfInbreeding: known values (the tabular method)', () => {
  it('unrelated parents -> 0', () => {
    const horses = new Map<number, PedigreeHorse>([
      [1, founder()],
      [2, founder()],
    ]);
    expect(coefficientOfInbreeding(1, 2, horses)).toBe(0);
  });

  it('half-siblings (shared sire) -> 0.125', () => {
    const horses = new Map<number, PedigreeHorse>([
      [1, founder()], // shared sire
      [2, founder()], // dam of horse 4
      [3, founder()], // dam of horse 5
      [4, { sireId: 1, damId: 2, coi: 0 }],
      [5, { sireId: 1, damId: 3, coi: 0 }],
    ]);
    expect(coefficientOfInbreeding(4, 5, horses)).toBeCloseTo(0.125, 10);
  });

  it('full siblings -> 0.25', () => {
    const horses = new Map<number, PedigreeHorse>([
      [1, founder()],
      [2, founder()],
      [4, { sireId: 1, damId: 2, coi: 0 }],
      [5, { sireId: 1, damId: 2, coi: 0 }],
    ]);
    expect(coefficientOfInbreeding(4, 5, horses)).toBeCloseTo(0.25, 10);
  });

  it('parent x offspring -> 0.25', () => {
    const horses = new Map<number, PedigreeHorse>([
      [1, founder()], // sire
      [2, founder()], // dam
      [6, { sireId: 1, damId: 2, coi: 0 }], // their foal, bred back to horse 1
    ]);
    expect(coefficientOfInbreeding(1, 6, horses)).toBeCloseTo(0.25, 10);
  });

  it('an inbred common ancestor produces a strictly higher COI than the same pedigree with that ancestor at coi 0', () => {
    const pedigreeWith = (sireCoi: number): Map<number, PedigreeHorse> =>
      new Map<number, PedigreeHorse>([
        [1, founder(sireCoi)],
        [2, founder()],
        [3, founder()],
        [4, { sireId: 1, damId: 2, coi: 0 }],
        [5, { sireId: 1, damId: 3, coi: 0 }],
      ]);

    const baseline = coefficientOfInbreeding(4, 5, pedigreeWith(0));
    const withInbredAncestor = coefficientOfInbreeding(4, 5, pedigreeWith(0.3));
    expect(withInbredAncestor).toBeGreaterThan(baseline);
  });
});

describe('buildAncestorRows', () => {
  it('adds both parents at depth 1 and shifts inherited rows down by one', () => {
    const rows = buildAncestorRows(10, 20, [], []);
    expect(rows).toEqual(
      expect.arrayContaining([
        { ancestorId: 10, depth: 1, pathCount: 1 },
        { ancestorId: 20, depth: 1, pathCount: 1 },
      ])
    );
    expect(rows).toHaveLength(2);
  });

  it('sums path_count when the same ancestor appears at the same depth via both parents', () => {
    // Both parents share ancestor 99 at depth 2, so the foal reaches it at depth 3 by two paths.
    const sireRows = [{ ancestorId: 99, depth: 2, pathCount: 1 }];
    const damRows = [{ ancestorId: 99, depth: 2, pathCount: 1 }];
    const rows = buildAncestorRows(10, 20, sireRows, damRows);
    const merged = rows.find((r) => r.ancestorId === 99 && r.depth === 3);
    expect(merged).toEqual({ ancestorId: 99, depth: 3, pathCount: 2 });
  });

  it('drops everything past PEDIGREE_DEPTH', () => {
    const sireRows = [{ ancestorId: 5, depth: PEDIGREE_DEPTH, pathCount: 1 }];
    const rows = buildAncestorRows(10, 20, sireRows, []);
    expect(rows.find((r) => r.ancestorId === 5)).toBeUndefined();
  });

  it('keeps a row that lands exactly on PEDIGREE_DEPTH after shifting', () => {
    const sireRows = [{ ancestorId: 5, depth: PEDIGREE_DEPTH - 1, pathCount: 1 }];
    const rows = buildAncestorRows(10, 20, sireRows, []);
    expect(rows.find((r) => r.ancestorId === 5 && r.depth === PEDIGREE_DEPTH)).toBeDefined();
  });
});
