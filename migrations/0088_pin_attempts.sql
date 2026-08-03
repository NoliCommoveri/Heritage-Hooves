-- Slice 0016 §9.2/§9.3: an append-only log of every PIN attempt against the admin door (and, later,
-- slice 0005 §7's parent-PIN path over the same table). account_id is nullable because a wrong PIN
-- that happens to match nobody's hash still needs a row - the lockout below is global, not
-- per-account (§9.3's "a determined eleven-year-old farming attempts across a sibling's login").
-- attempted_by_account_id is whoever was logged in and typed it. Indexed on real_ts, the lockout
-- query's only filter.
CREATE TABLE pin_attempts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts (id),
  attempted_by_account_id INTEGER NOT NULL REFERENCES accounts (id),
  real_ts INTEGER NOT NULL,
  success INTEGER NOT NULL
);

CREATE INDEX idx_pin_attempts_real_ts ON pin_attempts (real_ts);
