import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { initQueues } from '../jobs/queues.js';

/** Mounts the Bull Board dashboard router (protect with admin auth in app.ts). */
export function createBullBoardRouter(): ExpressAdapter {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/api/admin/queues');
  const activeQueues = initQueues();
  createBullBoard({
    queues: activeQueues.map((q) => new BullAdapter(q)),
    serverAdapter,
  });
  return serverAdapter;
}
