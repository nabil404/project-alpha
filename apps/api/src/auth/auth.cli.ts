import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../database/schema/index.js';
import { createAuth } from './auth.config.js';

/**
 * Entry point for `better-auth generate` only - never imported by the api or
 * the worker.
 *
 * Generating a Drizzle schema is a purely static operation, so this connects to
 * nothing: drizzle.mock() satisfies the adapter without opening a pool or
 * needing credentials.
 */
export const auth = createAuth(drizzle.mock({ schema }));
