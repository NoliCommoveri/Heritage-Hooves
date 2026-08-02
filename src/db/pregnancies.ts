// One row per foal (slice 0003 §5.1/§6). Genetics are rolled at conception (buildPregnancyInsertStatement,
// called from db/coverings.ts's covering-resolution stage) and the horses row is only written at
// foaling (foalDuePregnancies, the tick's second breeding stage - slice 0003 §10).

import type { Env } from '../types';
import { nowUtcSeconds } from '../lib/time';
import { randomSeed, deriveSeed, makeRng } from '../lib/rng';
import { getConfig } from '../lib/config-cache';
import { getHorse, loadAncestorEdges, buildFoalInsertStatements } from './horses';
import { getStableById } from './stables';
import { parseGenotype, serializeGenotype, type Genotype } from '../engines/genetics/genotype';
import { buildAncestorRows } from '../engines/genetics/pedigree';
import { foalComposition } from '../engines/genetics/composition';

export interface PregnancyRow {
  id: number;
  covering_id: number;
  dam_id: number;
  sire_id: number;
  conceived_game_day: number;
  gestation_days: number;
  due_game_day: number;
  status: 'in_progress' | 'foaled';
  rolled_genotype: string;
  rolled_coi: number;
  rng_seed: number;
  foal_rng_seed: number;
  foal_id: number | null;
  last_processed_tick_seq: number | null;
  created_real_ts: number;
}

export async function getActivePregnancyForMare(env: Env, mareId: number): Promise<PregnancyRow | null> {
  return env.DB.prepare(`SELECT * FROM pregnancies WHERE dam_id = ? AND status = 'in_progress' ORDER BY id DESC LIMIT 1`)
    .bind(mareId)
    .first<PregnancyRow>();
}

export interface BuildPregnancyInsertInput {
  coveringId: number;
  damId: number;
  sireId: number;
  conceivedGameDay: number;
  genotype: Genotype;
  coi: number;
  foalRngSeed: number;
  gestationDaysMean: number;
  gestationDaysSd: number;
}

/**
 * Builds (but does not run) the pregnancy insert - the genetics are rolled here, at conception
 * (slice 0003 §3.9), from a freshly minted seed (foalRngSeed, minted by the caller) plus this
 * pregnancy's own seed (minted here, distinct from foalRngSeed - slice 0003 §9) which drives only
 * the gestation-length draw. Returns a statement rather than running it so the caller (db/coverings.ts's
 * resolveOneCovering) can batch it atomically with the covering's status update - a covering that
 * conceives but whose pregnancy row never lands, or a pregnancy created twice for one covering
 * retry, are both idempotency bugs this atomicity avoids.
 */
export function buildPregnancyInsertStatement(env: Env, input: BuildPregnancyInsertInput): D1PreparedStatement {
  const pregnancySeed = randomSeed();
  const gestationRng = makeRng(deriveSeed(pregnancySeed, 'gestation'));
  // Clamped well above zero - a normal draw this far from the mean would need a ~34 SD outlier.
  const gestationDays = Math.max(1, Math.round(gestationRng.normal(input.gestationDaysMean, input.gestationDaysSd)));
  const dueGameDay = input.conceivedGameDay + gestationDays;
  const nowSeconds = nowUtcSeconds();

  return env.DB.prepare(
    `INSERT INTO pregnancies (
       covering_id, dam_id, sire_id, conceived_game_day, gestation_days, due_game_day, status,
       rolled_genotype, rolled_coi, rng_seed, foal_rng_seed, foal_id, last_processed_tick_seq, created_real_ts
     ) VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?, ?, NULL, NULL, ?)`
  ).bind(
    input.coveringId,
    input.damId,
    input.sireId,
    input.conceivedGameDay,
    gestationDays,
    dueGameDay,
    serializeGenotype(input.genotype),
    input.coi,
    pregnancySeed,
    input.foalRngSeed,
    nowSeconds
  );
}

/**
 * The tick's second breeding stage (slice 0003 §10.2): every pregnancy due on or before today that
 * hasn't foaled yet. Derived from due_game_day <= gameDay, never from "is this the tick it was due
 * on" - a missed tick must not skip a foaling. Each pregnancy foals in its own batch, guarded by
 * `status = 'in_progress'` on the final update, so a double-fired tick cannot foal it twice.
 */
