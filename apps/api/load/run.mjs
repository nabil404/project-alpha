#!/usr/bin/env node
// Runs one k6 load test, picked by argument:
//
//   pnpm --filter api load <test> [--no-verify] [k6 run args…]
//   pnpm --filter api load messenger-webhook -e RATE=10 -e DURATION=10s
//   pnpm --filter api load ./load/tests/messenger-webhook.k6.js
//
// <test> is a name under load/tests (`<name>.k6.js`) or a path to a k6 script.
// After k6 passes, a sibling `<name>.verify.mjs`, if the test has one, checks
// what the run left behind; --no-verify skips it.
//
// apps/api/.env is loaded into k6's environment, so META_APP_SECRET and the
// like reach the test as __ENV without appearing on a command line.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOAD_DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = dirname(LOAD_DIR);
const TESTS_DIR = join(LOAD_DIR, 'tests');
const RESULTS_DIR = join(LOAD_DIR, 'results');
const SUFFIX = '.k6.js';

function availableTests() {
  return readdirSync(TESTS_DIR)
    .filter((file) => file.endsWith(SUFFIX))
    .map((file) => file.slice(0, -SUFFIX.length));
}

function usage(problem) {
  console.error(`${problem}\n\nUsage: pnpm --filter api load <test> [--no-verify] [k6 run args…]`);
  console.error(`Tests in load/tests: ${availableTests().join(', ') || '(none)'}`);
  process.exit(1);
}

/** A test name, or a path from the caller's cwd or from apps/api. */
function resolveTest(arg) {
  const byName = join(TESTS_DIR, `${arg}${SUFFIX}`);
  if (existsSync(byName)) return byName;
  for (const base of [process.env.INIT_CWD ?? process.cwd(), API_DIR]) {
    const path = resolve(base, arg);
    if (path.endsWith('.js') && existsSync(path)) return path;
  }
  return null;
}

function run(command, args, env) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: 'inherit', env, cwd: API_DIR });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        console.error(
          `${command} not found on PATH. Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/`,
        );
      } else {
        console.error(error.message);
      }
      done(1);
    });
    child.on('exit', (code, signal) => done(signal ? 1 : (code ?? 1)));
  });
}

// pnpm forwards a literal `--` on some versions; it is not a k6 argument.
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const verify = !args.includes('--no-verify');
const [testArg, ...k6Args] = args.filter((arg) => arg !== '--no-verify');

if (!testArg) usage('No load test given.');
const testFile = resolveTest(testArg);
if (!testFile) usage(`Unknown load test "${testArg}".`);

// apps/api/.env is the repo's only env file. Absent is fine: the shell may
// already carry what the test needs.
try {
  process.loadEnvFile(join(API_DIR, '.env'));
} catch {
  // no .env here
}

if (process.env.NODE_ENV === 'production') {
  console.error('NODE_ENV is production: refusing to load-test with production settings.');
  process.exit(1);
}

const testName = basename(testFile).replace(/\.k6\.js$|\.js$/, '');
const runId = String(Date.now());
mkdirSync(RESULTS_DIR, { recursive: true });
const summaryPath = join(RESULTS_DIR, `${testName}-${runId}.json`);

const env = {
  ...process.env,
  RUN_ID: runId,
  TEST_NAME: testName,
  BASE_URL: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
};

console.log(`load: ${testName} (run ${runId})`);
const k6 = process.env.K6_BIN ?? 'k6';
const k6Code = await run(k6, ['run', '--summary-export', summaryPath, ...k6Args, testFile], env);
if (k6Code !== 0) process.exit(k6Code);
console.log(`load: summary written to ${summaryPath}`);

const verifyFile = testFile.replace(/(\.k6)?\.js$/, '.verify.mjs');
if (verify && existsSync(verifyFile)) {
  console.log(`load: verifying with ${basename(verifyFile)}`);
  process.exit(await run(process.execPath, [verifyFile, summaryPath, runId], env));
}
