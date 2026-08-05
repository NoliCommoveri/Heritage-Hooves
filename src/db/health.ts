// Reference data (conditions) plus the two real tables slice 0010 introduces - horse_knowledge
// (what a stable has paid to learn) and horse_conditions (what is actually true). Also the tick's
// death stage. Everything genuinely genetic runs through src/engines/health/status.ts; this file is
// the thin database layer around it, same split as db/breeds.ts/genetics or db/shows.ts/showing.

import type { Env } from '../types';
import type { Genotype } from '../engines/genetics/genotype';
import { parseGenotype, getMendelianPair } from '../engines/genetics/genotype';
import { conditionStatus, parseConditionTrigger, lethalTerminalGameDay, ownerVisibleStatus, type ConditionStatusLabel } from '../engines/health/status';
import type { LethalTrigger } from '../engines/founding/generate';
import { buildEventStatement } from './events';
import { breedingHealthWarnings } from '../engines/health/breedingWarning';
import { conditionDelta, type ConditionDeltaResult, type ManageableConditionState } from '../engines/health/management';
import { panelFor } from '../engines/health/panel';
import { getBreeds } from './breeds';
import { parseAllelePool, type AllelePool } from '../engines/founding/pool';
import { deriveSeed, makeRng } from '../lib/rng';

export interface ConditionRow {
  id: number;
  code: string;
  name: string;
  category: string;
  locus_code: string | null;
  trigger: string;
  severity_class: 'lethal' | 'manageable' | 'degenerative' | 'latent';
  signs_visible: number;
  bars_showing: number;
  breed_associations: string;
  test_cost_key: string | null;
  enabled: number;
  teaching_text: string;
  event_text: string;
  sort_order: number;
  /** Slice 0014 §5.3/§7: what a management plan actually consists of, in a sentence a child can
   * read. Non-null only for severity_class = 'manageable' rows. */
  management_text: string | null;
  /** docs/fixes/breed-disease-panels.md: how many game days after a horse_conditions row is
   * written (birth, founding, consignment) before its signs become visible, drawn once per horse
   * from a range. Both 0 for a condition that is visible immediately (today's behaviour, and every
   * row's default) - only meaningful when signs_visible = 1. */
  signs_delay_min_game_days: number;
  signs_delay_max_game_days: number;
}

const CACHE_MS = 60_000;
let conditionsCache: { rows: ConditionRow[]; expiresAtMs: number } | null = null;

/** All conditions, reference data cached the same way db/breeds.ts caches breeds and loci -
 * nothing in this slice ever writes to this table after the seed migration. */
export async function getConditions(env: Env): Promise<ConditionRow[]> {
  const now = Date.now();
  if (conditionsCache && conditionsCache.expiresAtMs > now) return conditionsCache.rows;
  const result = await env.DB.prepare('SELECT * FROM conditions ORDER BY sort_order ASC').all<ConditionRow>();
  const rows = result.results ?? [];
  conditionsCache = { rows, expiresAtMs: now + CACHE_MS };
  return rows;
}

export async function getEnabledConditions(env: Env): Promise<ConditionRow[]> {
  return (await getConditions(env)).filter((c) => c.enabled === 1);
}

/**
 * Slice 0010 §4.3's clamp, as data: every enabled lethal condition's (locus, mutant) pair, derived
 * from the conditions table so engines/founding/generate.ts's generator never has to know what
 * GBED is.
 */
export async function getLethalTriggers(env: Env): Promise<LethalTrigger[]> {
  const conditions = await getEnabledConditions(env);
  return conditions
    .filter((c) => c.severity_class === 'lethal' && c.locus_code !== null)
    .map((c) => {
      const trigger = parseConditionTrigger(c.trigger);
      return { locus: trigger.locus, mutant: trigger.mutant };
    });
}

// ---------------------------------------------------------------------------
// The breed disease panel (docs/fixes/breed-disease-panels.md) - which conditions are worth
// testing/disclosing for a given horse, wired to real data via engines/health/panel.ts's pure
// panelFor. Never used on a truth call site (buildHorseConditionStatements, killDueLethalFoals,
// isBarredFromShowing, visibleAffectedConditions, getLethalTriggers, conditionCensus) - only on the
// offer-and-disclosure surfaces the fix document names.
// ---------------------------------------------------------------------------

/** The horse's own breeds.code, UNION the distinct codes reached through horse_ancestors (up to
 * PEDIGREE_DEPTH, the same horizon COI already uses) - one query, no N+1. Ancestry rather than just
 * the horse's own breed_id, because cross-breeding is real: a Quarter Horse x Arabian foal can
 * carry SCID, and filtering on breed_id alone would leave that risk with no test to buy. */
