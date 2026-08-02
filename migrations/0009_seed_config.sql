-- Create the single config row with the starting tunables this slice reads. Later slices add their own keys.
INSERT INTO config (id, version, "values", flags, updated_real_ts)
VALUES (
  1,
  1,
  '{"display_timezone":"America/Chicago","game_days_per_tick":10,"game_days_per_year":360,"max_stables_per_account":3,"starting_stable_capacity":10,"starting_balance":10000,"min_password_length":8}',
  '{}',
  unixepoch()
);
