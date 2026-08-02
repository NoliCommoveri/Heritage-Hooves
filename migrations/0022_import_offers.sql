-- A private batch of founding-stock (or later, token-bought) candidates offered to one stable.
-- Schema doc §10.2; slice 0005 §6.2. Minted pending, with no breed and no candidates yet - the
-- player picks a breed when they open it, and the candidates are generated at that moment from
-- rng_seed (see import_candidates). Everything the generator reads is snapshotted here at mint
-- time (CLAUDE.md §5.5) so retuning batch sizes or the age range never changes an offer a child
-- has not opened yet.
CREATE TABLE import_offers (
  id INTEGER PRIMARY KEY,
  stable_id INTEGER NOT NULL REFERENCES stables (id),
  -- Denormalised from the stable so a later per-account limit is a query on this table alone.
  account_id INTEGER REFERENCES accounts (id),
  -- source: 'founding' (this slice) / 'chore_grant' / 'admin_grant'. 'token_import' arrives with
  -- the tokens slice.
  source TEXT NOT NULL CHECK (source IN ('founding', 'chore_grant', 'admin_grant', 'token_import')),
  -- granted_by_account_id: which admin minted it. Nullable - a grant path with no admin acting
  -- directly (the PIN grant, a later slice) still fills this in once verified.
  granted_by_account_id INTEGER REFERENCES accounts (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'claimed', 'expired')),
  -- breed_id: null until the breed is chosen (slice 0005 §6.4). Filled, along with the candidate
  -- rows, in the same batch that flips status to 'open' - the choice is final.
  breed_id INTEGER REFERENCES breeds (id),
  quality_band TEXT NOT NULL,
  polygenic_one_chance REAL NOT NULL,
  mare_candidates INTEGER NOT NULL,
  mare_claims INTEGER NOT NULL,
  stallion_candidates INTEGER NOT NULL,
  stallion_claims INTEGER NOT NULL,
  age_min_game_days INTEGER NOT NULL,
  age_max_game_days INTEGER NOT NULL,
  granted_game_day INTEGER NOT NULL,
  generated_game_day INTEGER,
  claimed_game_day INTEGER,
  -- expires_game_day: null means never (slice 0005 §6.2 - no tick stage sweeps this yet; checked
  -- at claim time only).
  expires_game_day INTEGER,
  -- rng_seed: minted once with randomSeed() at offer creation. Every candidate's own seed derives
  -- from this one via deriveSeed(seed, 'candidate_<slot_index>') - see import_candidates.
  rng_seed INTEGER NOT NULL,
  created_real_ts INTEGER NOT NULL
);

-- The only query a stable's screens make: is there a waiting or open offer for this stable.
CREATE INDEX idx_import_offers_stable_status ON import_offers (stable_id, status);
