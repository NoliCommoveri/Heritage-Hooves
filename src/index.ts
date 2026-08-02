import type { Env } from './types';
import { handleRequest } from './router';
import { runScheduledTick } from './tick';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error(err);
      return new Response('Something went wrong.', { status: 500 });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runScheduledTick(env);
  },
};
