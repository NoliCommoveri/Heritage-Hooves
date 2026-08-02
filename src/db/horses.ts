import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';
import { getStableById } from './stables';
import {
  parseGenotype,
  serializeGenotype,
  GENOTYPE_VERSION,
  type Genotype,
  type AllelePair,
} from '../engines/genetics/genotype';
import { combine } from '../engines/genetics/inheritance';
import { generateFounderPolygenic } from '../engines/genetics/polygenic';
import { buildAncestorRows, coefficientOfInbreeding, type AncestorEdge, type PedigreeHorse } from '../engines/genetics/pedigree';
import { foalComposition } from '../engines/genetics/composition';

export interface HorseRow {
  id: number;
  sex: 'mare' | 'stallion' | 'gelding';
  registered_name: string | null;
  barn_name: string | null;
  breeder_prefix: string | null;
  breed_id: number | null;
  is_cross: number;
  composition: string;
  sire_id: number | null;
  dam_id: number | null;
  generation: number;
  coi: number;
  owner_stable_id: number;
  breeder_stable_id: number | null;
  born_game_day: number;
  ended_game_day: number | null;
  status: 'alive' | 'dead' | 'removed';
  end_reason: string | null;
  last_foaled_game_day: number | null;
  created_real_ts: number;
  genotype: string;
  rng_seed: number;
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /unique constraint failed/i.test(err.message);
}

export async function listStableHorses(env: Env, stableId: number): Promise<HorseRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM horses WHERE owner_stable_id = ? AND status = 'alive' ORDER BY born_game_day ASC, id ASC`
  )
    .bind(stableId)
    .all<HorseRow>();
  return result.results ?? [];
}

export async function countAliveHorses(env: Env, stableId: number): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM horses WHERE owner_stable_id = ? AND status = 'alive'`)
    .bind(stableId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getHorse(env: Env, id: number): Promise<HorseRow | null> {
  return env.DB.prepare('SELECT * FROM horses WHERE id = ?').bind(id).first<HorseRow>();
}

export async function loadAncestorEdges(env: Env, horseId: number): Promise<AncestorEdge[]> {
  const result = await env.DB.prepare('SELECT ancestor_id, depth, path_count FROM horse_ancestors WHERE descendant_id = ?')
    .bind(horseId)
    .all<{ ancestor_id: number; depth: number; path_count: number }>();
  return (result.results ?? []).map((r) => ({ ancestorId: r.ancestor_id, depth: r.depth, pathCount: r.path_count }));
}

/**
 * The two-query load (slice 0002 §8): every ancestor id either parent has (one query), then those
 * horses' own (id, sire_id, dam_id, coi) rows plus the parents' own rows (a second query). Used
 * identically by the breeding preview and by breedNow, which is what guarantees the number shown
 * before confirming is the number the foal actually gets.
 */
export async function loadPedigreeContext(env: Env, sireId: number, damId: number): Promise<Map<number, PedigreeHorse>> {
  const ancestorIdRows = await env.DB.prepare('SELECT DISTINCT ancestor_id FROM horse_ancestors WHERE descendant_id IN (?, ?)')
    .bind(sireId, damId)
    .all<{ ancestor_id: number }>();

  const ids = new Set<number>([sireId, damId, ...(ancestorIdRows.results ?? []).map((r) => r.ancestor_id)]);
  const idList = Array.from(ids);
  const map = new Map<number, PedigreeHorse>();
  if (idList.length === 0) return map;

  const placeholders = idList.map(() => '?').join(', ');
  const horseRows = await env.DB.prepare(`SELECT id, sire_id, dam_id, coi FROM horses WHERE id IN (${placeholders})`)
    .bind(...idList)
    .all<{ id: number; sire_id: number | null; dam_id: number | null; coi: number }>();

  for (const row of horseRows.results ?? []) {
    map.set(row.id, { sireId: row.sire_id, damId: row.dam_id, coi: row.coi });
  }
  return map;
}

/** The COI a hypothetical sire x dam pairing would produce, without writing anything. */
export async function previewCoi(env: Env, sireId: number, damId: number): Promise<number> {
  const horses = await loadPedigreeContext(env, sireId, damId);
  return coefficientOfInbreeding(sireId, damId, horses);
}

export interface CreateFoundingHorseInput {
  stableId: number;
  sex: 'mare' | 'stallion' | 'gelding';
  breedId: number;
  breedCode: string;
  name: string;
  bornGameDay: number;
  mendelian: Record<string, AllelePair>;
}

export type CreateFoundingHorseResult = { ok: true; horseId: number } | { ok: false; error: 'name_taken' };

/**
 * The admin founder form (slice 0002 §6.1). Mints a fresh rng_seed and generates the polygenic
 * loci from deriveSeed(seed, "founder_polygenic") - the mendelian pairs come from the admin's own
 * choices on the form, not from a draw. generation = 0, coi = 0, no breeder_stable_id or
 * breeder_prefix (nobody bred this horse), no horse_ancestors rows.
 */
export async function createFoundingHorse(env: Env, input: CreateFoundingHorseInput): Promise<CreateFoundingHorseResult> {
  const seed = randomSeed();
  const polygenicRng = makeRng(deriveSeed(seed, 'founder_polygenic'));
  const genotype: Genotype = { v: GENOTYPE_VERSION, mendelian: input.mendelian, polygenic: generateFounderPolygenic(polygenicRng) };
  const composition = JSON.stringify({ [input.breedCode]: 1 });
  const nowSeconds = nowUtcSeconds();

  try {
    const result = await env.DB.prepare(
      `INSERT INTO horses (
         sex, registered_name, barn_name, breeder_prefix, breed_id, is_cross, composition,
         sire_id, dam_id, generation, coi, owner_stable_id, breeder_stable_id,
         born_game_day, status, created_real_ts, genotype, rng_seed
       ) VALUES (?, ?, NULL, NULL, ?, 0, ?, NULL, NULL, 0, 0, ?, NULL, ?, 'alive', ?, ?, ?)`
    )
      .bind(input.sex, input.name, input.breedId, composition, input.stableId, input.bornGameDay, nowSeconds, serializeGenotype(genotype), seed)
      .run();
    return { ok: true, horseId: result.meta.last_row_id };
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, error: 'name_taken' };
    throw err;
  }
}

