import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { AppConfig } from '../../src/modules/config/config.module';
import { ProductSeeder, SeedTargetError } from './product-seeder';
import { refuseUnlessLocal } from './seed-guard';
import { SeedModule } from './seed.module';

const USAGE = `Usage: pnpm --filter api db:seed-products [--org <slug>] [--count <n>] [--reset]

  --org <slug>  the shop to seed; may be left out when there is only one
  --count <n>   generated products to add after the hand-written ones (default 0)
  --reset       delete the shop's products first; any an order points at are kept`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      org: { type: 'string' },
      count: { type: 'string', default: '0' },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 0) {
    console.error(`--count must be a whole number, not "${values.count}".\n\n${USAGE}`);
    return 2;
  }

  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(AppConfig);
    const refusal = refuseUnlessLocal(config.get('NODE_ENV'), config.get('DATABASE_URL'));
    if (refusal) {
      console.error(refusal);
      return 2;
    }

    const seeder = app.get(ProductSeeder);
    const shop = await seeder.findOrganization(values.org);
    console.log(`Seeding ${shop.name} (${shop.slug})…`);
    const s = await seeder.run(shop.id, { count, reset: values.reset });

    if (values.reset) {
      console.log(`Removed ${s.removed} products; kept ${s.keptInUse} that orders point at.`);
    }
    console.log(
      `Created ${s.created} catalog products (${s.skipped} already there) and ${s.filler} generated.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof SeedTargetError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  } finally {
    await app.close();
  }
}

// The pg pool holds the event loop open; leave once the work is done.
process.exit(await main());
