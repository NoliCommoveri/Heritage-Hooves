// Plain text, no authentication, no secrets. What the operator looks at when something seems wrong.
import type { WorldRow } from '../db/world';
import { formatLocal, nowUtcSeconds } from '../lib/time';

export function renderHealthText(world: WorldRow, migrationsOk: boolean): string {
  const lines = [
    `game_day: ${world.game_day}`,
    `tick_seq: ${world.tick_seq}`,
    `paused: ${world.paused ? 'yes' : 'no'}`,
    `last_tick_local: ${world.last_tick_local_date ?? 'never'} ${world.last_tick_slot_local ?? ''}`.trim(),
    `current_local_time: ${formatLocal(nowUtcSeconds(), world.tick_timezone)}`,
    `migrations: ${migrationsOk ? 'ok' : 'missing tables'}`,
  ];
  return lines.join('\n') + '\n';
}
