-- The Nations League's transitional season (VI-19, 17 Nov 2026; three leagues of 18 from 2028–29): each nation's
-- share of staying in its league (stay), playing a promotion/relegation play-off (barrage), going down directly
-- (relegated) or up (promoted), and of the league it plays in 2028–29 (next_a, next_b, next_c).
ALTER TABLE agg.cup_stage_odds DROP CONSTRAINT cup_stage_odds_stage_check;
ALTER TABLE agg.cup_stage_odds ADD CONSTRAINT cup_stage_odds_stage_check
  CHECK (stage IN ('top8','playoff','out','first','second','third','fourth','stay','barrage','relegated','promoted',
                   'next_a','next_b','next_c','r64','r32','r16','qf','sf','final','win'));
