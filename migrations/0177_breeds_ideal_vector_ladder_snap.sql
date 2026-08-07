-- Slice 0028 §2.2/§2.6, migration 1 of 8: every breed's conformation target snapped onto the
-- 4-point ladder (rung every 4 points, base 2 - src/engines/conformation/typeGene.ts's
-- nearestRung/rungValue). Weights are untouched; only the five targets move, each by at most 2
-- points (§2.2: "on a 4-point ladder no target moves more than 2 points").
--
-- Numbers here are nearestRung(target) re-expressed as rungValue, computed by hand from the raw
-- targets migrations 0035/0107/0111 seeded - test/genetics/consistency-style tests should read this
-- file rather than re-deriving it, per CLAUDE.md §7 test 1.

-- Quarter Horse: neck 55->54, shoulder 70->70, back 35->34, hock 50->50, head 35->34.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 54,
  '$.traits.shoulder_angle.target', 70,
  '$.traits.back_length.target', 34,
  '$.traits.hock_set.target', 50,
  '$.traits.head_profile.target', 34
) WHERE code = 'QH';

-- Arabian: neck 75->74, shoulder 72->74, back 28->30, hock 48->50, head 8->10.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 74,
  '$.traits.shoulder_angle.target', 74,
  '$.traits.back_length.target', 30,
  '$.traits.hock_set.target', 50,
  '$.traits.head_profile.target', 10
) WHERE code = 'AR';

-- Thoroughbred: neck 65->66, shoulder 80->82, back 50->50, hock 55->54, head 48->50.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 66,
  '$.traits.shoulder_angle.target', 82,
  '$.traits.back_length.target', 50,
  '$.traits.hock_set.target', 54,
  '$.traits.head_profile.target', 50
) WHERE code = 'TB';

-- German Warmblood: neck 72->74, shoulder 78->78, back 52->54, hock 62->62, head 50->50.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 74,
  '$.traits.shoulder_angle.target', 78,
  '$.traits.back_length.target', 54,
  '$.traits.hock_set.target', 62,
  '$.traits.head_profile.target', 50
) WHERE code = 'GW';

-- Friesian: neck 82->82, shoulder 68->70, back 40->42, hock 62->62, head 70->70.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 82,
  '$.traits.shoulder_angle.target', 70,
  '$.traits.back_length.target', 42,
  '$.traits.hock_set.target', 62,
  '$.traits.head_profile.target', 70
) WHERE code = 'FR';

-- Paso Fino: neck 68->70, shoulder 60->62, back 30->30, hock 45->46, head 62->62.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 70,
  '$.traits.shoulder_angle.target', 62,
  '$.traits.back_length.target', 30,
  '$.traits.hock_set.target', 46,
  '$.traits.head_profile.target', 62
) WHERE code = 'PF';

-- Icelandic: neck 40->42, shoulder 35->34, back 42->42, hock 36->38, head 57->58.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 42,
  '$.traits.shoulder_angle.target', 34,
  '$.traits.back_length.target', 42,
  '$.traits.hock_set.target', 38,
  '$.traits.head_profile.target', 58
) WHERE code = 'IC';

-- Nokota: neck 40->42, shoulder 45->46, back 58->58, hock 36->38, head 66->66.
UPDATE breeds SET ideal_vector = json_set(
  ideal_vector,
  '$.traits.neck_length.target', 42,
  '$.traits.shoulder_angle.target', 46,
  '$.traits.back_length.target', 58,
  '$.traits.hock_set.target', 38,
  '$.traits.head_profile.target', 66
) WHERE code = 'NOK';
