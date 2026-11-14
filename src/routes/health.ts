import { Router, Request, Response } from "express";
import { prisma } from "../core/db/prisma.js";
import { redis } from "../infra/redis/client.js";
import { sendSuccess } from "../core/responses/index.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req: Request, res: Response) => {
  let dbStatus = "down";
  let redisStatus = "down";

  const timeoutPromise = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), ms),
      ),
    ]);

  try {
    await timeoutPromise(prisma.$queryRaw`SELECT 1`, 500);
    dbStatus = "up";
  } catch {
    dbStatus = "unreachable";
  }

  try {
    const pong = await timeoutPromise(redis.ping(), 500);
    if (pong === "PONG") {
      redisStatus = "up";
    }
  } catch {
    redisStatus = "unreachable";
  }

  const overallStatus =
    dbStatus === "up" && redisStatus === "up" ? "healthy" : "degraded";

  return sendSuccess(res, {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    components: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});
