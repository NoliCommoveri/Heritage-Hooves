-- The single row holding tunable game settings and feature flags, editable from the admin page.
CREATE TABLE config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1,
  -- values: JSON object of live tunables. Keys are documented in migration 0009 which seeds them.
  "values" TEXT NOT NULL,
  -- flags: JSON object of feature toggles, e.g. {"some_feature": true}.
  flags TEXT NOT NULL,
  updated_real_ts INTEGER
);
