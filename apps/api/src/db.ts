import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __atlasPrisma__: PrismaClient | undefined;
}

export const prisma =
  global.__atlasPrisma__ ||
  new PrismaClient({
    log: ['warn', 'error']
  });

if (process.env.NODE_ENV !== 'production') {
  global.__atlasPrisma__ = prisma;
}

