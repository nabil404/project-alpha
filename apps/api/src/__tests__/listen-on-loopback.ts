import type { INestApplication } from '@nestjs/common';

/**
 * Starts a spec's app on a free 127.0.0.1 port, which supertest then reuses.
 * Left unstarted, supertest listens on `::` for each request but dials
 * 127.0.0.1, and on macOS a process that binds 127.0.0.1 on that same port
 * (an editor extension, another spec) answers instead: random 401s and 404s.
 */
export async function listenOnLoopback(app: INestApplication): Promise<void> {
  await app.listen(0, '127.0.0.1');
}
