-- The Quarter Horse's standard (slice 0008 §4.2): a moderate neck, a sloping shoulder, a short
-- back, and a middling hock - not "more of everything". Three of the four targets sit somewhere
-- other than the top of the scale on purpose.
UPDATE breeds
SET ideal_vector = '{"v":1,"traits":{"neck_length":{"target":55,"weight":1.0},"shoulder_angle":{"target":70,"weight":1.2},"back_length":{"target":35,"weight":1.1},"hock_set":{"target":50,"weight":0.9}}}'
WHERE code = 'QH';
