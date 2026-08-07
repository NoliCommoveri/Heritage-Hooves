// One horse's conformation as plain words, ready to render. 2026-08-05.
//
// Slice 0022 Part B built the words and gave them to the owner's own horse page and the breeding
// preview. The operator's oldest daughter then asked, correctly, why a stallion standing at stud
// shows nothing about conformation when in real life you would walk up to him and form an opinion
// before spending money on a booking. This is the shared builder that answers her - the market reads
// it, the horse page's own card is unchanged, and there is exactly one place the words are computed.
//
// The knowledge boundary, decided by the operator: a stallion's labels are PUBLIC on his stud
// listing, on the same gate the owner's own card uses (he must have started at least one show, and
// his breed must have a standard to judge him against). That is not a widening of what the game
// discloses so much as a correction: his show record is already public, and these words are read off
// the same judge's formula those results came from. It goes no further than stud listings - a horse
// in somebody's barn that is neither for sale nor at stud still shows nothing.

import type { Env } from '../types';
import type { ConfigValues } from '../lib/config-cache';
import { parseGenotype } from '../engines/genetics/genotype';
import { conformationValues, noiseFor } from '../engines/conformation/model';
import { parseIdealVector } from '../engines/showing/score';
import { conformationLabelsFor, CONFORMATION_LABEL_TEXT, type ConformationLabel } from '../engines/conformation/labels';
import { getConformationTraits } from './quantitativeTraits';
import { getBreedById } from './breeds';
import { getShowSummary } from './shows';
import type { HorseRow } from './horses';

export interface ConformationLabelRow {
  code: string;
  name: string;
  /** Already display-mapped: "Good", "Weak", "Unknown". */
  text: string;
  label: ConformationLabel;
}

/** The four band edges, read straight off live config - the same helper routes/horses.ts keeps for
 * its own card, duplicated here rather than exported across a route boundary. */
function bands(cfg: ConfigValues) {
  return {
    outstandingMin: cfg.conformation_label_outstanding_min,
    goodMin: cfg.conformation_label_good_min,
    acceptableMin: cfg.conformation_label_acceptable_min,
    weakMin: cfg.conformation_label_weak_min,
  };
}

/**
 * One word per conformation trait for this horse, against its OWN breed's ideal vector. Every trait
 * reads 'Unknown' - rather than the list rendering empty - when the horse has never started or its
 * breed has no standard, which is the same gate and the same wording the owner's own card uses.
 */
export async function conformationLabelRowsFor(env: Env, horse: HorseRow, cfg: ConfigValues): Promise<ConformationLabelRow[]> {
  const [traitRows, breed, summary] = await Promise.all([
    getConformationTraits(env),
    horse.breed_id ? getBreedById(env, horse.breed_id) : Promise.resolve(undefined),
    getShowSummary(env, horse.id),
  ]);

  const ideal = breed?.ideal_vector ? parseIdealVector(breed.ideal_vector) : null;
  const values = conformationValues(parseGenotype(horse.genotype), noiseFor(horse.rng_seed, horse.environmental_noise), cfg, ideal);
  const eligible = (summary?.starts ?? 0) >= 1 && ideal !== null;

  const labels = conformationLabelsFor(values, ideal, cfg.show_ideal_falloff, bands(cfg), eligible);
  const nameByCode = new Map(traitRows.map((row) => [row.code, row.name]));

  return values.map((row) => {
    const label = labels.get(row.code) ?? 'unknown';
    return { code: row.code, name: nameByCode.get(row.code) ?? row.code, text: CONFORMATION_LABEL_TEXT[label], label };
  });
}
