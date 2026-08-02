-- Reference data for heritable conditions - slice 0010 §5.1, trimmed from schema doc §3.3 to what
-- this slice reads. onset_model and management_options from that sketch are deliberately not
-- built as columns here - nothing writes or reads them yet, and a nullable column nothing touches
-- is a promise to a future session nobody has kept (slice 0010 §3.2). Same reasoning for
-- service_call_id (§3.3) - that arrives with the vet profession.
CREATE TABLE conditions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- category: single_gene / colour_linked / polygenic. Every row this slice seeds is single_gene.
  category TEXT NOT NULL,
  -- locus_code: which loci.code this condition's genotype trigger reads. Nullable for a future
  -- polygenic condition, which has no single locus.
  locus_code TEXT REFERENCES loci (code),
  -- trigger: JSON, { "v": 1, "locus": "GBED", "mutant": "Gb", "mode": "recessive" }. Read by
  -- src/engines/health/status.ts's conditionStatus, which counts copies of `mutant` at `locus` via
  -- getMendelianPair and maps them to clear/carrier/affected per `mode`. This shape is deliberately
  -- generic enough that a colour-linked condition (e.g. Frame Overo) needs no new engine, only a
  -- new row.
  trigger TEXT NOT NULL,
  -- severity_class: lethal / manageable / degenerative / latent (overview §3d).
  severity_class TEXT NOT NULL,
  -- signs_visible: 0/1. A horse showing this condition's signs is identifiable on its own page with
  -- no test and no charge - true for HYPP, PSSM1 and HERDA. False for GBED: a neonatal lethal has
  -- no window of visible signs before the death (slice 0010 §2.4).
  signs_visible INTEGER NOT NULL DEFAULT 0,
  -- bars_showing: 0/1. True only for the degenerative class in this slice (HERDA) - HYPP and PSSM1
  -- affected horses still compete, per overview §3d.
  bars_showing INTEGER NOT NULL DEFAULT 0,
  -- breed_associations: JSON array of breed codes, display only - e.g. '["QH"]'. Answers "why does
  -- my Arabian have this listed" (it does not; the founding pool already prevents that genetically,
  -- this is only ever shown, never enforced).
  breed_associations TEXT NOT NULL,
  -- test_cost_key: nullable, the config key naming this condition's individual test price. All four
  -- rows this slice seeds point at genotype_test_cost today - existing so a condition can be made
  -- expensive to test individually later without a code change.
  test_cost_key TEXT,
  -- enabled: 0/1, per-condition toggle. Disabling suppresses display and consequence and leaves the
  -- alleles in the genotype blob untouched, matching loci.enabled's rule exactly - a disabled
  -- condition is not testable, not displayed, does not bar showing, and does not kill foals, but
  -- rows already written to horse_conditions stay.
  enabled INTEGER NOT NULL DEFAULT 1,
  -- teaching_text: the short genetics note shown beside a result on the horse page.
  teaching_text TEXT NOT NULL,
  -- event_text: the drafted wording for what a player sees when this condition's consequence
  -- fires - written calmly now, edited without a deploy later (slice 0010 §5.6).
  event_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
