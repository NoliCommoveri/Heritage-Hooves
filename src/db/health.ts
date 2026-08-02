// Reference data (conditions) plus the two real tables slice 0010 introduces - horse_knowledge
// (what a stable has paid to learn) and horse_conditions (what is actually true). Also the tick's
// death stage. Everything genuinely genetic runs through src/engines/health/status.ts; this file is
// the thin database layer around it, same split as db/breeds.ts/genetics or db/shows.ts/showing.

import type { Env } from '../types';
import type { Genotype } from '../engines/genetics/genotype';
import { parseGenotype } from '../engines/genetics/genotype';
import { conditionStatus, parseConditionTrigger, lethalTerminalGameDay, type ConditionStatusLabel } from '../engines/health/status';
import type { LethalTrigger } from '../engines/founding/generate';
import { buildConditionSignsEventStatement, buildEventStatement } from './events';
import { breedingHealthWarnings } from '../engines/health/breedingWarning';

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

/** Every enabled, signs_visible condition this genotype currently reads as affected by - the
 * observation an owner (or the barn list) can see with no test and no charge (slice 0010 §2.4).
 * Sync, not a database call - takes the conditions list the caller already loaded. */
export function visibleAffectedConditions(genotype: Genotype, conditions: ConditionRow[]): ConditionRow[] {
  return conditions.filter((c) => {
    if (c.signs_visible !== 1 || c.locus_code === null) return false;
    return conditionStatus(genotype, parseConditionTrigger(c.trigger)).status === 'affected';
  });
}

/** condition code -> known result, for the breeding preview's health line (engines/health/breedingWarning.ts)
 * and nothing else - keeping this a thin re-shape of rows already loaded rather than a second query
 * is what keeps that function's "knowledge only, never a genotype" rule easy to audit. */
export function knowledgeMap(rows: HorseKnowledgeRow[]): Map<string, ConditionStatusLabel> {
  const map = new Map<string, ConditionStatusLabel>();
  for (const row of rows) {
    if (row.kind === 'genotype') map.set(row.subject_code, row.result);
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
export async function breedingHealthWarningsFor(env: Env, stableId: number, mareId: number, stallionId: number): Promise<string[]> {
  const conditions = await getEnabledConditions(env);
  const recessive = conditions
    .filter((c) => c.locus_code !== null && parseConditionTrigger(c.trigger).mode === 'recessive')
    .map((c) => ({ code: c.code, name: c.name }));

  const [mareKnowledge, stallionKnowledge] = await Promise.all([getKnowledgeForHorse(env, stableId, mareId), getKnowledgeForHorse(env, stableId, stallionId)]);
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
}

/**
 * Not a tick stage - called from buildFoalInsertStatements and buildFoundingHorseInsertStatements
 * in src/db/horses.ts, the two places a horse comes into being (slice 0010 §6.3). Appends a
 * horse_conditions row for every condition the new horse's genotype reads as affected - never for
 * carriers or clear, per that table's own rule - plus a condition_signs event for any affected
 * condition with signs_visible = 1. Every statement here uses the same
 * "(SELECT id FROM horses ORDER BY id DESC LIMIT 1)" pattern buildFoalInsertStatements' own
 * ancestor rows use, and relies on the same guarantee: the caller runs these in one env.DB.batch()
 * immediately after the horse insert, with nothing else inserting into `horses` in between.
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

    statements.push(
      env.DB.prepare(
        `INSERT INTO horse_conditions (horse_id, condition_code, state, onset_game_day, terminal_game_day, last_evaluated_game_day)
         VALUES ((SELECT id FROM horses ORDER BY id DESC LIMIT 1), ?, ?, ?, ?, ?)`
      ).bind(condition.code, isLethal ? 'terminal' : 'onset', params.bornGameDay, terminalGameDay, params.bornGameDay)
    );

    // §2.2/§2.4: GBED's signs_visible is 0 on purpose - a neonatal lethal has no window of visible
    // signs before the death, and an event here would give the foal 30 game days of announced
    // dread instead of 30 game days of being a foal. Nothing branches on the condition code itself
    // (CLAUDE.md rule 6) - this is a column read, not an `if (condition.code === 'GBED')`.
    if (condition.signs_visible === 1) {
      statements.push(
        ...buildConditionSignsEventStatement(env, {
          stableId: params.stableId,
          accountId: params.accountId,
          gameDay: params.bornGameDay,
          payload: { horse_name: params.horseName, condition_name: condition.name, condition_code: condition.code },
        })
      );
    }
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Show eligibility - which conditions bar showing (slice 0010 §7.4)
// ---------------------------------------------------------------------------

/** True when this genotype currently reads as affected by any enabled bars_showing condition -
 * HERDA in this slice. Reads the genotype directly (not knowledge): §2.4 makes an affected horse's
 * status visible with no test, so this is truth the game already shows for free, not something
 * hidden behind a purchase. */
export async function isBarredFromShowing(env: Env, genotype: Genotype): Promise<boolean> {
  const conditions = await getEnabledConditions(env);
  for (const condition of conditions) {
    if (condition.bars_showing !== 1 || condition.locus_code === null) continue;
    const trigger = parseConditionTrigger(condition.trigger);
    if (conditionStatus(genotype, trigger).status === 'affected') return true;
  }
  return false;
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
// /admin/health (slice 0010 §8) - reads truth directly, which is fine: it is the admin, and there
// is exactly one of them.
// ---------------------------------------------------------------------------

export interface ConditionCensusRow {
  condition: ConditionRow;
  clear: number;
  carrier: number;
  affected: number;
}

/** Every living horse's genotype, scanned once in JS against every enabled single-gene condition -
 * schema doc §4.1's acknowledged cost of the genotype-as-one-blob design, acceptable at the
 * population size this game runs at (CLAUDE.md's own note on that tradeoff). */
export async function conditionCensus(env: Env): Promise<ConditionCensusRow[]> {
  const conditions = (await getEnabledConditions(env)).filter((c) => c.locus_code !== null);
  const result = await env.DB.prepare(`SELECT genotype FROM horses WHERE status = 'alive'`).all<{ genotype: string }>();
  const rows = result.results ?? [];

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
    return { condition, clear, carrier, affected };
  });
}
