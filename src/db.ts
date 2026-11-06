import { PrismaClient } from '@prisma/client';

// Single Prisma Client instance, reused across the app
// (avoids creating a new DB connection on every request)
export const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],
});

// Gracefully disconnect on shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});