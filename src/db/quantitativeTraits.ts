// quantitative_traits: display metadata for the nine traits polygenic.ts's TRAITS already computes
// for every horse. Cached in module scope the same way breeds/loci are (src/db/breeds.ts) - edited
// approximately never, read on every horse page. Slice 0006 §5.1.

import type { Env } from '../types';

export interface QuantitativeTraitRow {
  id: number;
  code: string;
  name: string;
  category: 'conformation' | 'ability' | 'hidden';
  direction: 'bidirectional' | 'higher_better';
  low_label: string | null;
  high_label: string | null;
  locus_count: number;
  teaching_text: string;
  enabled: number;
  sort_order: number;
}

const CACHE_MS = 60_000;
let cache: { rows: QuantitativeTraitRow[]; expiresAtMs: number } | null = null;

export async function getQuantitativeTraits(env: Env): Promise<QuantitativeTraitRow[]> {
  const now = Date.now();
  if (cache && cache.expiresAtMs > now) return cache.rows;
  const result = await env.DB.prepare('SELECT * FROM quantitative_traits ORDER BY sort_order ASC').all<QuantitativeTraitRow>();
  const rows = result.results ?? [];
  cache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

/** The only rows this slice ever displays (§2.1) - in the same order TRAITS iterates them. */
export async function getConformationTraits(env: Env): Promise<QuantitativeTraitRow[]> {
  return (await getQuantitativeTraits(env)).filter((t) => t.category === 'conformation');
}

/** Slice 0012 §9: names for a discipline result's trait breakdown - the ability-trait counterpart
 * to getConformationTraits. Never used to put a bar on the horse page (§2.3) - only a result
 * screen, which is "doing", not "looking". */
export async function getAbilityTraits(env: Env): Promise<QuantitativeTraitRow[]> {
  return (await getQuantitativeTraits(env)).filter((t) => t.category === 'ability');
}
