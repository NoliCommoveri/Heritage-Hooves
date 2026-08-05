// What the game reckons a horse is worth, and the three or four reasons why. Slice 0017 §4. Pure,
// no database access (CLAUDE.md §5.1), no randomness, no wall clock - the caller reads the horse,
// its knowledge rows, its show summary and its breed's ideal vector and hands them all in already
// computed.
//
// **horses.natural_death_game_day is not an input to this function, in any form.** It is the
// horse's rolled lifespan, never rendered to a player in any way (slice 0011 §5.1). A value that
// quietly dropped when a horse crossed into its last two years would leak it: an owner watching the
// guide value could read the death date off the curve. What this may read is
// horses.frailty_notice_game_day - the announced Failing notice, which the owner has already been
// told about explicitly - and that arrives here as the plain `isFailing` boolean below. This is the
// kind of thing a future session adds "for realism" without noticing what it exposes;
// test/market/appraise.test.ts asserts it directly.
//
// The quality term reuses scoreEntry (src/engines/showing/score.ts) and the decline term reuses
// agePerformanceModifier (src/engines/ageing/performance.ts) rather than inventing second versions
// of either (§4.1) - the same rule slice 0015 §2.2 applied to NPC selection, for the same reason: a
// retune of a breed's ideal vector or of the age curve must flow through to what the game thinks a
// horse is worth, because it is the same function and not a copy of it.

import { scoreEntry, type IdealVector } from '../showing/score';
import { agePerformanceModifier, type AgeModifierConfig } from '../ageing/performance';
import type { TraitCode } from '../genetics/polygenic';
import type { ShowRank } from '../showing/eligibility';

/** The seller's own knowledge results for this horse - what they have paid to learn, never what is
 * true (slice 0017 §2.3). An untested condition is simply absent from this list and changes
 * nothing, which is what makes the tested-clear premium real and untested stock a gamble. */
export type KnownResult = 'clear' | 'carrier' | 'affected';

export interface AppraiseParams {
  /** The horse's expressed conformation values, exactly as slice 0006 computes them for display. */
  expressed: Partial<Record<TraitCode, number>>;
  /** Amendment 0017a §4.7. The horse's visible colour name, ALREADY passed through
   * src/render/colour.ts's smoky-black display mapping for the appraising stable's own knowledge -
   * never the raw truth string. An untested smoky black must price exactly as a plain black, the
   * same "a stranger at a show can see it" rule that makes this term visible-only in the first
   * place; it is not a second truth-vs-knowledge boundary, it is the same one health already has. */
  visibleColour: string;
  /** §4.7: how many colour/gait loci this stable has tested where inferFromPhenotype's own
   * (untested) possibility set had more than one member - i.e. a genuine discovery, not something
   * looking already gave away for free. Computed by the caller from horse_knowledge and
   * inferFromPhenotype; this engine never reads horses.genotype for it. */
  knownHiddenColourAlleleCount: number;
  /** Slice 0021 §6.4: true when the horse's phenotype.patterns is non-empty - tobiano, frame,
   * splash, sabino or any appaloosa variant. One flat factor regardless of how many patterns stack,
   * on purpose (§6.4): a maximally-marked horse must not out-earn a well-bred one by stacking
   * multipliers, the same restraint market_visible_colour_factors was already written with. */
  hasPattern: boolean;
  /** Null (or empty) for a breed with no seeded ideal vector - see §4.4 and qualityUnknown below. */
  ideal: IdealVector | null;
  /** show_ideal_falloff, live from config. No judge is involved in an appraisal, so scoreEntry is
   * called with judgeWeights: {} and every trait takes its own 1.0 default (§4.1). */
  falloff: number;
  ageGameDays: number;
  /** True when the horse has had its Failing notice (horses.frailty_notice_game_day is not null).
   * NEVER derived from the lifespan - see this file's header. */
  isFailing: boolean;
  /** One entry per condition the seller holds a genotype result for. Order is irrelevant. */
  knownResults: KnownResult[];
  /** From horse_show_summary. topThree counts firsts, seconds and thirds together, wins included. */
  wins: number;
  topThree: number;
  /** Slice 0026 §1.5. True when sex = 'gelding'. */
  isGelding: boolean;
  /** Slice 0026 §1.5. The horse's own highest rank held across every horse_class_ranks row -
   * 'novice' (the caller's own default) when it holds none. */
  highestRank: ShowRank;
  params: AppraiseConfig;
}

