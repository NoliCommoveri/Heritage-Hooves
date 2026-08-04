-- Slice 0024 §2: three discipline judges, the performance-class counterpart to 0033's three
-- conformation judges - same idea (a rotating pool weighting the same standard three different
-- ways so no single horse dominates every class, slice 0008 §5.1), same three-way spread (a
-- neutral read, and two judges who each pull toward opposite ends of what a discipline rewards).
-- Names are placeholders - surnames only, clearly fictional - editable from D1's console; nothing
-- keys off the name.
--
-- trait_weights stays NOT NULL (0032) even though a 'discipline' judge is never drawn for a
-- breed_conformation class and this value is never read - an empty traits object, not a fabricated
-- opinion, since scoreEntry's own missing-key convention already makes {} mean "no lean" rather
-- than requiring a real value here.
INSERT INTO judges (code, name, blurb, trait_weights, ability_weights, kind, active, sort_order) VALUES
  ('even_hand', 'Osgood', 'Scores the discipline exactly as it asks for, no particular lean.',
   '{"v":1,"traits":{}}',
   '{"v":1,"traits":{"speed":1.0,"stamina":1.0,"jump_scope":1.0,"trainability":1.0,"agility":1.0}}',
   'discipline', 1, 4),
  ('need_for_speed', 'Ferris', 'If it is faster, it wins - technique and manners count for less against the clock.',
   '{"v":1,"traits":{}}',
   '{"v":1,"traits":{"speed":1.5,"stamina":1.3,"jump_scope":0.9,"trainability":0.6,"agility":0.8}}',
   'discipline', 1, 5),
  ('clean_and_correct', 'Winslow', 'Wants to see a horse that listens and jumps the right shape - raw speed does not impress without control.',
   '{"v":1,"traits":{}}',
   '{"v":1,"traits":{"speed":0.7,"stamina":0.8,"jump_scope":1.3,"trainability":1.5,"agility":1.3}}',
   'discipline', 1, 6);

-- The three existing conformation judges get an explicit kind (default already covers this, but
-- said out loud rather than left implicit) and no ability_weights - see the CHECK-less pairing note
-- in 0139.
UPDATE judges SET kind = 'conformation' WHERE code IN ('balanced', 'movement', 'substance');
