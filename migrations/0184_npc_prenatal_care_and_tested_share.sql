-- Slice 0028 §2.8, migration 8 of 8: without this the NPC breeding stables plateau exactly the way
-- a blind player does, while the show barn's minted stock does not - a worse failure than the
-- ceiling problem it superficially resembles.
--
-- npc_prenatal_care_chance: the share of NPC coverings that buy mare prenatal care, charged to the
-- stable's own real balance like any other cost - deliberately NOT special-cased, so a stable that
-- stops earning stops buying it (visible at /admin/npc the same way any other spend is).
--
-- npc_tested_share: roughly this share of an NPC stable's horses are treated as
-- conformation-panel-tested for its own mate-selection/market-ranking (src/db/npcBreeding.ts's
-- expressedFor) - which half is derived deterministically from the horse's own rng_seed against the
-- stable's, never drawn per decision.
--
-- Neither number raises the NPC ceiling (activeNpcCeilingRow, slice 0015 §2.4, still applies to
-- everything an NPC stable breeds) - they only stop an NPC line going stale BELOW it. Do not read
-- "let the NPCs improve" as licence to remove or raise the ceiling; see CLAUDE.md §13.
UPDATE config
SET version = version + 1,
    "values" = json_set(
      "values",
      '$.npc_prenatal_care_chance', 0.5,
      '$.npc_tested_share', 0.5
    ),
    updated_real_ts = unixepoch()
WHERE id = 1;