export async function pedigreeBreedCodes(env: Env, horseId: number): Promise<Set<string>> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT b.code FROM breeds b WHERE b.id IN (
       SELECT breed_id FROM horses WHERE id = ?
       UNION
       SELECT h.breed_id FROM horse_ancestors ha JOIN horses h ON h.id = ha.ancestor_id WHERE ha.descendant_id = ?
     )`
  )
    .bind(horseId, horseId)
    .all<{ code: string }>();
  return new Set((result.results ?? []).map((r) => r.code));
}

/** Every breed's founding_allele_pool, parsed once, keyed by breed code - panelFor's own `pools`
 * parameter. getBreeds is already cached (src/db/breeds.ts), so this costs nothing beyond the parse. */
async function breedPoolsByCode(env: Env): Promise<Map<string, AllelePool>> {
  const breeds = await getBreeds(env);
  return new Map(breeds.map((b) => [b.code, parseAllelePool(b.founding_allele_pool)]));
}

/** The one call every filtering call site should make - pedigreeBreedCodes and breedPoolsByCode,
 * composed through panelFor, for one horse. */
export async function conditionsPanelForHorse(env: Env, horseId: number, conditions: ConditionRow[]): Promise<ConditionRow[]> {
  const [breedCodes, pools] = await Promise.all([pedigreeBreedCodes(env, horseId), breedPoolsByCode(env)]);
  return panelFor(conditions, pools, breedCodes);
}

/** The breeding preview's own version: the union of both parents' pedigree breed codes, since a
 * cross-breed pairing must warn on both sides' conditions (docs/fixes/breed-disease-panels.md). */
export async function conditionsPanelForPairing(env: Env, horseIdA: number, horseIdB: number, conditions: ConditionRow[]): Promise<ConditionRow[]> {
  const [codesA, codesB, pools] = await Promise.all([pedigreeBreedCodes(env, horseIdA), pedigreeBreedCodes(env, horseIdB), breedPoolsByCode(env)]);
  return panelFor(conditions, pools, new Set([...codesA, ...codesB]));
}

// ---------------------------------------------------------------------------
// Knowledge - what a stable has paid to learn (horse_knowledge)
// ---------------------------------------------------------------------------

export interface HorseKnowledgeRow {
  id: number;
  stable_id: number;
  horse_id: number;
  kind: 'genotype' | 'screening';
  subject_code: string;
  result: ConditionStatusLabel;
  tested_game_day: number;
  expires_game_day: number | null;
  cost_paid: number;
}

export async function getKnowledgeForHorse(env: Env, stableId: number, horseId: number): Promise<HorseKnowledgeRow[]> {
  const result = await env.DB.prepare('SELECT * FROM horse_knowledge WHERE stable_id = ? AND horse_id = ?')
    .bind(stableId, horseId)
    .all<HorseKnowledgeRow>();
  return result.results ?? [];
}

/** Every enabled, signs_visible condition this genotype currently reads as affected by AND whose
 * signs delay has actually elapsed - the observation an owner (or the barn list) can see with no
 * test and no charge (slice 0010 §2.4, delayed by docs/fixes/breed-disease-panels.md). Truth, not
 * knowledge - never filtered by breed panel (a horse is affected by what its genotype says,
 * regardless of what is worth testing for). Sync, not a database call - takes the conditions list
 * and this horse's own horse_conditions signs_game_day rows, both already loaded by the caller.
 * `signsGameDayByCode` missing an entry, or holding null, means "already due" - the same treatment
 * a horse_conditions row written before this column existed gets (migrations/0150's own comment). */
export function visibleAffectedConditions(
  genotype: Genotype,
  conditions: ConditionRow[],
  signsGameDayByCode: Map<string, number | null>,
  gameDay: number
): ConditionRow[] {
  return conditions.filter((c) => {
    if (c.signs_visible !== 1 || c.locus_code === null) return false;
    if (conditionStatus(genotype, parseConditionTrigger(c.trigger)).status !== 'affected') return false;
    const signsGameDay = signsGameDayByCode.get(c.code) ?? null;
    return signsGameDay === null || signsGameDay <= gameDay;
  });
}

/** Every horse_conditions row's signs_game_day for the given horses, in one query - the same
 * batching discipline getManageableConditionsForHorses already established. Used by both
 * visibleAffectedConditions callers (the barn list, one query for the whole barn) and
 * isBarredFromShowing (a one-element array costs nothing extra worth avoiding). */
export interface HorseConditionSignsRow {
  horse_id: number;
  condition_code: string;
  signs_game_day: number | null;
}

export async function getHorseConditionSigns(env: Env, horseIds: number[]): Promise<HorseConditionSignsRow[]> {
  if (horseIds.length === 0) return [];
  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT horse_id, condition_code, signs_game_day FROM horse_conditions WHERE horse_id IN (${placeholders})`)
    .bind(...horseIds)
    .all<HorseConditionSignsRow>();
  return result.results ?? [];
}

