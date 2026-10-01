// Load test: POST /api/v1/webhooks/messenger, the HTTP + enqueue layer only.
//
// Every request is a correctly signed Page webhook for fake Pages (`lt-page-*`)
// unknown to the database, so a running worker drops the jobs as unknown-page
// and never calls Meta. Message ids carry the run id (`lt-<run>-…`), which is
// how messenger-webhook.verify.mjs finds this run's jobs in the queue.
//
// Run through the runner, which loads apps/api/.env and passes RUN_ID:
//   pnpm --filter api load messenger-webhook
//
// Environment (k6 -e or the shell):
//   META_APP_SECRET  required; the api's app secret, used to sign bodies
//   BASE_URL         default http://localhost:3000
//   RATE             steady requests/s, default 50
//   DURATION         steady duration, default 2m
//   SPIKE_RATE       spike peak requests/s, default 300
//   SCENARIOS        comma list to run a subset, default all:
//                    steady,spike,redelivery,bad_signature

import http from 'k6/http';
import exec from 'k6/execution';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
import {
  attachmentOnly,
  customerMessage,
  delivery,
  pageEcho,
  pageWebhookBody,
  signBody,
} from '../lib/meta.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const URL = `${BASE_URL}/api/v1/webhooks/messenger`;
const SECRET = __ENV.META_APP_SECRET;
const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || '2m';
const SPIKE_RATE = Number(__ENV.SPIKE_RATE || 300);
const PAGES = 5;
const REDELIVERY_SET = 20;

