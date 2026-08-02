-- The three judges of slice 0008 §5.1/§4.6's worked example, weighting the same breed standard
-- three different ways so no single horse dominates every class (§2.4). Names are placeholders -
-- surnames only, clearly fictional - editable from D1's console; nothing keys off the name.
INSERT INTO judges (code, name, blurb, trait_weights, active, sort_order) VALUES
  ('balanced', 'Marchbank', 'Likes a horse built the way the standard asks for, plainly - the standard as written.',
   '{"v":1,"traits":{"neck_length":1.0,"shoulder_angle":1.0,"back_length":1.0,"hock_set":1.0}}', 1, 1),
  ('movement', 'Ellery', 'Likes a horse that moves - weights the shoulder above everything else.',
   '{"v":1,"traits":{"neck_length":1.1,"shoulder_angle":1.6,"back_length":0.8,"hock_set":0.7}}', 1, 2),
  ('substance', 'Halloway', 'Wants a short, strong back and correct hocks over anything flashy.',
   '{"v":1,"traits":{"neck_length":0.8,"shoulder_angle":0.8,"back_length":1.5,"hock_set":1.3}}', 1, 3);
