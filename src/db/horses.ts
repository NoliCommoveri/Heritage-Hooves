import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';
import {
  serializeGenotype,
  GENOTYPE_VERSION,
  type Genotype,
  type AllelePair,
} from '../engines/genetics/genotype';
import { generateFounderPolygenic } from '../engines/genetics/polygenic';
import { coefficientOfInbreeding, type AncestorEdge, type PedigreeHorse } from '../engines/genetics/pedigree';

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
  /** Slice 0003 §3.2. Mares only; null for stallions, geldings, and mares not yet backfilled. */
  cycle_anchor_tick_seq: number | null;
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
 * identically by the breeding preview and by the tick's conception roll (slice 0003 §4.6), which
 * is what guarantees the number shown before booking is the number the foal actually gets.
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
  /** Only consulted for mares - slice 0003 §3.2 rolls a founding mare's cycle slot at creation. */
  worldTickSeq: number;
  estrousCycleTicks: number;
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
  // Slice 0003 §3.2: rolled once from the horse's own seed, not the shared world seed, so it's
  // reproducible from this row alone the same way every other draw in the game is.
  const cycleAnchorTickSeq =
    input.sex === 'mare' ? input.worldTickSeq + makeRng(deriveSeed(seed, 'cycle_slot')).int(input.estrousCycleTicks) : null;

  try {
    const result = await env.DB.prepare(
      `INSERT INTO horses (
         sex, registered_name, barn_name, breeder_prefix, breed_id, is_cross, composition,
         sire_id, dam_id, generation, coi, owner_stable_id, breeder_stable_id,
         born_game_day, status, created_real_ts, genotype, rng_seed, cycle_anchor_tick_seq
       ) VALUES (?, ?, NULL, NULL, ?, 0, ?, NULL, NULL, 0, 0, ?, NULL, ?, 'alive', ?, ?, ?, ?)`
    )
      .bind(
        input.sex,
        input.name,
        input.breedId,
        composition,
        input.stableId,
        input.bornGameDay,
        nowSeconds,
        serializeGenotype(genotype),
        seed,
        cycleAnchorTickSeq
      )
      .run();
    return { ok: true, horseId: result.meta.last_row_id };
  } catch (err) {
    if (isUniqueConstraintError(err)) return { ok: false, error: 'name_taken' };
    throw err;
  }
}

export interface FoalInsertInput {
  sex: 'mare' | 'stallion';
  sireId: number;
  damId: number;
  ownerStableId: number;
  breederStableId: number;
  breederPrefix: string;
  breedId: number | null;
  isCross: boolean;
  composition: Record<string, number>;
  generation: number;
  coi: number;
  bornGameDay: number;
  genotype: Genotype;
  rngSeed: number;
  ancestorRows: AncestorEdge[];
  /** Rolled by the caller the same way createFoundingHorse rolls one (slice 0003 §3.2) - null for colts. */
  cycleAnchorTickSeq: number | null;
}

/**
 * Builds (but does not run) the statements that insert a foal's horses row plus its
 * horse_ancestors rows. Shared by the tick's foaling stage (slice 0003 §10) - the genotype, coi
 * and ancestor rows are already resolved by the caller (rolled at conception, per slice 0003 §3.9)
 * so this is purely "write the row down". Slice 0002's breedNow() used to do this and the insert
 * inline in one step; slice 0003 §3.11 deletes breedNow and moves its body here so both the
 * genotype-rolling (now at conception) and the row-insert (now at foaling) sides can reuse it.
 *
 * Caller must run these in one env.DB.batch() immediately after any other statements that also
 * need the just-inserted foal's id, since the ancestor-row inserts below find it via
 * "SELECT id FROM horses ORDER BY id DESC LIMIT 1" - see the comment on that pattern below.
 */
export function buildFoalInsertStatements(env: Env, input: FoalInsertInput): D1PreparedStatement[] {
  const nowSeconds = nowUtcSeconds();

  return [
    env.DB.prepare(
      `INSERT INTO horses (
         sex, registered_name, barn_name, breeder_prefix, breed_id, is_cross, composition,
         sire_id, dam_id, generation, coi, owner_stable_id, breeder_stable_id,
         born_game_day, status, created_real_ts, genotype, rng_seed, cycle_anchor_tick_seq
       ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alive', ?, ?, ?, ?)`
    ).bind(
      input.sex,
      input.breederPrefix,
      input.breedId,
      input.isCross ? 1 : 0,
      JSON.stringify(input.composition),
      input.sireId,
      input.damId,
      input.generation,
      input.coi,
      input.ownerStableId,
      input.breederStableId,
      input.bornGameDay,
      nowSeconds,
      serializeGenotype(input.genotype),
      input.rngSeed,
      input.cycleAnchorTickSeq
    ),
    // Each ancestor row references the foal via a fresh subquery rather than last_insert_rowid(),
    // because last_insert_rowid() reflects the single most recent insert on this connection and
    // would go stale after the FIRST horse_ancestors row if reused for the rest. This relies on the
    // caller running these statements inside one D1 batch (one transaction) immediately after the
    // insert above, with nothing else inserting into horses in between - "the highest id in horses"
    // then stays correctly the foal's id for every statement below.
    ...input.ancestorRows.map((row) =>
      env.DB.prepare(
        `INSERT INTO horse_ancestors (descendant_id, ancestor_id, depth, path_count)
         VALUES ((SELECT id FROM horses ORDER BY id DESC LIMIT 1), ?, ?, ?)`
      ).bind(row.ancestorId, row.depth, row.pathCount)
    ),
  ];
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
