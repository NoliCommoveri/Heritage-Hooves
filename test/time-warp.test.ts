/**
 * The per-horse time warp, 2026-08-05. The cap is the safety rule and the only thing here that would
 * be genuinely bad to get wrong: a warp must never be able to push a horse past maturity, which is
 * what stops it being a way to run a mare out of her breeding years or a veteran into its own death
 * date.
 */
import { describe, expect, it } from 'vitest';
import { planTimeWarp } from '../src/db/timeWarp';
import type { HorseRow } from '../src/db/horses';
import type { ConfigValues } from '../src/lib/config-cache';

/** Only the three keys planTimeWarp reads. Cast rather than built in full - ConfigValues has well
 * over a hundred members and none of the rest is consulted here. */
const CFG = { min_breeding_age_game_days: 1080, time_warp_game_days: 180, time_warp_cost: 400 } as ConfigValues;

function horseBornOn(bornGameDay: number, status: HorseRow['status'] = 'alive'): HorseRow {
  return { id: 1, born_game_day: bornGameDay, status, owner_stable_id: 1 } as HorseRow;
}

describe('planTimeWarp', () => {
  it('a month-old foal gets a full six-month step', () => {
    const plan = planTimeWarp(horseBornOn(970), 1000, CFG);
    expect(plan).toEqual({ days: 180, cost: 400, clamped: false });
  });

  it('never carries a horse past maturity - the last step is short, and says so', () => {
    // Born on day 20, so on day 1000 the horse is 980 days old: 100 days short of maturity.
    const plan = planTimeWarp(horseBornOn(20), 1000, CFG);
    expect(plan).toEqual({ days: 100, cost: 400, clamped: true });
  });

  it('is refused outright once the horse is grown, at the boundary and past it', () => {
    expect(planTimeWarp(horseBornOn(1000 - 1080), 1000, CFG)).toBeNull();
    expect(planTimeWarp(horseBornOn(0), 2000, CFG)).toBeNull();
  });

  it('a horse warped repeatedly can never exceed maturity, however many times it is bought', () => {
    let born = 990;
    const gameDay = 1000;
    for (let purchase = 0; purchase < 20; purchase++) {
      const plan = planTimeWarp(horseBornOn(born), gameDay, CFG);
      if (plan === null) break;
      born -= plan.days;
      expect(gameDay - born).toBeLessThanOrEqual(CFG.min_breeding_age_game_days);
    }
    expect(gameDay - born).toBe(CFG.min_breeding_age_game_days);
    expect(planTimeWarp(horseBornOn(born), gameDay, CFG)).toBeNull();
  });

  it('is refused for a horse that is not alive', () => {
    expect(planTimeWarp(horseBornOn(970, 'dead'), 1000, CFG)).toBeNull();
    expect(planTimeWarp(horseBornOn(970, 'removed'), 1000, CFG)).toBeNull();
  });

  it('a step size of zero disables the whole mechanism rather than selling a no-op', () => {
    expect(planTimeWarp(horseBornOn(970), 1000, { ...CFG, time_warp_game_days: 0 })).toBeNull();
  });
});
