-- A breed's opinion about its own conformation (slice 0008 §4.2): a target and a weight per
-- conformation trait, on the same 1-99 scale a horse is measured on. Null means no breed class can
-- be created for that breed yet (§4.2's class-creation rule) - true of every breed but the Quarter
-- Horse until their own stage lands (§3). Shape:
--   { "v": 1, "traits": { "neck_length": {"target":55,"weight":1.0}, "shoulder_angle": {...},
--                          "back_length": {...}, "hock_set": {...} } }
ALTER TABLE breeds ADD COLUMN ideal_vector TEXT;
