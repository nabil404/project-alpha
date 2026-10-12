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
 * Serves Bull Board at /api/queues in development only. main.ts imports it
 * dynamically, so production never loads @bull-board, a devDependency.
 *
 * It mounts on Express, so SessionGuard never sees it, and job payloads hold
 * every seller's customer messages. It must never run in production. Open it
 * through the Vite proxy at http://localhost:5173/api/queues.
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
