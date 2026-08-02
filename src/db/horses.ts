import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { deriveSeed, makeRng } from '../lib/rng';
import { serializeGenotype, type Genotype } from '../engines/genetics/genotype';
import { coefficientOfInbreeding, type AncestorEdge, type PedigreeHorse } from '../engines/genetics/pedigree';
import { rollEnvironmentalNoise, serializeNoise } from '../engines/conformation/model';
import { buildHorseConditionStatements, type ConditionRow } from './health';
import { rollLifespanGameDays, type LifespanRollConfig } from '../engines/ageing/lifespan';

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
  /** Slice 0007 §5.2. Root-relative path into the library, e.g. /horses/qh-03.webp. Null means no
   * picture chosen - true for every horse born before this slice and for an unpicked new foal
   * alike (no auto-assign). image_source is null exactly when this is null. */
  image_url: string | null;
  image_source: 'library' | 'custom' | 'generated' | null;
  /** Slice 0006 §5.2. JSON, { v: 1, noise: { <trait code>: <integer offset> } }. Null means born
   * before this slice - read via src/engines/conformation/model.ts's legacy fallback, never
   * backfilled. */
  environmental_noise: string | null;
  /** Slice 0011 §4.1/§5.1. The day old age takes this horse, rolled once at creation and never
   * rerolled. Null until the tick's backfill stage assigns one (§7.1) - every horse alive before
   * this slice deployed is in that state until the first tick afterwards. Never rendered to a
   * player, in any form, ever (§5.1). */
  natural_death_game_day: number | null;
  /** Slice 0011 §5.1/§7.2. The day the "failing" event fired, null until it has - its own
   * idempotency marker, not rendered anywhere. */
  frailty_notice_game_day: number | null;
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

/** The barn list only (slice 0010 §1 step 9, extended by slice 0011 §8.1): alive horses always,
 * plus dead or removed ones for a while after they ended - so a horse killed by a lethal condition
 * or retired away stays visible, marked Died/Retired away, rather than vanishing the moment it
 * ends. cutoffGameDay is the caller's own `gameDay - barn_shows_ended_game_days` (live config, read
 * fresh) - an ended horse older than that drops out, still reachable from
 * /stables/:id/past. Every other caller of listStableHorses (breeding, the NPC show barn's field,
 * the image picker's "also used by" check) wants alive-only, unchanged - do not swap those to this
 * function. */
export async function listStableHorsesWithDead(env: Env, stableId: number, cutoffGameDay: number): Promise<HorseRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM horses WHERE owner_stable_id = ?
       AND (status = 'alive' OR (status IN ('dead', 'removed') AND ended_game_day >= ?))
     ORDER BY born_game_day ASC, id ASC`
  )
    .bind(stableId, cutoffGameDay)
    .all<HorseRow>();
  return result.results ?? [];
}

/** /stables/:id/past (slice 0011 §8.1): every horse this stable ever owned that has since died or
 * been retired away, newest-ended first - no cutoff, unlike listStableHorsesWithDead above. */
export async function listPastHorses(env: Env, stableId: number): Promise<HorseRow[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM horses WHERE owner_stable_id = ? AND status IN ('dead', 'removed') ORDER BY ended_game_day DESC, id DESC`
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

/** The one place this rule lives: a registered name if there is one, else a barn name, else
 * "Unnamed filly/colt". render/horses.ts's displayNameFor is this function, kept there under its
 * existing name for the render-layer call sites that already import it from there - db-layer
 * callers (event payloads, tick stages) that have no render dependency otherwise use this directly. */
