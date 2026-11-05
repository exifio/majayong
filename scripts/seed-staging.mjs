#!/usr/bin/env node
/**
 * Staging-only catalog seed. Run after `npm run build` and `npm run db:migrate`.
 * Creates the approved reservation-restaurant catalog blocks used by DEFAULT_DRAFT.
 * Does not create users, projects, contracts, or copy local fixtures.
 */
import { PrismaClient } from '@prisma/client';
import { seedReservationRestaurantCatalog } from '../dist/modules/catalog/seed.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = new PrismaClient();
try {
  const count = await seedReservationRestaurantCatalog(db);
  console.log(`seed-staging: ${count} catalog blocks upserted`);
} finally {
  await db.$disconnect();
}
