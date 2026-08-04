-- Slice 0022 Part A: incidents are not genetic conditions. incident_types is the new home for the
-- twelve acquired conditions (colic, laminitis, and the rest) - reference data, replacing their
-- rows in `conditions`, which is genetics-only from here on. Carries only what an incident
-- actually has: no locus_code, no severity_class, no breed_associations, no signs_visible, no
-- test_cost_key, no bars_showing - every one of those was dead weight or a lie for these twelve
-- (slice 0022 §A1's table).
CREATE TABLE incident_types (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- risk_model: JSON, the onset/outcome maths only - src/engines/incidents/risk.ts's
  -- IncidentRiskModel. treatmentWindowGameDays and treatmentCostKey lived inside
  -- conditions.trigger's own JSON before this slice; they are genuinely used (unlike the columns
  -- above), so they are promoted to real columns below instead of staying duplicated in here.
  -- Shape, e.g.:
  -- {"v":1,"kind":"acquired","tissue":"gut","robustnessTrait":null,"robustnessWeight":0,
  --  "baseRatePerGameDay":0.00025,"careWeight":1.2,"workloadWeight":0.6,"feedWeight":0,
  --  "pastureMultiplier":0.7,
  --  "outcomesUntreated":{"resolved":0.55,"manageable":0.05,"degenerative":0,"death":0.40},
  --  "outcomesTreated":{"resolved":0.90,"manageable":0.05,"degenerative":0,"death":0.05}}
  risk_model TEXT NOT NULL,
  treatment_window_game_days INTEGER NOT NULL,
  treatment_cost_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- description: the short note shown beside the incident on the horse page - conditions.teaching_text,
  -- renamed, since "teaching" implied genetics.
  description TEXT NOT NULL,
  -- event_text: carried over from conditions.event_text. Unused by incident_onset/incident_resolved
  -- today (both compose their sentence entirely from the event payload - see src/render/stables.ts),
  -- kept for the same reason horse_died's drafted prose exists ahead of a render path that might
  -- want it.
  event_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