export async function foalDuePregnancies(env: Env, gameDay: number, tickSeq: number): Promise<void> {
  const due = await env.DB.prepare(`SELECT * FROM pregnancies WHERE status = 'in_progress' AND due_game_day <= ?`)
    .bind(gameDay)
    .all<PregnancyRow>();

  for (const pregnancy of due.results ?? []) {
    await foalOnePregnancy(env, pregnancy, gameDay, tickSeq);
  }
}

async function foalOnePregnancy(env: Env, pregnancy: PregnancyRow, gameDay: number, tickSeq: number): Promise<void> {
  const [sire, dam, config] = await Promise.all([getHorse(env, pregnancy.sire_id), getHorse(env, pregnancy.dam_id), getConfig(env)]);
  if (!sire || !dam) throw new Error(`foalDuePregnancies: sire or dam missing for pregnancy ${String(pregnancy.id)}`);
  const ownerStable = await getStableById(env, dam.owner_stable_id);
  if (!ownerStable) throw new Error(`foalDuePregnancies: owner stable missing for pregnancy ${String(pregnancy.id)}`);

  const [sireEdges, damEdges] = await Promise.all([loadAncestorEdges(env, sire.id), loadAncestorEdges(env, dam.id)]);
  const ancestorRows = buildAncestorRows(sire.id, dam.id, sireEdges, damEdges);

  const genotype = parseGenotype(pregnancy.rolled_genotype);
  const sex = makeRng(deriveSeed(pregnancy.foal_rng_seed, 'sex')).pick(['mare', 'stallion'] as const);
  const generation = Math.max(sire.generation, dam.generation) + 1;
  const comp = foalComposition(
    { composition: JSON.parse(sire.composition), isCross: sire.is_cross === 1, breedId: sire.breed_id },
    { composition: JSON.parse(dam.composition), isCross: dam.is_cross === 1, breedId: dam.breed_id }
  );
  // Same roll a founding mare gets at creation (createFoundingHorse) - slice 0003 §3.2, "set at
  // creation for founding horses, at birth for foals".
  const cycleAnchorTickSeq =
    sex === 'mare' ? tickSeq + makeRng(deriveSeed(pregnancy.foal_rng_seed, 'cycle_slot')).int(config.values.estrous_cycle_ticks) : null;

  const statements = [
    ...buildFoalInsertStatements(env, {
      sex,
      sireId: sire.id,
      damId: dam.id,
      ownerStableId: dam.owner_stable_id,
      breederStableId: dam.owner_stable_id,
      breederPrefix: ownerStable.prefix,
      breedId: comp.breedId,
      isCross: comp.isCross,
      composition: comp.composition,
      generation,
      coi: pregnancy.rolled_coi,
      bornGameDay: gameDay,
      genotype,
      rngSeed: pregnancy.foal_rng_seed,
      ancestorRows,
      cycleAnchorTickSeq,
      conformationNoiseSd: config.values.conformation_noise_sd,
    }),
    // Foal heat (slice 0003 §10.2): resetting to tickSeq + 1 also desynchronises mares whose cycles
    // happened to have lined up.
    env.DB.prepare('UPDATE horses SET last_foaled_game_day = ?, cycle_anchor_tick_seq = ? WHERE id = ?').bind(gameDay, tickSeq + 1, dam.id),
    // The breeding slice is what sets prefix_locked=1 (slice 0001 built the column and said so).
    // Set unconditionally - it's already 1 or it's about to be.
    env.DB.prepare('UPDATE stables SET prefix_locked = 1 WHERE id = ?').bind(dam.owner_stable_id),
    env.DB.prepare(
      `UPDATE pregnancies SET status = 'foaled', foal_id = (SELECT id FROM horses ORDER BY id DESC LIMIT 1), last_processed_tick_seq = ?
       WHERE id = ? AND status = 'in_progress'`
    ).bind(tickSeq, pregnancy.id),
  ];

  await env.DB.batch(statements);
}
