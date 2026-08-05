// horse_ability_words (migration 0162): the permanent word an 'ability_test' show class leaves
// behind, one row per (horse, trait). Slice 0025 stage 3 §7.4. This is the only place ABILITY_TRAITS
// is ever shown to a player - see src/engines/conformation/model.ts's own comment on why ability
// values were never displayed before this.

import type { Env } from '../types';
import type { TraitCode } from '../engines/genetics/polygenic';
import type { ConformationLabel } from '../engines/conformation/labels';

/** horse_ability_words.label's own CHECK never allows 'unknown' - there is no row at all for an
 * untested trait, so the type that reaches a write is narrower than ConformationLabel itself. */
export type AbilityWordLabel = Exclude<ConformationLabel, 'unknown'>;

export interface HorseAbilityWordRow {
  horse_id: number;
  trait_code: TraitCode;
  label: AbilityWordLabel;
  entry_id: number;
  game_day: number;
}

/** The horse page's Ability card: every trait this horse has ever been tested in, keyed by trait
 * code. A trait with no row here has never been tested and reads 'unknown' at the call site
 * (abilityLabelFor's own eligible flag), never a guess. */
export async function getAbilityWordsForHorse(env: Env, horseId: number): Promise<Map<TraitCode, AbilityWordLabel>> {
  const result = await env.DB.prepare('SELECT trait_code, label FROM horse_ability_words WHERE horse_id = ?')
    .bind(horseId)
    .all<{ trait_code: TraitCode; label: AbilityWordLabel }>();
  const map = new Map<TraitCode, AbilityWordLabel>();
  for (const row of result.results ?? []) map.set(row.trait_code, row.label);
  return map;
}

/**
 * Upserted, not appended - the same shape horse_show_summary already uses (migration 0039). A horse
 * retaking the same trait's test later in life overwrites the word rather than keeping the first one,
 * since a later test is a truer read of the same real ability (the value itself can move as the horse
 * matures) - "permanently records" means durable and always visible, not frozen at the first attempt.
 */
export function buildAbilityWordUpsertStatement(
  env: Env,
  params: { horseId: number; traitCode: TraitCode; label: AbilityWordLabel; entryId: number; gameDay: number }
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO horse_ability_words (horse_id, trait_code, label, entry_id, game_day)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (horse_id, trait_code) DO UPDATE SET
       label = excluded.label, entry_id = excluded.entry_id, game_day = excluded.game_day`
  ).bind(params.horseId, params.traitCode, params.label, params.entryId, params.gameDay);
}
