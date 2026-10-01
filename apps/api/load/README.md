# Load tests

[k6](https://grafana.com/docs/k6/latest/) scripts, run by hand against a local
api. They are not part of CI, Jest or the TypeScript build.

```sh
pnpm --filter api load <test> [--no-verify] [k6 run args…]

pnpm --filter api load                      # lists the tests
pnpm --filter api load messenger-webhook    # by name: load/tests/messenger-webhook.k6.js
pnpm --filter api load ./load/tests/messenger-webhook.k6.js   # or by path
pnpm --filter api load messenger-webhook -e RATE=10 -e DURATION=10s -e SCENARIOS=steady
```

`load/run.mjs` takes the test as its argument and does the following:

- loads `apps/api/.env` into k6's environment, so a test reads
  `META_APP_SECRET` and the rest as `__ENV` without a secret on the command line.
  Variables already set in the shell win.
- sets `RUN_ID`, `TEST_NAME` and `BASE_URL` (`http://localhost:$PORT` unless set).
- refuses to run when `NODE_ENV=production`.
- passes every other argument to `k6 run`. `K6_BIN` overrides the `k6` binary.
- writes the k6 summary to `load/results/<test>-<runId>.json` (gitignored).
- exits with k6's code, so a crossed threshold fails the command.
- if k6 passed and the test has a sibling `<test>.verify.mjs`, runs it on the
  summary and exits with its code. `--no-verify` skips it.

**Never point `BASE_URL` at production.** The tests queue fake work, and
signing it requires the real app secret.

## Adding a test

Add `load/tests/<name>.k6.js`. It is picked up by name. Shared k6 helpers live
in `load/lib/` (`meta.js`: webhook signing and Page payload builders). Add a
`<name>.verify.mjs` only when the run leaves state worth checking. Most tests
need none.

## messenger-webhook

`POST /api/v1/webhooks/messenger`: HMAC check, parse, one BullMQ job per text
message (`jobId = mid`). The test covers this HTTP and enqueue layer and nothing
past it. Page ids are fake (`lt-page-*`), so a running worker drops the jobs as
unknown-page and never calls Meta.

Prerequisites: `pnpm dev:up`, migrations applied, and the api running
(`pnpm --filter api dev`, or `pnpm --filter api build && pnpm --filter api start`
for numbers closer to production). **Stop the worker.** The queue keeps
completed jobs for only 1 h or 1000 jobs, so a draining worker makes the verify
step under-count.

| Scenario        | Load                                                     | Checks                          |
| --------------- | -------------------------------------------------------- | ------------------------------- |
| `steady`        | `RATE` req/s (50) for `DURATION` (2m), unique messages   | 200 `EVENT_RECEIVED`            |
| `spike`         | after `steady`, ramps to `SPIKE_RATE` (300) for 30 s     | 200 `EVENT_RECEIVED`            |
| `redelivery`    | 5 req/s resending 20 fixed messages, same bytes and mids | 200; still one job per mid      |
| `bad_signature` | 2 req/s signed with the wrong secret                     | 401 `WEBHOOK_INVALID_SIGNATURE` |

Bodies mix single messages, batched entries with delivery receipts, Page echoes
and attachment-only events. Only the text messages count as expected jobs.
`SCENARIOS=steady,redelivery` runs a subset.

Thresholds: valid-request failures < 1%, checks > 99%, steady p95 < 200 ms and
p99 < 500 ms, spike p95 < 1 s, redelivery p95 < 200 ms. Meta retries a
delivery that is not acknowledged in time and eventually disables the
subscription, so acknowledgement latency is the number to watch.

`messenger-webhook.verify.mjs` compares the summary's `expected_jobs` with the
`lt-<runId>-*` jobs on `messenger-inbound`:

- fewer jobs than expected means messages were acknowledged but not queued.
- more jobs than expected means deduplication failed.

Afterwards it deletes this run's jobs. `KEEP_JOBS=1` keeps them for inspection
in Bull Board.