export interface BreedNowInput {
  stableId: number;
  sireId: number;
  damId: number;
  gameDay: number;
}

export interface BreedNowResult {
  foalId: number;
}

/**
 * §2.4: this is a stand-in for conception-plus-gestation. Press the button, the foal exists
 * immediately - there is no pregnancies row and no tick involved. The real version creates a
 * pregnancies row and lets the tick foal it; everything from the genotype downward (this
 * function's body from the seed mint on) is meant to be reusable as-is when that lands. Only the
 * "when does the foal row get inserted" question should need rewriting.
 *
 * Caller has already validated the pairing (both alive, owned, correct sexes, age, mare recovery,
 * capacity) - this function assumes a valid pairing and just builds the foal.
 */
export async function breedNow(env: Env, input: BreedNowInput): Promise<BreedNowResult> {
  const [sire, dam, stable] = await Promise.all([getHorse(env, input.sireId), getHorse(env, input.damId), getStableById(env, input.stableId)]);
  if (!sire || !dam || !stable) throw new Error('breedNow: sire, dam or stable not found');

  const [sireEdges, damEdges, pedigreeHorses] = await Promise.all([
    loadAncestorEdges(env, input.sireId),
    loadAncestorEdges(env, input.damId),
    loadPedigreeContext(env, input.sireId, input.damId),
  ]);

  const foalSeed = randomSeed();
  const genotype = combine(parseGenotype(sire.genotype), parseGenotype(dam.genotype), foalSeed);
  const sex = makeRng(deriveSeed(foalSeed, 'sex')).pick(['mare', 'stallion'] as const);
  const generation = Math.max(sire.generation, dam.generation) + 1;
  // Computed from the same loaded map the preview used, before the insert - the number shown at
  // "Check pairing" is the number the foal gets (slice 0002 §2.6, §6.4).
  const coi = coefficientOfInbreeding(input.sireId, input.damId, pedigreeHorses);
  const comp = foalComposition(
    { composition: JSON.parse(sire.composition), isCross: sire.is_cross === 1, breedId: sire.breed_id },
    { composition: JSON.parse(dam.composition), isCross: dam.is_cross === 1, breedId: dam.breed_id }
  );
  const ancestorRows = buildAncestorRows(input.sireId, input.damId, sireEdges, damEdges);
  const nowSeconds = nowUtcSeconds();

  const statements = [
    env.DB.prepare(
      `INSERT INTO horses (
         sex, registered_name, barn_name, breeder_prefix, breed_id, is_cross, composition,
         sire_id, dam_id, generation, coi, owner_stable_id, breeder_stable_id,
         born_game_day, status, created_real_ts, genotype, rng_seed
       ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alive', ?, ?, ?)`
    ).bind(
      sex,
      stable.prefix,
      comp.breedId,
      comp.isCross ? 1 : 0,
      JSON.stringify(comp.composition),
      input.sireId,
      input.damId,
      generation,
      coi,
      input.stableId,
      input.stableId,
      input.gameDay,
      nowSeconds,
      serializeGenotype(genotype),
      foalSeed
    ),
    // Each ancestor row references the foal via a fresh subquery rather than last_insert_rowid(),
    // because last_insert_rowid() reflects the single most recent insert on this connection and
    // would go stale after the FIRST horse_ancestors row if reused for the rest. All of this runs
    // inside one D1 batch (one transaction), so no other writer can insert into horses in between -
    // "the highest id in horses" stays correctly the foal's id for every statement below.
    ...ancestorRows.map((row) =>
      env.DB.prepare(
        `INSERT INTO horse_ancestors (descendant_id, ancestor_id, depth, path_count)
         VALUES ((SELECT id FROM horses ORDER BY id DESC LIMIT 1), ?, ?, ?)`
      ).bind(row.ancestorId, row.depth, row.pathCount)
    ),
    env.DB.prepare('UPDATE horses SET last_foaled_game_day = ? WHERE id = ?').bind(input.gameDay, input.damId),
    // The breeding slice is what sets prefix_locked=1 (slice 0001 built the column and said so).
    // Set unconditionally - it's already 1 or it's about to be.
    env.DB.prepare('UPDATE stables SET prefix_locked = 1 WHERE id = ?').bind(input.stableId),
  ];

  const results = await env.DB.batch(statements);
  return { foalId: results[0].meta.last_row_id };
}

export type RegisterNameResult = { ok: true } | { ok: false; error: 'taken' } | { ok: false; error: 'already_named' };

export async function registerHorseName(env: Env, horseId: number, registeredName: string): Promise<RegisterNameResult> {
  const horse = await getHorse(env, horseId);
  if (!horse) throw new Error('horse not found');
  if (horse.registered_name !== null) return { ok: false, error: 'already_named' };

  try {
    await env.DB.prepare("UPDATE horses SET registered_name = ? WHERE id = ? AND registered_name IS NULL").bind(registeredName, horseId).run();
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, error: 'taken' };
    throw err;
  }
  return { ok: true };
}

export async function setBarnName(env: Env, horseId: number, barnName: string | null): Promise<void> {
  await env.DB.prepare('UPDATE horses SET barn_name = ? WHERE id = ?').bind(barnName, horseId).run();
}