const ALL_SCENARIOS = ['steady', 'spike', 'redelivery', 'bad_signature'];
const SELECTED = (__ENV.SCENARIOS || ALL_SCENARIOS.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/** Unique text-message mids sent; the verify step expects exactly this many jobs. */
const expectedJobs = new Counter('expected_jobs');

const scenarios = {
  steady: {
    executor: 'constant-arrival-rate',
    exec: 'unique',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: Math.max(10, Math.ceil(RATE / 5)),
    maxVUs: Math.max(50, RATE * 2),
  },
  spike: {
    executor: 'ramping-arrival-rate',
    exec: 'unique',
    startTime: SELECTED.includes('steady') ? DURATION : '0s',
    startRate: RATE,
    timeUnit: '1s',
    stages: [
      { target: SPIKE_RATE, duration: '10s' },
      { target: SPIKE_RATE, duration: '30s' },
      { target: RATE, duration: '10s' },
    ],
    preAllocatedVUs: Math.max(20, Math.ceil(SPIKE_RATE / 5)),
    maxVUs: Math.max(100, SPIKE_RATE * 2),
  },
  redelivery: {
    executor: 'constant-arrival-rate',
    exec: 'redeliver',
    rate: 5,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 2,
    maxVUs: 10,
  },
  bad_signature: {
    executor: 'constant-arrival-rate',
    exec: 'badSignature',
    rate: 2,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 2,
    maxVUs: 10,
  },
};

for (const name of SELECTED) {
  if (!scenarios[name]) {
    throw new Error(`Unknown scenario "${name}"; expected some of ${ALL_SCENARIOS.join(', ')}`);
  }
}

export const options = {
  scenarios: Object.fromEntries(SELECTED.map((name) => [name, scenarios[name]])),
  thresholds: {
    // `kind:valid` excludes the deliberate 401s; they are also marked expected below.
    'http_req_failed{kind:valid}': ['rate<0.01'],
    'http_req_duration{scenario:steady}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{scenario:spike}': ['p(95)<1000'],
    'http_req_duration{scenario:redelivery}': ['p(95)<200'],
    checks: ['rate>0.99'],
  },
};

const pageId = (n) => `lt-page-${n % PAGES}`;
const psid = () => `lt-psid-${Math.floor(Math.random() * 1000)}`;

/**
 * A random mix shaped like real traffic. Returns the body and how many jobs it
 * should produce (text messages only).
 */
function randomBody(midPrefix) {
  let i = 0;
  const mid = () => `${midPrefix}-${i++}`;
  const roll = Math.random();
  const page = pageId(Math.floor(Math.random() * PAGES));

  if (roll < 0.7) {
    const event = customerMessage({
      mid: mid(),
      pageId: page,
      psid: psid(),
      text: 'Price of the red one?',
    });
    return { body: pageWebhookBody([{ pageId: page, messaging: [event] }]), jobs: 1 };
  }

  if (roll < 0.85) {
    // Meta batches: several entries, each with several events, deliveries mixed in.
    const entries = [0, 1].map((k) => {
      const entryPage = pageId(k + Math.floor(Math.random() * PAGES));
      return {
        pageId: entryPage,
        messaging: [
          customerMessage({
            mid: mid(),
            pageId: entryPage,
            psid: psid(),
            text: 'Do you deliver to Dhaka?',
          }),
          customerMessage({ mid: mid(), pageId: entryPage, psid: psid(), text: 'I want 2 pieces' }),
          delivery({ pageId: entryPage, psid: psid() }),
        ],
      };
    });
    return { body: pageWebhookBody(entries), jobs: 4 };
  }

  if (roll < 0.95) {
    const event = pageEcho({
      mid: mid(),
      pageId: page,
      psid: psid(),
      text: 'Yes, it is in stock',
      ...(Math.random() < 0.5 ? { appId: 123456789 } : {}),
    });
    return { body: pageWebhookBody([{ pageId: page, messaging: [event] }]), jobs: 1 };
  }

  const event = attachmentOnly({ mid: mid(), pageId: page, psid: psid() });
  return { body: pageWebhookBody([{ pageId: page, messaging: [event] }]), jobs: 0 };
}

function post(body, signature, kind, params = {}) {
  return http.post(URL, body, {
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    tags: { kind, name: 'POST /webhooks/messenger' },
    ...params,
  });
}

function checkAccepted(res) {
  return check(res, {
    'valid: 200': (r) => r.status === 200,
    'valid: EVENT_RECEIVED': (r) => r.body === 'EVENT_RECEIVED',
  });
}

function redeliveryBody(runId, n) {
  const page = pageId(n);
  const event = customerMessage({
    mid: `lt-${runId}-redelivery-${n}`,
    pageId: page,
    psid: `lt-psid-redelivery-${n}`,
    text: 'Is this still available?',
  });
  return JSON.stringify(pageWebhookBody([{ pageId: page, messaging: [event] }]));
}

export function setup() {
  if (!SECRET) {
    fail(
      'META_APP_SECRET is not set; run through `pnpm --filter api load` or pass -e META_APP_SECRET=…',
    );
  }
  // Every VU runs init code separately, so a fallback id is minted once, here.
  const runId = __ENV.RUN_ID || String(Date.now());

  // Prime the redelivery set once, so its jobs exist however long the scenario runs.
  if (SELECTED.includes('redelivery')) {
    for (let n = 0; n < REDELIVERY_SET; n++) {
      const body = redeliveryBody(runId, n);
      checkAccepted(post(body, signBody(body, SECRET), 'valid'));
    }
    expectedJobs.add(REDELIVERY_SET);
  }
  return { runId };
}

export function unique({ runId }) {
  const { vu, scenario } = exec;
  const { body, jobs } = randomBody(
    `lt-${runId}-${scenario.name}-${vu.idInTest}-${vu.iterationInScenario}`,
  );
  const raw = JSON.stringify(body);
  if (checkAccepted(post(raw, signBody(raw, SECRET), 'valid'))) {
    expectedJobs.add(jobs);
  }
}

/** Same bytes, same mid: Meta's retry. The queue must keep exactly one job. */
export function redeliver({ runId }) {
  const body = redeliveryBody(runId, Math.floor(Math.random() * REDELIVERY_SET));
  checkAccepted(post(body, signBody(body, SECRET), 'valid'));
}

/** A forged request must be refused before any work is done. */
export function badSignature({ runId }) {
  const { body } = randomBody(
    `lt-${runId}-forged-${exec.vu.idInTest}-${exec.vu.iterationInScenario}`,
  );
  const raw = JSON.stringify(body);
  const res = post(raw, signBody(raw, 'not-the-app-secret'), 'bad', {
    responseCallback: http.expectedStatuses(401),
  });
  check(res, {
    'forged: 401': (r) => r.status === 401,
    'forged: WEBHOOK_INVALID_SIGNATURE': (r) => {
      try {
        return r.json('error.code') === 'WEBHOOK_INVALID_SIGNATURE';
      } catch {
        return false;
      }
    },
  });
}
