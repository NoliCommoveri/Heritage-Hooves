-- Slice 0014 §5.3/§7: fills management_text for the two conditions Part B applies to. Separate
-- from the column-adding migration - adding a column and populating it is two logical changes
-- (CLAUDE.md §8).
UPDATE conditions
SET management_text = 'A controlled diet low in potassium, regular light exercise, and avoiding sudden feed changes or long periods without turnout. Missed management raises the chance of an episode during work.'
WHERE code = 'HYPP';

UPDATE conditions
SET management_text = 'A diet low in starch and sugar, high in fat and fibre, with steady daily exercise and no days of complete rest. Missed management raises the chance of tying-up during work.'
WHERE code = 'PSSM1';
