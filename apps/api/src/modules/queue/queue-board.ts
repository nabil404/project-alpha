import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';
import type { Express as ExpressApp } from 'express';
import { MESSENGER_QUEUE, PROFILE_QUEUE, STORAGE_QUEUE } from './queue.constants';

export const QUEUE_BOARD_PATH = '/api/queues';

/**
 * Serves Bull Board at /api/queues: every queue, its jobs and their payloads,
 * with retry, promote and clean. main.ts calls this in development only, and
 * through a dynamic import, so the production image never loads @bull-board
 * (a devDependency).
 *
 * Mounted straight on Express, not through Nest routing, so SessionGuard never
 * sees it - which is exactly why it must stay out of production: job payloads
 * hold every seller's customer messages. Open it through the Vite proxy
 * (http://localhost:5173/api/queues) like the Swagger page.
 */
export function setupQueueBoard(app: INestApplication): void {
  const serverAdapter = new ExpressAdapter().setBasePath(QUEUE_BOARD_PATH);

  createBullBoard({
    queues: [MESSENGER_QUEUE, STORAGE_QUEUE, PROFILE_QUEUE].map(
      (name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name))),
    ),
    serverAdapter,
  });

  const express = app.getHttpAdapter().getInstance() as ExpressApp;
  express.use(QUEUE_BOARD_PATH, serverAdapter.getRouter());
}