export function horseDisplayName(horse: Pick<HorseRow, 'registered_name' | 'barn_name' | 'sex'>): string {
  if (horse.registered_name) return horse.registered_name;
  if (horse.barn_name) return horse.barn_name;
  return horse.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt';
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

export interface FoundingHorseInsertInput {
  stableId: number;
  sex: 'mare' | 'stallion' | 'gelding';
  breedId: number;
  breedCode: string;
  registeredName: string;
  /** Null for the admin founder form (nobody bred this horse); an origin prefix for claimed
   * founding stock (slice 0005 §6.5 - a prefix means "bred by", never the claiming stable's own). */
  breederPrefix: string | null;
  bornGameDay: number;
  genotype: Genotype;
  rngSeed: number;
  /** Only consulted for mares - slice 0003 §3.2 rolls a founding mare's cycle slot at creation. */
  worldTickSeq: number;
  estrousCycleTicks: number;
  /** Slice 0006 §4.2: rolls this horse's environmental noise, once, from its own seed. */
  conformationNoiseSd: number;
  /** Slice 0010 §6.3: the enabled conditions rows, and what a lethal foal's death window is right
   * now - both threaded from the caller rather than read here, since this file does no config
   * reads of its own. Null accountId (the NPC show barn) means no condition_signs event is ever
   * written, per buildConditionSignsEventStatement's own guard. */
  conditions: ConditionRow[];
  lethalFoalDeathGameDays: number;
  accountId: number | null;
  /** Slice 0011 §7.1: rolls and snapshots natural_death_game_day here, at creation, from this
   * horse's own seed - the one place every founding path (the admin form, a claimed batch, the NPC
   * show barn) already shares for horse_conditions rows, so it is also the one place this needs
   * wiring in. */
  lifespanConfig: LifespanRollConfig;
}

/**
 * Builds (but does not run) the statements that insert a founding horse's row, plus any
 * horse_conditions rows its genotype reads as affected - the admin founder form (slice 0002 §6.1)
 * and claimed founding stock (slice 0005 §6.6) both go through this rather than a second insert
 * path. generation = 0, coi = 0, no breeder_stable_id (nobody in this game bred it) and no
 * horse_ancestors rows - unlike a foal, a founding horse has no pedigree to record.
 *
 * Callers must run these in one env.DB.batch(), with the horse insert (statement 0) landing before
 * anything else touches `horses` - the same "(SELECT id FROM horses ORDER BY id DESC LIMIT 1)"
 * pattern buildFoalInsertStatements' ancestor rows use, so the conditions rows below land against
 * the right horse.
 */
export function buildFoundingHorseInsertStatements(env: Env, input: FoundingHorseInsertInput): D1PreparedStatement[] {
  const composition = JSON.stringify({ [input.breedCode]: 1 });
  const nowSeconds = nowUtcSeconds();
  // Slice 0003 §3.2: rolled once from the horse's own seed, not the shared world seed, so it's
  // reproducible from this row alone the same way every other draw in the game is.
  const cycleAnchorTickSeq =
    input.sex === 'mare' ? input.worldTickSeq + makeRng(deriveSeed(input.rngSeed, 'cycle_slot')).int(input.estrousCycleTicks) : null;
  const environmentalNoise = serializeNoise(rollEnvironmentalNoise(input.rngSeed, input.conformationNoiseSd));
  // Slice 0011 §4.2/§7.1: a new sub-seed label, independent of every stream that already derives
  // from this horse's rng_seed - rolled once here and never rerolled.
  const naturalDeathGameDay = input.bornGameDay + rollLifespanGameDays(makeRng(deriveSeed(input.rngSeed, 'lifespan')), input.lifespanConfig);

  return [
    env.DB.prepare(
      `INSERT INTO horses (
         sex, registered_name, barn_name, breeder_prefix, breed_id, is_cross, composition,
         sire_id, dam_id, generation, coi, owner_stable_id, breeder_stable_id,
         born_game_day, status, created_real_ts, genotype, rng_seed, cycle_anchor_tick_seq,
         environmental_noise, natural_death_game_day
       ) VALUES (?, ?, NULL, ?, ?, 0, ?, NULL, NULL, 0, 0, ?, NULL, ?, 'alive', ?, ?, ?, ?, ?, ?)`
    ).bind(
      input.sex,
      input.registeredName,
      input.breederPrefix,
      input.breedId,
      composition,
      input.stableId,
      input.bornGameDay,
      nowSeconds,
      serializeGenotype(input.genotype),
      input.rngSeed,
      cycleAnchorTickSeq,
      environmentalNoise,
      naturalDeathGameDay
    ),
    ...buildHorseConditionStatements(env, {
      genotype: input.genotype,
      bornGameDay: input.bornGameDay,
      lethalFoalDeathGameDays: input.lethalFoalDeathGameDays,
      stableId: input.stableId,
      accountId: input.accountId,
      horseName: input.registeredName,
      conditions: input.conditions,
    }),
  ];
}

export interface CreateFoundingHorseInput {
  stableId: number;
  sex: 'mare' | 'stallion' | 'gelding';
  breedId: number;
  breedCode: string;
  name: string;
  bornGameDay: number;
  /** The full genotype, mendelian pairs chosen on the form plus a polygenic block already
   * generated by the caller (routes/admin.ts, via generateFounderPolygenic) - slice 0005 §6.6
   * moves that call out of this database layer, which no longer does any genetics of its own. */
  genotype: Genotype;
  /** Minted by the caller with randomSeed() - needed there already, to derive
   * deriveSeed(seed, "founder_polygenic") before this function is even called. */
  rngSeed: number;
  worldTickSeq: number;
  estrousCycleTicks: number;
  conformationNoiseSd: number;
  conditions: ConditionRow[];
  lethalFoalDeathGameDays: number;
  /** The stable's own account, so a condition_signs event can be written - null for the NPC show
   * barn (slice 0010 §6.3). */
  accountId: number | null;
  lifespanConfig: LifespanRollConfig;
}

export type CreateFoundingHorseResult = { ok: true; horseId: number } | { ok: false; error: 'name_taken' };

/** The admin founder form's insert path - thin wrapper around buildFoundingHorseInsertStatements
 * that runs its statements in one batch (now more than one, since slice 0010 - the horse insert
 * plus any condition rows its genotype triggers) and translates a name collision. */
export async function createFoundingHorse(env: Env, input: CreateFoundingHorseInput): Promise<CreateFoundingHorseResult> {
  const statements = buildFoundingHorseInsertStatements(env, {
    stableId: input.stableId,
    sex: input.sex,
    breedId: input.breedId,
    breedCode: input.breedCode,
    registeredName: input.name,
    breederPrefix: null,
    bornGameDay: input.bornGameDay,
    genotype: input.genotype,
    rngSeed: input.rngSeed,
    worldTickSeq: input.worldTickSeq,
    estrousCycleTicks: input.estrousCycleTicks,
    conformationNoiseSd: input.conformationNoiseSd,
    conditions: input.conditions,
    lethalFoalDeathGameDays: input.lethalFoalDeathGameDays,
    accountId: input.accountId,
    lifespanConfig: input.lifespanConfig,
  });

  try {
    const results = await env.DB.batch(statements);
    return { ok: true, horseId: results[0].meta.last_row_id };
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
  /** Slice 0006 §4.2: rolls this foal's environmental noise, once, from its own (already-minted at
   * conception) rngSeed. */
  conformationNoiseSd: number;
  /** Slice 0010 §6.3, same as FoundingHorseInsertInput's own fields. */
  conditions: ConditionRow[];
  lethalFoalDeathGameDays: number;
  accountId: number | null;
  /** Slice 0011 §7.1: same as FoundingHorseInsertInput's own field. */
  lifespanConfig: LifespanRollConfig;
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
  const environmentalNoise = serializeNoise(rollEnvironmentalNoise(input.rngSeed, input.conformationNoiseSd));
  const naturalDeathGameDay = input.bornGameDay + rollLifespanGameDays(makeRng(deriveSeed(input.rngSeed, 'lifespan')), input.lifespanConfig);

  return [
    env.DB.prepare(
      `INSERT INTO horses (
         sex, registered_name, barn_name, breeder_prefix, breed_id, is_cross, composition,
         sire_id, dam_id, generation, coi, owner_stable_id, breeder_stable_id,
         born_game_day, status, created_real_ts, genotype, rng_seed, cycle_anchor_tick_seq,
         environmental_noise, natural_death_game_day
       ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'alive', ?, ?, ?, ?, ?, ?)`
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
      input.cycleAnchorTickSeq,
      environmentalNoise,
      naturalDeathGameDay
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
    // Slice 0010 §6.3: same subquery pattern as the ancestor rows above, and safe for the same
    // reason - nothing else inserts into `horses` between the insert above and these landing. Must
    // stay before buildFoaledEventStatement in the caller's own batch array (it already is,
    // pregnancies.ts spreads this function's result first) - that statement also relies on being
    // the last thing in the batch to still find the foal via the same "highest id" subquery.
    ...buildHorseConditionStatements(env, {
      genotype: input.genotype,
      bornGameDay: input.bornGameDay,
      lethalFoalDeathGameDays: input.lethalFoalDeathGameDays,
      stableId: input.ownerStableId,
      accountId: input.accountId,
      horseName: horseDisplayName({ registered_name: null, barn_name: null, sex: input.sex }),
      conditions: input.conditions,
    }),
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

/**
 * Sets or clears a horse's chosen picture (slice 0007 §6.2). Pass null for "No picture", or an
 * already-validated library path (see isAllowedImagePath in src/lib/images.ts - the caller must
 * validate before calling this; this function does not). image_source is 'library' exactly when
 * imageUrl is non-null, keeping the two columns null together as the migration's comment requires.
 */
export async function setHorseImage(env: Env, horseId: number, imageUrl: string | null): Promise<void> {
  await env.DB.prepare('UPDATE horses SET image_url = ?, image_source = ? WHERE id = ?')
    .bind(imageUrl, imageUrl ? 'library' : null, horseId)
    .run();
}
