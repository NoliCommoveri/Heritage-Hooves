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
  /** Slice 0007 §5.1/§2.3: how many numbered pictures exist for this breed in public/horses/. The
   * picker derives its list from this rather than a directory listing or a manifest file. */
  image_count: number;
  /** Slice 0008 §4.2/§5.2. JSON, { v: 1, traits: { <conformation trait code>: {target, weight} } },
   * or null. Null means no breed class can be created for this breed yet - true of every breed but
   * the Quarter Horse until their own stage lands. Parse with src/engines/showing/score.ts's
   * parseIdealVector. */
  ideal_vector: string | null;
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

/**
 * Slice 0007 §5.3: /admin/breeds is the first thing that writes to this table, so the 60-second
 * module cache this file's own comment used to be able to ignore now needs clearing after a write
 * - otherwise the admin's own next page load could show the stale count for up to a minute.
 * Deliberately not cross-isolate (see that comment, and slice 0007 §5.3): a different isolate can
 * still serve a stale count for up to a minute after a save, which is why /admin/breeds says so in
 * plain English rather than pretending this is instant.
 */
export async function updateBreedImageCounts(env: Env, counts: { breedId: number; imageCount: number }[]): Promise<void> {
  if (counts.length === 0) return;
  const statements = counts.map((c) =>
    env.DB.prepare('UPDATE breeds SET image_count = ? WHERE id = ?').bind(c.imageCount, c.breedId)
  );
  await env.DB.batch(statements);
  breedsCache = null;
}
