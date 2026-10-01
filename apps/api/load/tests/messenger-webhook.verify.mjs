#!/usr/bin/env node
// Post-run check for messenger-webhook.k6.js, run by load/run.mjs:
//   node messenger-webhook.verify.mjs <summary.json> <runId>
//
// k6 only sees HTTP answers. This checks the other half of the webhook's job:
// every unique text message the run sent is exactly one job on the inbound
// queue - none lost under load, redeliveries collapsed by jobId = mid. It then
// deletes the run's jobs (KEEP_JOBS=1 keeps them).
//
// Run with the worker stopped. The queue keeps completed jobs for 1 h or 1000
// jobs (queue.module.ts), so a worker draining a large run prunes jobs before
// they are counted and the check under-counts.

import { readFileSync } from 'node:fs';
import { Queue } from 'bullmq';

// MESSENGER_QUEUE in src/modules/queue/queue.constants.ts.
const QUEUE_NAME = 'messenger-inbound';
const STATES = ['waiting', 'prioritized', 'active', 'delayed', 'completed', 'failed', 'paused'];

const [summaryPath, runId] = process.argv.slice(2);
if (!summaryPath || !runId) {
  console.error('Usage: messenger-webhook.verify.mjs <summary.json> <runId>');
  process.exit(2);
}
if (!process.env.REDIS_URL) {
  console.error('REDIS_URL is not set.');
  process.exit(2);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const expected = summary.metrics?.expected_jobs?.count ?? 0;
const prefix = `lt-${runId}-`;

const queue = new Queue(QUEUE_NAME, { connection: { url: process.env.REDIS_URL } });
try {
  const jobs = await queue.getJobs(STATES, 0, -1);
  const ours = new Map();
  for (const job of jobs) {
    if (job?.id?.startsWith(prefix)) ours.set(job.id, job);
  }

  console.log(`verify: expected ${expected} jobs, found ${ours.size} on ${QUEUE_NAME}`);
  const ok = ours.size === expected;
  if (!ok) {
    console.error(
      ours.size < expected
        ? 'verify: jobs missing - the webhook acknowledged messages it did not queue (or a running worker pruned completed jobs).'
        : 'verify: more jobs than unique messages - deduplication by mid failed.',
    );
  }

  if (process.env.KEEP_JOBS !== '1') {
    await Promise.all([...ours.values()].map((job) => job.remove().catch(() => undefined)));
    console.log(`verify: removed ${ours.size} jobs with prefix ${prefix}`);
  }
  process.exitCode = ok ? 0 : 1;
} finally {
  await queue.close();
}
