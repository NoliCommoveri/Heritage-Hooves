// The scheduled handler's entry point, and the manual-advance action behind it. See slice §8.

import type { Env } from '../types';
import { getWorld } from '../db/world';
import { executeTick } from '../db/tick';
import { decideNextSlot } from './slot';
import { localParts } from '../lib/time';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export async function runScheduledTick(env: Env): Promise<void> {
  const world = await getWorld(env);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const local = localParts(nowSeconds, world.tick_timezone);

  const decision = decideNextSlot(
    {
      tickTimesLocal: JSON.parse(world.tick_times_local),
      lastTickLocalDate: world.last_tick_local_date,
      lastTickSlotLocal: world.last_tick_slot_local,
    },
    { dateKey: local.dateKey, minutesOfDay: local.minutesOfDay }
  );

  // The large majority of invocations land here: nothing due, write nothing.
  if (!decision.run) return;

  await executeTick(env, {
    triggerSource: 'cron',
    intendedLocalTime: decision.slot,
    localDate: decision.localDate,
    firedLocalTime: `${pad2(local.hour)}:${pad2(local.minute)}`,
    updateSlotBookkeeping: true,
  });
}

/**
 * Advances the world by exactly one tick immediately, without waiting for a cron slot. Additive:
 * does not touch the cron's slot bookkeeping, so the next scheduled tick still fires as normal.
 */
export async function runManualTick(env: Env): Promise<void> {
  const world = await getWorld(env);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const local = localParts(nowSeconds, world.tick_timezone);

  await executeTick(env, {
    triggerSource: 'manual',
    intendedLocalTime: null,
    localDate: local.dateKey,
    firedLocalTime: `${pad2(local.hour)}:${pad2(local.minute)}`,
    updateSlotBookkeeping: false,
  });
}
