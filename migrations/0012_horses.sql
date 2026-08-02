-- The central table: every horse that has ever existed. See slice 0002 §3.3 for the full
-- reasoning behind each group of columns.
CREATE TABLE horses (
  id INTEGER PRIMARY KEY,

  -- Identity and lineage
  sex TEXT NOT NULL CHECK (sex IN ('mare', 'stallion', 'gelding')),
  -- registered_name: null means not yet named. SQLite allows many nulls through a unique index,
  -- which is exactly the "unnamed foals don't collide" behaviour wanted here. Never changes once set.
  registered_name TEXT UNIQUE COLLATE NOCASE,
  -- barn_name: freely editable by the current owner; cleared on transfer (no transfers yet).
  barn_name TEXT,
  -- breeder_prefix: a snapshot of the breeding stable's prefix at the moment of birth. Never
  -- joined to the breeder's live prefix - renaming a stable must not rewrite horses it already bred.
  breeder_prefix TEXT,
  breed_id INTEGER REFERENCES breeds (id),
  is_cross INTEGER NOT NULL DEFAULT 0,
  -- composition: JSON object of breed-code -> fraction, e.g. {"QH":1}. See foalComposition().
  composition TEXT NOT NULL,
  sire_id INTEGER REFERENCES horses (id),
  dam_id INTEGER REFERENCES horses (id),
  generation INTEGER NOT NULL DEFAULT 0,
  -- coi: inbreeding coefficient at birth, 0-1. Not currency, so the no-floats rule doesn't apply.
  coi REAL NOT NULL DEFAULT 0,
  owner_stable_id INTEGER NOT NULL REFERENCES stables (id),
  breeder_stable_id INTEGER REFERENCES stables (id),

  -- Dates and state
  born_game_day INTEGER NOT NULL,
  ended_game_day INTEGER,
  status TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'dead', 'removed')),
  end_reason TEXT,
  -- last_foaled_game_day: mares only. Read by the breeding recovery check.
  last_foaled_game_day INTEGER,
  created_real_ts INTEGER NOT NULL,

  -- Genetics
  -- genotype: JSON object, shape documented in src/engines/genetics/genotype.ts and reproduced here:
  --   { "v": 1,
  --     "mendelian": { "E": ["E","e"], "A": ["A","a"], "CR": ["cr","cr"], "G": ["g","g"], "DMRT3": ["C","C"] },
  --     "polygenic": { "neck_length": "<20 chars of 0/1>", "shoulder_angle": "...", ... } }
  -- A missing locus or trait key means "homozygous for the last (recessive/wild-type) allele in
  -- canonical order" - see genotype.ts's readLocus(). No whitespace is stored.
  genotype TEXT NOT NULL,
  -- rng_seed: minted once with randomSeed() and stored. Every random draw this horse ever makes
  -- (birth-noise, future condition rolls, ...) derives from this via deriveSeed(), never a fresh seed.
  rng_seed INTEGER NOT NULL
);

-- The only query every screen in this slice makes: a stable's barn list. No sire/dam index yet -
-- nothing displays a horse's offspring this slice, so add one when something does.
CREATE INDEX idx_horses_owner_stable_id ON horses (owner_stable_id);
