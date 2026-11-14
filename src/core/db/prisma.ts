import { PrismaClient } from "@prisma/client";
import { logger } from "../logger/index.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "event", level: "error" },
      { emit: "event", level: "info" },
      { emit: "event", level: "warn" },
    ],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Log query and error events in development mode
prisma.$on("error" as never, (e: { message: string }) => {
  logger.error({ err: e }, "Prisma error");
});

export async function connectDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info("Database connected successfully (PostgreSQL)");
    return true;
  } catch (error) {
    logger.warn(
      { err: error },
      "PostgreSQL connection failed or database unavailable at startup",
    );
    return false;
  }
}