export interface AppraiseConfig extends AgeModifierConfig {
  min_breeding_age_game_days: number;
  market_base_value: number;
  market_quality_weight: number;
  market_price_multiplier: number;
  market_foal_value_factor: number;
  market_failing_factor: number;
  market_clear_premium: number;
  market_clear_premium_cap: number;
  market_carrier_factor: number;
  market_affected_factor: number;
  market_win_bonus: number;
  market_place_bonus: number;
  market_record_cap: number;
  market_min_value: number;
  /** Amendment 0017a §4.7. Expressed colour name -> multiplier - keep the whole range modest next
   * to market_quality_weight (§8's risk: colour must never out-compete conformation). */
  market_visible_colour_factors: Record<string, number>;
  market_carried_allele_premium: number;
  market_carried_allele_cap: number;
  /** Slice 0021 §6.4: one flat multiplier applied once when the horse shows any pattern at all,
   * never per-pattern. */
  market_pattern_factor: number;
  /** Slice 0026 §1.5. Applied when sex = 'gelding', otherwise 1. */
  market_gelding_factor: number;
  /** Slice 0026 §1.5. Keyed by the horse's own highest held show rank. */
  market_rank_factors: Record<ShowRank, number>;
}

export interface AppraisalFactor {
  label: string;
  detail: string;
}

export interface Appraisal {
  /** Integer, rounded to the nearest 10, floored at market_min_value. Currency: never a float. */
  value: number;
  /** The "why" line, in the order shown - what makes the guide teach something rather than assert a
   * number. A child who reads "Age: 14 years - past its best" learns why an old horse is cheap. */
  factors: AppraisalFactor[];
  /** True when the breed has no ideal vector and the quality term was skipped (§4.4). */
  qualityUnknown: boolean;
}

/**
 * §4.3's shape, exactly:
 *
 *   base  = market_base_value * (1 + market_quality_weight * quality / 100)
 *   value = base × youth × ageDecline × failing × health × record × market_price_multiplier
 *
 * rounded to the nearest 10 and floored at market_min_value.
 */
export function appraise(input: AppraiseParams): Appraisal {
  const c = input.params;
  const factors: AppraisalFactor[] = [];

  // §4.4: seven of eight breeds have no seeded ideal vector, and scoreEntry returns rawScore 0 for
  // them. A quality of zero must not be mistaken for a bad horse, so the quality term is dropped
  // entirely (factor 1.0, not 0) and the caller is told to say so in a sentence.
  const hasIdeal = input.ideal !== null && Object.keys(input.ideal).length > 0;
  const quality = hasIdeal
    ? scoreEntry({ expressed: input.expressed, ideal: input.ideal!, judgeWeights: {}, falloff: input.falloff, noise: 0 }).rawScore
    : 0;

  const base = hasIdeal ? c.market_base_value * (1 + (c.market_quality_weight * quality) / 100) : c.market_base_value;
  if (hasIdeal) factors.push({ label: 'Conformation', detail: `scores ${quality.toFixed(0)} against the breed standard` });

  const youth = youthFactor(input.ageGameDays, c.min_breeding_age_game_days, c.market_foal_value_factor);
  const age = agePerformanceModifier(input.ageGameDays, c);
  const ageYears = age.ageYears;
  if (youth < 1) {
    factors.push({ label: 'Age', detail: `${ageYears < 1 ? 'under a year' : `${String(ageYears)} years`} - still growing into itself` });
  } else if (age.phase !== 'prime') {
    factors.push({ label: 'Age', detail: `${String(ageYears)} years - ${age.phase === 'floor' ? 'well past its best' : 'past its best'}` });
  } else {
    factors.push({ label: 'Age', detail: `${String(ageYears)} years - in its prime` });
  }

  const failing = input.isFailing ? c.market_failing_factor : 1;
  if (input.isFailing) factors.push({ label: 'Failing', detail: 'getting on in years now, and starting to slow down' });

  const health = healthFactor(input.knownResults, c);
  factors.push({ label: 'Health tests', detail: healthDetail(input.knownResults) });

  const record = recordFactor(input.wins, input.topThree, c);
  factors.push({ label: 'Show record', detail: recordDetail(input.wins, input.topThree) });

  const colour = colourFactor(input.visibleColour, input.knownHiddenColourAlleleCount, c);
  factors.push({ label: 'Colour', detail: colourDetail(input.visibleColour, input.knownHiddenColourAlleleCount) });

  const pattern = input.hasPattern ? c.market_pattern_factor : 1;
  if (input.hasPattern) factors.push({ label: 'Markings', detail: 'a marked pattern - tobiano, frame, splash, sabino or appaloosa' });

  // §1.5: the two compound, deliberately - an intact stallion who also shows is premium, a gelding
  // that has never shown is cheapest.
  const gelding = input.isGelding ? c.market_gelding_factor : 1;
  if (input.isGelding) factors.push({ label: 'Sex', detail: 'gelded - cannot be bred' });

  const rank = c.market_rank_factors[input.highestRank] ?? 1;
  if (input.highestRank !== 'novice') factors.push({ label: 'Show rank', detail: `has reached ${input.highestRank} in at least one class` });

  const raw = base * youth * age.modifier * failing * health * record * colour * pattern * gelding * rank * c.market_price_multiplier;
  const value = Math.max(c.market_min_value, Math.round(raw / 10) * 10);

  return { value, factors, qualityUnknown: !hasIdeal };
}

