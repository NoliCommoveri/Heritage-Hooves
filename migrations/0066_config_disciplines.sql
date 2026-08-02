-- Slice 0012 §6.6: how many discipline classes a show carries, alongside its breed-conformation
-- classes. Live - read fresh at show-creation time. With only Barrel Racing enabled this session
-- the cap does nothing (there is only one enabled discipline to draw from); it is seeded now at
-- the value the full six-discipline design calls for, so nothing needs revisiting when the other
-- five are added as pure data later.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.show_discipline_classes_per_show', 6
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
