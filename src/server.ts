import http from "http";
import { createApp } from "./app.js";
import "./config/env.js";
import { logger } from "./core/logger/index.js";
import { connectDatabase } from "./core/db/prisma.js";
import { initSocketGateway } from "./realtime/gateway.js";

async function bootstrap(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  const port = 3000;
  const host = '0.0.0.0';

  // Start HTTP server on port 3000
  server.listen(port, host, async () => {
    logger.info(
      `🚀 FYP Project Management Platform Backend listening at http://${host}:${port}`,
    );
    logger.info(`📋 Health probe available at: http://${host}:${port}/health`);
    logger.info(`📡 API v1 routes mounted at: http://${host}:${port}/api/v1`);

    // Verify background connections without blocking server listening
    await connectDatabase();
  });

  // Attach real-time Socket.IO gateway
  const io = await initSocketGateway(server);
  logger.info("🔌 Socket.IO Gateway attached to HTTP server");

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received: closing HTTP server gracefully...`);
    io.close(() => {
      logger.info("Socket.IO connections closed.");
    });
    server.close(() => {
      logger.info("HTTP server closed.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, "Fatal error during server bootstrap");
  process.exit(1);
});
