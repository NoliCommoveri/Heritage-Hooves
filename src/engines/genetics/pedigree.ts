// Ancestor rows for a new foal, and the tabular kinship/COI recursion. Slice 0002 §5.5. Both pure
// - no database access; the caller loads the small subgraph these need (see
// db/horses.ts:loadPedigreeContext) and passes it in as plain data.

import { PEDIGREE_DEPTH } from './loci';

export interface AncestorEdge {
  ancestorId: number;
  depth: number;
  pathCount: number;
}

/**
 * Builds the horse_ancestors rows for a new foal from its parents' existing rows: add both
 * parents themselves at depth 1, shift every inherited row down by one, drop anything past
 * PEDIGREE_DEPTH, and merge duplicates by summing path_count within the same (ancestorId, depth) -
 * the same ancestor can reach the foal by paths of different lengths (a grandsire who is also a
 * great-great-grandsire), and collapsing those would lose what the pedigree display wants.
 */
export function buildAncestorRows(sireId: number, damId: number, sireRows: AncestorEdge[], damRows: AncestorEdge[]): AncestorEdge[] {
  const merged = new Map<string, number>();

  function add(ancestorId: number, depth: number, pathCount: number): void {
    if (depth > PEDIGREE_DEPTH) return;
    const key = `${ancestorId}:${depth}`;
    merged.set(key, (merged.get(key) ?? 0) + pathCount);
  }

  add(sireId, 1, 1);
  add(damId, 1, 1);
  for (const row of sireRows) add(row.ancestorId, row.depth + 1, row.pathCount);
  for (const row of damRows) add(row.ancestorId, row.depth + 1, row.pathCount);

  return Array.from(merged.entries()).map(([key, pathCount]) => {
    const [ancestorIdStr, depthStr] = key.split(':');
    return { ancestorId: Number(ancestorIdStr), depth: Number(depthStr), pathCount };
  });
}

export interface PedigreeHorse {
  sireId: number | null;
  damId: number | null;
  /** This horse's own stored COI, computed at its birth. */
  coi: number;
}

/**
 * Kinship between two horses via the tabular method, not Wright's path method - Wright's formula
 * needs to enumerate paths in which no individual repeats, and that can't be checked against
 * aggregated path_count values once they've been summed. The tabular recursion needs only parent
 * pointers and each ancestor's own stored COI, and is exact:
 *
 *   f(X, X) = 0.5 * (1 + F_X), where F_X is that horse's stored coi
 *   f(X, Y), X != Y: expand the younger of the two (higher id - ids are monotonic and a horse's
 *     parents always predate it): f(X, Y) = 0.5 * [f(X, sire_Y) + f(X, dam_Y)]
 *   a null parent, or a horse not present in `horses`, contributes 0 (beyond PEDIGREE_DEPTH,
 *   ancestors are treated as unrelated founders - CLAUDE.md-style trade-off, slice 0002 §5.5)
 *
 * path_count from horse_ancestors does NOT feed this at all - it exists only so "this horse
 * appears four times in the pedigree" can be displayed.
 */
export function kinship(aId: number, bId: number, horses: Map<number, PedigreeHorse>): number {
  const memo = new Map<string, number>();

  function f(x: number, y: number): number {
    if (x <= 0 || y <= 0) return 0;
    const key = x <= y ? `${x}:${y}` : `${y}:${x}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let result: number;
    if (x === y) {
      const horse = horses.get(x);
      const F = horse ? horse.coi : 0;
      result = 0.5 * (1 + F);
    } else {
      const older = x < y ? x : y;
      const youngerId = x < y ? y : x;
      const younger = horses.get(youngerId);
      if (!younger) {
        result = 0;
      } else {
        const sireContribution = younger.sireId ? f(older, younger.sireId) : 0;
        const damContribution = younger.damId ? f(older, younger.damId) : 0;
        result = 0.5 * (sireContribution + damContribution);
      }
    }
    memo.set(key, result);
    return result;
  }

  return f(aId, bId);
}

export function coefficientOfInbreeding(sireId: number, damId: number, horses: Map<number, PedigreeHorse>): number {
  return kinship(sireId, damId, horses);
}
