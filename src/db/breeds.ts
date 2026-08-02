// breeds and loci: tiny, read constantly, edited approximately never. Cached in module scope the
// way src/lib/config-cache.ts caches config - see that file's comment for why a per-isolate cache
// with no cross-isolate invalidation is fine here (nothing in this slice writes to either table
// after the seed migrations).

import type { Env } from '../types';

export interface BreedRow {
  id: number;
  code: string;
  name: string;
  enabled: number;
  is_recognised_cross: number;
  founding_allele_pool: string;
  gaited_typical: number;
}

export interface LocusRow {
  id: number;
  code: string;
  name: string;
  category: string;
  inheritance: string;
  alleles: string;
  teaching_text: string;
  enabled: number;
  sort_order: number;
}

const CACHE_MS = 60_000;

let breedsCache: { rows: BreedRow[]; expiresAtMs: number } | null = null;
let lociCache: { rows: LocusRow[]; expiresAtMs: number } | null = null;

export async function getBreeds(env: Env): Promise<BreedRow[]> {
  const now = Date.now();
  if (breedsCache && breedsCache.expiresAtMs > now) return breedsCache.rows;
  const result = await env.DB.prepare('SELECT * FROM breeds ORDER BY id ASC').all<BreedRow>();
  const rows = result.results ?? [];
  breedsCache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

export async function getBreedById(env: Env, id: number): Promise<BreedRow | undefined> {
  return (await getBreeds(env)).find((b) => b.id === id);
}

export async function getLoci(env: Env): Promise<LocusRow[]> {
  const now = Date.now();
  if (lociCache && lociCache.expiresAtMs > now) return lociCache.rows;
  const result = await env.DB.prepare('SELECT * FROM loci ORDER BY sort_order ASC').all<LocusRow>();
  const rows = result.results ?? [];
  lociCache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}
