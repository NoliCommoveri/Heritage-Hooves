// breeds and loci: tiny, read constantly, edited approximately never. Cached in module scope the
// way src/lib/config-cache.ts caches config - see that file's comment for why a per-isolate cache
// with no cross-isolate invalidation is fine here (nothing in this slice writes to either table
// after the seed migrations).

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { parseAllelePool } from '../engines/founding/pool';

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

/**
 * Amendment 0017a §6.1/§6.2: `enabled` gates admission of NEW horses of a breed - founding offers,
 * the consignment dealer, admin creation, new npc_policy targets, new show classes - and nothing
 * else. Every one of those five call sites reads this instead of getBreeds directly (§8's own
 * warning: prefer one helper every creation path calls over five scattered `WHERE enabled = 1`
 * clauses). Never used to filter what an EXISTING horse, class or listing can do.
 */
export async function getBreedsInPlay(env: Env): Promise<BreedRow[]> {
  return (await getBreeds(env)).filter((b) => b.enabled === 1);
}

export type SetBreedEnabledResult = { ok: true } | { ok: false; error: 'last_enabled' } | { ok: false; error: 'missing_locus'; locusCode: string };

/**
 * §6.3's two guards, enforced here (not only in the route) so nothing that calls this later skips
 * them: refuse disabling the last breed in play, and refuse enabling one whose pool is missing a
 * locus (0005 §3.2 - pool.ts throws with the locus named; this catches that throw and turns it into
 * a refusal rather than a broken founding offer down the line). Writes a config_audit row under
 * `breed:<code>:enabled`, reusing that table's generic key/old/new shape (§6.4) rather than a
 * second history table.
 */
export async function setBreedEnabled(env: Env, breedId: number, enabled: boolean, accountId: number | null, gameDay: number): Promise<SetBreedEnabledResult> {
  const breeds = await getBreeds(env);
  const breed = breeds.find((b) => b.id === breedId);
  if (!breed) throw new Error(`setBreedEnabled: breed ${String(breedId)} not found`);
  if (breed.enabled === (enabled ? 1 : 0)) return { ok: true };

  if (!enabled) {
    const anotherStaysEnabled = breeds.some((b) => b.id !== breedId && b.enabled === 1);
    if (!anotherStaysEnabled) return { ok: false, error: 'last_enabled' };
  } else {
    try {
      parseAllelePool(breed.founding_allele_pool);
    } catch (err) {
      const match = err instanceof Error ? /locus (\S+)/.exec(err.message) : null;
      return { ok: false, error: 'missing_locus', locusCode: match?.[1] ?? breed.code };
    }
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE breeds SET enabled = ? WHERE id = ?').bind(enabled ? 1 : 0, breedId),
    env.DB
      .prepare('INSERT INTO config_audit (changed_by_account_id, real_ts, game_day, path, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(accountId, nowUtcSeconds(), gameDay, `breed:${breed.code}:enabled`, JSON.stringify(breed.enabled === 1), JSON.stringify(enabled)),
  ]);
  breedsCache = null;
  return { ok: true };
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