/** Groups getHorseConditionSigns' flat rows by horse_id, condition code -> signs_game_day - the
 * shape visibleAffectedConditions actually wants per horse. */
export function signsGameDayMapsByHorse(rows: HorseConditionSignsRow[]): Map<number, Map<string, number | null>> {
  const out = new Map<number, Map<string, number | null>>();
  for (const row of rows) {
    const map = out.get(row.horse_id) ?? new Map<string, number | null>();
    map.set(row.condition_code, row.signs_game_day);
    out.set(row.horse_id, map);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Part B (slice 0014 §5): managing HYPP and PSSM1. Truth (horse_conditions.management_state/
// management_until_game_day) is separate from a stable's knowledge (horse_knowledge) - the same
// truth-vs-knowledge split every other health screen in this codebase already respects.
// ---------------------------------------------------------------------------

export interface ManageableHorseConditionRow {
  horse_id: number;
  condition_code: string;
  management_until_game_day: number | null;
}

/** Slice 0014 §5.2: every manageable-condition row (severity_class = 'manageable', enabled) for the
 * given horses in one query - the batching that keeps the judging path free of an N+1. Callers with
 * a single horse (the care page) pass a one-element array; the query shape does not change. */
export async function getManageableConditionsForHorses(env: Env, horseIds: number[]): Promise<ManageableHorseConditionRow[]> {
  if (horseIds.length === 0) return [];
  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB.prepare(
    `SELECT hc.horse_id, hc.condition_code, hc.management_until_game_day
     FROM horse_conditions hc
     JOIN conditions c ON c.code = hc.condition_code
     WHERE hc.horse_id IN (${placeholders}) AND c.severity_class = 'manageable' AND c.enabled = 1`
  )
    .bind(...horseIds)
    .all<ManageableHorseConditionRow>();
  return result.results ?? [];
}

export interface KnownGenotypeRow {
  horse_id: number;
  subject_code: string;
}

/** Every genotype-kind knowledge row for the given horses, in one query. There is no player-driven
 * horse transfer yet (CLAUDE.md §13), so a horse's knowledge rows are always its current owner
 * stable's own - filtering by horse_id alone is exactly filtering by "this horse's owner", the same
 * entitlement the knowledge boundary requires. */
export async function getKnownGenotypeSubjectsForHorses(env: Env, horseIds: number[]): Promise<KnownGenotypeRow[]> {
  if (horseIds.length === 0) return [];
  const placeholders = horseIds.map(() => '?').join(',');
  const result = await env.DB.prepare(`SELECT horse_id, subject_code FROM horse_knowledge WHERE kind = 'genotype' AND horse_id IN (${placeholders})`)
    .bind(...horseIds)
    .all<KnownGenotypeRow>();
  return result.results ?? [];
}

/**
 * §5.1's boundary, resolved with ownerVisibleStatus - never a second version of the rule. A
 * horse_conditions row only ever exists for a genuinely affected horse (buildHorseConditionStatements'
 * own rule), so `known` is only consulted for whether a genotype test exists; conditionStatus is
 * still recomputed via ownerVisibleStatus so the entitlement path is identical to every other health
 * screen, not shortcut because the outcome happens to be predictable here.
 */
export function manageableConditionStates(
  genotype: Genotype,
  horseConditionRows: ManageableHorseConditionRow[],
  conditions: ConditionRow[],
  knownGenotypeCodes: Set<string>
): ManageableConditionState[] {
  const out: ManageableConditionState[] = [];
  for (const row of horseConditionRows) {
    const condition = conditions.find((c) => c.code === row.condition_code);
    if (!condition) continue;
    const trigger = parseConditionTrigger(condition.trigger);
    const known = knownGenotypeCodes.has(condition.code) ? { result: 'affected' as ConditionStatusLabel } : undefined;
    const visible = ownerVisibleStatus(genotype, trigger, condition.signs_visible === 1, known);
    out.push({
      conditionCode: condition.code,
      ownerEntitled: visible.status !== null,
      managementUntilGameDay: row.management_until_game_day,
    });
  }
  return out;
}

/**
 * §5.2's whole point: one query for horse_conditions, one for horse_knowledge, for however many
 * horses the caller names - never one pair per horse. The judging path calls this once per class
 * with every entered horse; a single-horse page (the care page, the horse page) calls it with a
 * one-element array, which costs nothing extra worth avoiding.
 */
export async function conditionDeltaMapForHorses(
  env: Env,
  horses: { id: number; genotype: string }[],
  conditions: ConditionRow[],
  gameDay: number,
  unmanagedPenalty: number
): Promise<Map<number, ConditionDeltaResult>> {
  const horseIds = horses.map((h) => h.id);
  const [conditionRows, knownRows] = await Promise.all([getManageableConditionsForHorses(env, horseIds), getKnownGenotypeSubjectsForHorses(env, horseIds)]);

  const conditionRowsByHorseId = new Map<number, ManageableHorseConditionRow[]>();
  for (const row of conditionRows) {
    const list = conditionRowsByHorseId.get(row.horse_id) ?? [];
    list.push(row);
    conditionRowsByHorseId.set(row.horse_id, list);
  }
  const knownByHorseId = new Map<number, Set<string>>();
  for (const row of knownRows) {
    const set = knownByHorseId.get(row.horse_id) ?? new Set<string>();
    set.add(row.subject_code);
    knownByHorseId.set(row.horse_id, set);
  }

  const result = new Map<number, ConditionDeltaResult>();
  for (const horse of horses) {
    const rows = conditionRowsByHorseId.get(horse.id) ?? [];
    if (rows.length === 0) {
      result.set(horse.id, { delta: 0, unmanagedCodes: [] });
      continue;
    }
    const states = manageableConditionStates(parseGenotype(horse.genotype), rows, conditions, knownByHorseId.get(horse.id) ?? new Set());
    result.set(horse.id, conditionDelta(states, gameDay, unmanagedPenalty));
  }
  return result;
}

/** condition code -> known result, for the breeding preview's health line (engines/health/breedingWarning.ts)
 * and nothing else - keeping this a thin re-shape of rows already loaded rather than a second query
 * is what keeps that function's "knowledge only, never a genotype" rule easy to audit. */
export function knowledgeMap(rows: HorseKnowledgeRow[]): Map<string, ConditionStatusLabel> {
  const map = new Map<string, ConditionStatusLabel>();
  for (const row of rows) {
    // Amendment 0017a §4.1: a `locus:`-namespaced colour row is not a disease result and must never
    // be read as one - this map is keyed by bare condition code everywhere it's consulted.
    if (row.kind === 'genotype' && !row.subject_code.startsWith(LOCUS_KNOWLEDGE_PREFIX)) map.set(row.subject_code, row.result);
  }
  return map;
}

/** The test page's GET: every enabled condition applicable to this horse, split into what's
 * already known and what still costs money. */
export function untestedConditions(conditions: ConditionRow[], known: HorseKnowledgeRow[]): ConditionRow[] {
  const knownCodes = new Set(known.filter((k) => k.kind === 'genotype').map((k) => k.subject_code));
  return conditions.filter((c) => !knownCodes.has(c.code));
}

/**
 * The breeding preview's health line (slice 0010 §7.3), assembled here rather than at the route so
 * genotypes are never in scope in the same function that computes it - this function loads only
 * horse_knowledge rows and the recessive conditions list, nothing that could read either horse's
 * genotype even by accident. The one line in this slice most likely to be gotten wrong without that
 * discipline (§14).
 */
export async function breedingHealthWarningsFor(
  env: Env,
  stableId: number,
  mareId: number,
  stallionId: number,
  /**
   * Whose horse_knowledge rows stand for what is known about the STALLION. Defaults to the booking
   * stable itself, which is the only right answer for two horses in one barn.
   *
   * A cross-stable stud booking is the case that needs the other answer: the mare's owner has never
   * paid to test somebody else's stallion, so reading their own (empty) knowledge of him would
   * silently report "untested" about a stallion whose owner has tested him and whose result the
   * market already discloses on his stud page (slice 0017 §2.3 - health always travels with the
   * horse). Passing his OWNER's stable here reproduces exactly that disclosure, and nothing wider:
   * still knowledge rows, never a genotype, so an untested stallion still reads as untested.
   */
  stallionKnowledgeStableId: number = stableId
): Promise<string[]> {
  const conditions = await getEnabledConditions(env);
  // docs/fixes/breed-disease-panels.md: the union of both parents' own panels, not the whole
  // enabled list - a cross-breed pairing warns on both sides' conditions, and nothing is said about
  // a condition neither breed can actually carry.
  const panelConditions = await conditionsPanelForPairing(env, mareId, stallionId, conditions);
  const recessive = panelConditions
    .filter((c) => c.locus_code !== null && parseConditionTrigger(c.trigger).mode === 'recessive')
    .map((c) => ({ code: c.code, name: c.name }));

  const [mareKnowledge, stallionKnowledge] = await Promise.all([
    getKnowledgeForHorse(env, stableId, mareId),
    getKnowledgeForHorse(env, stallionKnowledgeStableId, stallionId),
  ]);
  return breedingHealthWarnings(knowledgeMap(mareKnowledge), knowledgeMap(stallionKnowledge), recessive).map((w) => w.sentence);
}

export interface RecordTestPurchaseParams {
  stableId: number;
  horseId: number;
  gameDay: number;
  genotype: Genotype;
  /** The conditions actually being bought - already re-derived by the caller from untestedConditions,
   * never trusted from the form (slice 0010 §7.1 step 1). */
  conditions: ConditionRow[];
  /** What each condition actually cost, keyed by code - computed by the caller from live config. */
  costByCode: Record<string, number>;
}

/** Builds the horse_knowledge inserts for a test purchase - the actual result is computed here from
 * the horse's real genotype, since buying a test is exactly the action that is allowed to look. The
 * caller runs this in the same env.DB.batch() as the ledger statements (slice 0010 §7.1 step 5). */
export function buildKnowledgePurchaseStatements(env: Env, params: RecordTestPurchaseParams): D1PreparedStatement[] {
  return params.conditions.map((condition) => {
    const trigger = parseConditionTrigger(condition.trigger);
    const { status } = conditionStatus(params.genotype, trigger);
    return env.DB.prepare(
      `INSERT INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, expires_game_day, cost_paid)
       VALUES (?, ?, 'genotype', ?, ?, ?, NULL, ?)`
    ).bind(params.stableId, params.horseId, condition.code, status, params.gameDay, params.costByCode[condition.code] ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Amendment 0017a §4: colour testing. Same table, same `kind = 'genotype'` mechanism as the disease
// tests above, distinguished only by a `locus:`-namespaced subject_code (§4.1) - every reader that
// assumes a genotype row is a disease result must filter on that prefix, this file's readers
// included (see untestedConditions/knowledgeMap above, which this section deliberately does not
// touch - a locus: row is simply invisible to them, and that is what keeps the two families apart).
// ---------------------------------------------------------------------------

export const LOCUS_KNOWLEDGE_PREFIX = 'locus:';

/** Every colour/gait locus subject_code this stable already holds a result for, bare (no prefix) -
 * the test page's "what's left to buy" list. */
export function testedColourLoci(known: HorseKnowledgeRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of known) {
    if (row.kind === 'genotype' && row.subject_code.startsWith(LOCUS_KNOWLEDGE_PREFIX)) out.add(row.subject_code.slice(LOCUS_KNOWLEDGE_PREFIX.length));
  }
  return out;
}

export interface LocusKnowledgePurchaseParams {
  stableId: number;
  horseId: number;
  gameDay: number;
  genotype: Genotype;
  /** Bare locus codes being bought, e.g. ['E','CR'] - already re-derived by the caller from
   * testedColourLoci, never trusted from the form (the same discipline slice 0010 §7.1 step 1 uses
   * for a disease test purchase). */
  locusCodes: string[];
  /** What each locus actually cost, keyed by bare code - computed by the caller from live config. */
  costByCode: Record<string, number>;
}

/** §4.1: result is the pair as stored, in LOCI's own canonical order (getMendelianPair already
 * returns it sorted), e.g. "Cr/cr". Same shape as buildKnowledgePurchaseStatements, kept separate
 * because a colour result has no severity/trigger to evaluate - it is simply the pair. */
export function buildLocusKnowledgePurchaseStatements(env: Env, params: LocusKnowledgePurchaseParams): D1PreparedStatement[] {
  return params.locusCodes.map((code) => {
    const pair = getMendelianPair(params.genotype, code);
    return env.DB.prepare(
      `INSERT INTO horse_knowledge (stable_id, horse_id, kind, subject_code, result, tested_game_day, expires_game_day, cost_paid)
       VALUES (?, ?, 'genotype', ?, ?, ?, NULL, ?)`
    ).bind(params.stableId, params.horseId, `${LOCUS_KNOWLEDGE_PREFIX}${code}`, pair.join('/'), params.gameDay, params.costByCode[code] ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Truth at birth - horse_conditions rows written when a horse comes into being (slice 0010 §6.3)
// ---------------------------------------------------------------------------

export interface NewHorseConditionsParams {
  genotype: Genotype;
  bornGameDay: number;
  lethalFoalDeathGameDays: number;
  stableId: number;
  accountId: number | null;
  /** Already resolved by the caller - horseDisplayName's own "Unnamed filly/colt" for a foal that
   * has no name yet, or the real registered name for founding stock, which is born already named. */
  horseName: string;
  conditions: ConditionRow[];
  /** docs/fixes/breed-disease-panels.md: the horse's own rng_seed, so a signs delay is drawn
   * reproducibly (CLAUDE.md §5.2) rather than resampled on every read. */
  rngSeed: number;
}

/**
 * Not a tick stage - called from buildFoalInsertStatements and buildFoundingHorseInsertStatements
 * in src/db/horses.ts, the two places a horse comes into being (slice 0010 §6.3). Appends a
 * horse_conditions row for every condition the new horse's genotype reads as affected - never for
 * carriers or clear, per that table's own rule. Every statement here uses the same
 * "(SELECT id FROM horses ORDER BY id DESC LIMIT 1)" pattern buildFoalInsertStatements' own
 * ancestor rows use, and relies on the same guarantee: the caller runs these in one env.DB.batch()
 * immediately after the horse insert, with nothing else inserting into `horses` in between.
 *
 * docs/fixes/breed-disease-panels.md: no longer writes the condition_signs event itself - signs
 * take time to show now, so the event is written later by the tick's noticeDueConditionSigns once
 * this row's own signs_game_day (drawn here, once, from the horse's own seed) actually arrives.
 * signs_game_day stays NULL for a signs_visible = 0 condition (GBED, SCID, LWO) - nothing ever
 * reads it there.
 */
export function buildHorseConditionStatements(env: Env, params: NewHorseConditionsParams): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];

  for (const condition of params.conditions) {
    if (condition.locus_code === null) continue;
    const trigger = parseConditionTrigger(condition.trigger);
    const { status } = conditionStatus(params.genotype, trigger);
    if (status !== 'affected') continue;

    const isLethal = condition.severity_class === 'lethal';
    const terminalGameDay = isLethal ? lethalTerminalGameDay(params.bornGameDay, params.lethalFoalDeathGameDays) : null;

    let signsGameDay: number | null = null;
    if (condition.signs_visible === 1) {
      const min = condition.signs_delay_min_game_days;
      const max = condition.signs_delay_max_game_days;
      const delay = max > min ? min + makeRng(deriveSeed(params.rngSeed, `signs_delay_${condition.code}`)).int(max - min + 1) : min;
      signsGameDay = params.bornGameDay + delay;
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO horse_conditions (horse_id, condition_code, state, onset_game_day, terminal_game_day, last_evaluated_game_day, signs_game_day, signs_noticed_game_day)
         VALUES ((SELECT id FROM horses ORDER BY id DESC LIMIT 1), ?, ?, ?, ?, ?, ?, NULL)`
      ).bind(condition.code, isLethal ? 'terminal' : 'onset', params.bornGameDay, terminalGameDay, params.bornGameDay, signsGameDay)
    );
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Show eligibility - which conditions bar showing (slice 0010 §7.4)
// ---------------------------------------------------------------------------

/** True when this genotype currently reads as affected by any enabled bars_showing condition AND
 * that condition's signs have actually shown (docs/fixes/breed-disease-panels.md - HERDA, CA,
 * dwarfism, hydrocephalus and MCOA today). Reads the genotype directly (not knowledge): §2.4 makes
 * an affected horse's status visible with no test, so this is truth the game already shows for
 * free, not something hidden behind a purchase. Never filtered by breed panel - truth, same as
 * every other function in the "do not filter" half of the fix document.
 *
 * A missing horse_conditions row for an affected condition (should not happen -
 * buildHorseConditionStatements always writes one) is treated as due, the same conservative default
 * a NULL signs_game_day gets - a horse is never let into a show by a lookup gap. */
export async function isBarredFromShowing(env: Env, horseId: number, genotype: Genotype, gameDay: number): Promise<boolean> {
  const map = await isBarredFromShowingMap(env, new Map([[horseId, genotype]]), gameDay);
  return map.get(horseId) ?? false;
}

/**
 * docs/slices/0025-difficulty-foals-shows-and-evaluation.md §7.5a.1 (slice 0025 stage 4): the batched sibling of
 * isBarredFromShowing - one getEnabledConditions read and one getHorseConditionSigns read for every
 * horse given, rather than the pair isBarredFromShowing itself makes per call. Used wherever a whole
 * catalogue or a whole NPC candidate pool needs a barring answer per horse (the horse page's "Enter
 * in a show" card, the tick's NPC top-up) - both used to pay isBarredFromShowing's two queries once
 * per class checked, which is where most of the O(classes) cost that fix document names actually
 * came from. isBarredFromShowing itself is now just this map with a one-element input, so there is
 * still exactly one place the rule is evaluated.
 */
export async function isBarredFromShowingMap(env: Env, genotypeByHorseId: Map<number, Genotype>, gameDay: number): Promise<Map<number, boolean>> {
  const result = new Map<number, boolean>();
  const horseIds = Array.from(genotypeByHorseId.keys());
  if (horseIds.length === 0) return result;

  const conditions = await getEnabledConditions(env);
  const barring = conditions.filter((c) => c.bars_showing === 1 && c.locus_code !== null);
  const signsMaps = signsGameDayMapsByHorse(await getHorseConditionSigns(env, horseIds));

  for (const [horseId, genotype] of genotypeByHorseId) {
    const affected = barring.filter((c) => conditionStatus(genotype, parseConditionTrigger(c.trigger)).status === 'affected');
    const signsByCode = signsMaps.get(horseId) ?? new Map<string, number | null>();
    const barred = affected.some((c) => {
      const signsGameDay = signsByCode.has(c.code) ? signsByCode.get(c.code)! : null;
      return signsGameDay === null || signsGameDay <= gameDay;
    });
    result.set(horseId, barred);
  }
  return result;
}

// ---------------------------------------------------------------------------
// The tick's death stage (slice 0010 §6.2)
// ---------------------------------------------------------------------------

interface DueLethalRow {
  id: number;
  horse_id: number;
  condition_code: string;
  owner_stable_id: number;
  account_id: number | null;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
  born_game_day: number;
  sire_id: number | null;
  dam_id: number | null;
}

/**
 * Every still-alive horse whose lethal condition's terminal day has arrived, killed in its own
 * batch, guarded by `h.status = 'alive'` on the final update - idempotency comes free from that
 * guard (CLAUDE.md §5.4): a re-fired tick finds nothing, because the horse it would have killed is
 * already dead, and a missed tick still catches up because the comparison is `<=` against a
 * snapshotted day rather than an increment. No processed-marker column - the status is the marker.
 */
export async function killDueLethalFoals(env: Env, gameDay: number): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT hc.id, hc.horse_id, hc.condition_code, h.owner_stable_id, s.account_id,
            h.registered_name, h.barn_name, h.sex, h.born_game_day, h.sire_id, h.dam_id
     FROM horse_conditions hc
     JOIN horses h ON h.id = hc.horse_id
     JOIN stables s ON s.id = h.owner_stable_id
     WHERE hc.state = 'terminal' AND hc.terminal_game_day <= ? AND h.status = 'alive'`
  )
    .bind(gameDay)
    .all<DueLethalRow>();

  const conditions = await getConditions(env);

  for (const row of due.results ?? []) {
    await killOneLethalFoal(env, row, gameDay, conditions);
  }
}

async function killOneLethalFoal(env: Env, row: DueLethalRow, gameDay: number, conditions: ConditionRow[]): Promise<void> {
  const condition = conditions.find((c) => c.code === row.condition_code);
  const conditionName = condition?.name ?? row.condition_code;
  const eventText = condition?.event_text ?? '';

  type NameRow = { registered_name: string | null; barn_name: string | null };
  const nameOf = (h: NameRow | null, fallback: string) => (h ? (h.registered_name ?? h.barn_name ?? fallback) : fallback);

  const [sire, dam] = await Promise.all([
    row.sire_id ? env.DB.prepare('SELECT registered_name, barn_name FROM horses WHERE id = ?').bind(row.sire_id).first<NameRow>() : Promise.resolve(null),
    row.dam_id ? env.DB.prepare('SELECT registered_name, barn_name FROM horses WHERE id = ?').bind(row.dam_id).first<NameRow>() : Promise.resolve(null),
  ]);

  const horseName = row.registered_name ?? row.barn_name ?? (row.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt');
  const damName = nameOf(dam, 'a mare');
  const sireName = nameOf(sire, 'a stallion');

  const statements = [
    env.DB
      .prepare(`UPDATE horses SET status = 'dead', ended_game_day = ?, end_reason = ? WHERE id = ? AND status = 'alive'`)
      .bind(gameDay, row.condition_code, row.horse_id),
    env.DB.prepare('UPDATE horse_conditions SET last_evaluated_game_day = ? WHERE id = ?').bind(gameDay, row.id),
    ...buildEventStatement(env, {
      stableId: row.owner_stable_id,
      accountId: row.account_id,
      gameDay,
      kind: 'horse_died',
      subjectHorseId: row.horse_id,
      payload: {
        horse_name: horseName,
        condition_name: conditionName,
        condition_code: row.condition_code,
        age_game_days: gameDay - row.born_game_day,
        dam_name: damName,
        sire_name: sireName,
        event_text: eventText,
      },
    }),
  ];

  await env.DB.batch(statements);
}

// ---------------------------------------------------------------------------
// The tick's signs-delay stage (docs/fixes/breed-disease-panels.md) - sits beside
// killDueLethalFoals above, same file, same shape.
// ---------------------------------------------------------------------------

interface DueSignsRow {
  id: number;
  horse_id: number;
  condition_code: string;
  owner_stable_id: number;
  account_id: number | null;
  registered_name: string | null;
  barn_name: string | null;
  sex: 'mare' | 'stallion' | 'gelding';
}

/**
 * Writes the condition_signs event for every horse_conditions row whose signs_game_day has arrived
 * and has not yet been noticed - the delayed version of what buildHorseConditionStatements used to
 * write immediately at birth. Idempotent on signs_noticed_game_day IS NULL, the same shape
 * killDueLethalFoals' own `status = 'alive'` guard gives it (CLAUDE.md §5.4): a re-fired tick finds
 * nothing, because the first run already set the marker, and a missed tick still catches up because
 * the comparison is `<=` against a stored day rather than an increment.
 */
export async function noticeDueConditionSigns(env: Env, gameDay: number): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT hc.id, hc.horse_id, hc.condition_code, h.owner_stable_id, s.account_id, h.registered_name, h.barn_name, h.sex
     FROM horse_conditions hc
     JOIN horses h ON h.id = hc.horse_id
     JOIN stables s ON s.id = h.owner_stable_id
     WHERE hc.signs_noticed_game_day IS NULL AND hc.signs_game_day IS NOT NULL AND hc.signs_game_day <= ? AND h.status = 'alive'`
  )
    .bind(gameDay)
    .all<DueSignsRow>();

  const conditions = await getConditions(env);

  for (const row of due.results ?? []) {
    const condition = conditions.find((c) => c.code === row.condition_code);
    if (!condition) continue;
    const horseName = row.registered_name ?? row.barn_name ?? (row.sex === 'mare' ? 'Unnamed filly' : 'Unnamed colt');
    await env.DB.batch([
      env.DB.prepare('UPDATE horse_conditions SET signs_noticed_game_day = ? WHERE id = ?').bind(gameDay, row.id),
      ...buildEventStatement(env, {
        stableId: row.owner_stable_id,
        accountId: row.account_id,
        gameDay,
        kind: 'condition_signs',
        subjectHorseId: row.horse_id,
        payload: { horse_name: horseName, condition_name: condition.name, condition_code: condition.code },
      }),
    ]);
  }
}

// ---------------------------------------------------------------------------
// /admin/health (slice 0010 §8) - reads truth directly, which is fine: it is the admin, and there
// is exactly one of them.
// ---------------------------------------------------------------------------

export interface ConditionCensusRow {
  condition: ConditionRow;
  clear: number;
  carrier: number;
  affected: number;
  /** Slice 0014 §8.6: only meaningful for severity_class = 'manageable' rows - how many of the
   * affected count above currently have no current plan, counted from truth (management_state/
   * management_until_game_day), not from any stable's knowledge - this is the admin, and there is
   * exactly one of them (CLAUDE.md §12's boundary is a player-facing rule, not an admin one). */
  unmanaged: number;
}

/** Every living horse's genotype, scanned once in JS against every enabled single-gene condition -
 * schema doc §4.1's acknowledged cost of the genotype-as-one-blob design, acceptable at the
 * population size this game runs at (CLAUDE.md's own note on that tradeoff). */
export async function conditionCensus(env: Env, gameDay: number): Promise<ConditionCensusRow[]> {
  const conditions = (await getEnabledConditions(env)).filter((c) => c.locus_code !== null);
  const result = await env.DB.prepare(`SELECT genotype FROM horses WHERE status = 'alive'`).all<{ genotype: string }>();
  const rows = result.results ?? [];

  const unmanagedResult = await env.DB.prepare(
    `SELECT hc.condition_code, COUNT(*) AS n
     FROM horse_conditions hc
     JOIN horses h ON h.id = hc.horse_id
     JOIN conditions c ON c.code = hc.condition_code
     WHERE h.status = 'alive' AND c.severity_class = 'manageable'
       AND (hc.management_until_game_day IS NULL OR hc.management_until_game_day < ?)
     GROUP BY hc.condition_code`
  )
    .bind(gameDay)
    .all<{ condition_code: string; n: number }>();
  const unmanagedByCode = new Map((unmanagedResult.results ?? []).map((r) => [r.condition_code, r.n]));

  return conditions.map((condition) => {
    const trigger = parseConditionTrigger(condition.trigger);
    let clear = 0;
    let carrier = 0;
    let affected = 0;
    for (const row of rows) {
      const genotype = parseGenotype(row.genotype);
      const status = conditionStatus(genotype, trigger).status;
      if (status === 'clear') clear++;
      else if (status === 'carrier') carrier++;
      else affected++;
    }
    return { condition, clear, carrier, affected, unmanaged: unmanagedByCode.get(condition.code) ?? 0 };
  });
}
