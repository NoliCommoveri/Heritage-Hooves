import type { Env } from '../types';
import { textResponse } from '../lib/http';
import { renderHealthText } from '../render/health';
import { getWorld } from '../db/world';

export async function healthRoute(env: Env): Promise<Response> {
  try {
    const world = await getWorld(env);
    return textResponse(renderHealthText(world, true));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResponse(`migrations: missing tables or database unreachable\nerror: ${message}\n`, { status: 500 });
  }
}