/**
 * §4.3: ramps linearly from market_foal_value_factor at birth to 1.0 at min_breeding_age_game_days,
 * then stays at 1.0. It reuses the existing breeding-age key rather than inventing a second
 * "old enough to be worth something" threshold - a weanling is a promise; a three-year-old is a
 * horse. A degenerate config (a zero or negative breeding age, an operator can type anything into
 * /admin/config) reads as 1.0 for every age rather than dividing by zero.
 */
function youthFactor(ageGameDays: number, minBreedingAgeGameDays: number, foalFactor: number): number {
  if (minBreedingAgeGameDays <= 0) return 1;
  if (ageGameDays >= minBreedingAgeGameDays) return 1;
  const progress = Math.max(0, ageGameDays) / minBreedingAgeGameDays;
  return foalFactor + (1 - foalFactor) * progress;
}

/**
 * §4.3: each tested-clear result multiplies by (1 + market_clear_premium), with the whole clear
 * premium capped at market_clear_premium_cap; each known carrier multiplies by
 * market_carrier_factor and each known affected by market_affected_factor. **An untested condition
 * changes nothing** - the list simply does not contain it (§2.3).
 */
function healthFactor(results: KnownResult[], c: AppraiseConfig): number {
  let clearMultiplier = 1;
  let other = 1;
  for (const result of results) {
    if (result === 'clear') clearMultiplier *= 1 + c.market_clear_premium;
    else if (result === 'carrier') other *= c.market_carrier_factor;
    else other *= c.market_affected_factor;
  }
  return Math.min(clearMultiplier, c.market_clear_premium_cap) * other;
}

function healthDetail(results: KnownResult[]): string {
  if (results.length === 0) return 'nothing tested yet - a buyer is taking a chance';
  const clear = results.filter((r) => r === 'clear').length;
  const carrier = results.filter((r) => r === 'carrier').length;
  const affected = results.filter((r) => r === 'affected').length;
  const parts: string[] = [];
  if (clear > 0) parts.push(`${String(clear)} tested clear`);
  if (carrier > 0) parts.push(`${String(carrier)} carrier${carrier === 1 ? '' : 's'}`);
  if (affected > 0) parts.push(`${String(affected)} affected`);
  return parts.join(', ');
}

/** §4.3: 1 + win bonus × wins + place bonus × (topThree − wins), capped at market_record_cap. */
function recordFactor(wins: number, topThree: number, c: AppraiseConfig): number {
  const places = Math.max(0, topThree - wins);
  return Math.min(c.market_record_cap, 1 + c.market_win_bonus * wins + c.market_place_bonus * places);
}

/**
 * Amendment 0017a §4.7: colourFactor = visibleColourFactor × carriedAlleleFactor. The visible half
 * needs no test and no knowledge check - a config table keyed on the expressed colour name, 1 when
 * that colour has no entry (an operator has not priced it yet, not "worthless"). The carried half is
 * `1 + market_carried_allele_premium × n`, capped - never doubled up with the visible half, since
 * `n` only counts loci that were genuinely hidden from looking (see AppraiseParams' own comment).
 */
function colourFactor(visibleColour: string, hiddenCount: number, c: AppraiseConfig): number {
  const visible = c.market_visible_colour_factors[visibleColour] ?? 1;
  const carried = Math.min(c.market_carried_allele_cap, 1 + c.market_carried_allele_premium * hiddenCount);
  return visible * carried;
}

function colourDetail(visibleColour: string, hiddenCount: number): string {
  if (hiddenCount === 0) return visibleColour;
  return `${visibleColour}; carries ${String(hiddenCount)} tested colour allele${hiddenCount === 1 ? '' : 's'} that don't show`;
}

function recordDetail(wins: number, topThree: number): string {
  if (topThree === 0 && wins === 0) return 'nothing in the ribbons yet';
  const places = Math.max(0, topThree - wins);
  const parts: string[] = [];
  if (wins > 0) parts.push(`${String(wins)} win${wins === 1 ? '' : 's'}`);
  if (places > 0) parts.push(`${String(places)} other top-three placing${places === 1 ? '' : 's'}`);
  return parts.join(', ');
}
