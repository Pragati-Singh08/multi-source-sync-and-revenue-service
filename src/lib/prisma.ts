import { PrismaClient } from "@prisma/client";

// Standard singleton pattern so ts-node-dev hot reloads don't exhaust
// Postgres connections in dev.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
