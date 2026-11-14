/**
 * @file src/realtime/gateway.ts
 * @description Real-Time Socket.IO Gateway.
 *
 * Implements SRS v3.0 §4.7 (FR-RT-01..12), §7.3 (Room Strategy), and §7.4 (Auth flow):
 * 1. JWT Handshake verification (token extraction + signature/expiry).
 * 2. Account status verification (FR-RT-03: user.isActive === true via Prisma).
 * 3. Auto-join user room `user:{userId}` on connection.
 * 4. Project room authorization check (`subscribe:project`) with Administrator bypass (Rule 9).
 * 5. Redis Pub/Sub integration for horizontal multi-instance synchronization.
 */

import http from "http";
import { Server, Socket } from "socket.io";
import { env } from "../config/env.js";
import { normalizeCorsOrigins, isOriginAllowed } from "../config/cors-origins.js";
import { prisma } from "../core/db/prisma.js";
import { logger } from "../core/logger/index.js";
import { AppError } from "../core/errors/AppError.js";
import { ERROR_CODES } from "../core/errors/codes.js";
import { tokenService, AccessTokenClaims } from "../modules/auth/index.js";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  projectRoom,
  userRoom,
} from "../../shared/socket.contract.js";
import { startRealtimeSubscriber } from "../infra/redis/subscriber.js";

export interface CustomSocketData {
  userId: string;
  globalRole: string;
}

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  CustomSocketData
>;

export type AppSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  CustomSocketData
>;

/**
 * Handshake token extraction: checks handshake auth.token first, then Authorization header.
 */
function extractHandshakeToken(socket: Socket): {
  token: string | null;
  warning?: string;
} {
  const authToken = socket.handshake.auth?.token as string | undefined;
  const authHeader = socket.handshake.headers.authorization;

  let headerToken: string | null = null;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    headerToken = authHeader.slice(7).trim();
  }

  if (authToken && headerToken && authToken !== headerToken) {
    return {
      token: authToken,
      warning:
        "Both auth.token and Authorization header provided and disagree. Preferring auth.token.",
    };
  }

  const token = authToken || headerToken || null;
  return { token };
}

/**
 * Initializes and mounts the Socket.IO gateway on the provided HTTP server.
 *
 * @param httpServer The Node.js HTTP server instance
 * @returns Configured AppSocketServer instance
 */
export async function initSocketGateway(
  httpServer: http.Server,
): Promise<AppSocketServer> {
  const allowedOrigins = normalizeCorsOrigins(env.CORS_ORIGIN, {
    allowWildcard: env.NODE_ENV !== "production",
  });

  const io: AppSocketServer = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
        } else {
          callback(new Error("Origin not allowed by CORS"));
        }
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // ==========================================================================
  // Handshake Authentication Middleware (§4.7 FR-RT-02, FR-RT-03)
  // ==========================================================================
  io.use(async (socket, next) => {
    const { token, warning } = extractHandshakeToken(socket);

    if (warning) {
      logger.warn({ socketId: socket.id }, warning);
    }

    if (!token) {
      logger.warn(
        { socketId: socket.id },
        "Socket handshake rejected: Token missing",
      );
      return next(new Error(ERROR_CODES.AUTH_TOKEN_MISSING));
    }

    let claims: AccessTokenClaims;
    try {
      claims = tokenService.verifyAccessToken(token);
    } catch (err: unknown) {
      if (err instanceof AppError) {
        if (err.code === ERROR_CODES.TOKEN_EXPIRED) {
          logger.warn(
            { socketId: socket.id },
            "Socket handshake rejected: Token expired",
          );
          return next(new Error(ERROR_CODES.AUTH_TOKEN_EXPIRED));
        }
        if (err.code === ERROR_CODES.UNAUTHORIZED) {
          logger.warn(
            { socketId: socket.id },
            "Socket handshake rejected: Token missing",
          );
          return next(new Error(ERROR_CODES.AUTH_TOKEN_MISSING));
        }
      }
      logger.warn(
        { socketId: socket.id, err },
        "Socket handshake rejected: Token invalid",
      );
      return next(new Error(ERROR_CODES.AUTH_TOKEN_INVALID));
    }

    // Check JTI blacklist in Redis
    try {
      const isBlacklisted = await tokenService.isAccessJtiBlacklisted(claims.jti);
      if (isBlacklisted) {
        logger.warn(
          { socketId: socket.id, jti: claims.jti },
          "Socket handshake rejected: Token JTI blacklisted",
        );
        return next(new Error(ERROR_CODES.AUTH_TOKEN_INVALID));
      }
    } catch (redisError: unknown) {
      logger.error(
        { err: redisError, socketId: socket.id },
        "Redis error during socket handshake JTI blacklist check",
      );
      return next(new Error(ERROR_CODES.INTERNAL_SERVER_ERROR));
    }

    // FR-RT-03: Verify account status before room join
    try {
      const user = await prisma.user.findUnique({
        where: { id: claims.userId },
        select: { id: true, isActive: true, globalRole: true },
      });

      if (!user || !user.isActive) {
        logger.warn(
          { userId: claims.userId, socketId: socket.id },
          "Socket handshake rejected: Account missing or inactive",
        );
        return next(new Error(ERROR_CODES.AUTH_ACCOUNT_INACTIVE));
      }

      socket.data = {
        userId: user.id,
        globalRole: user.globalRole,
      };

      return next();
    } catch (dbError: unknown) {
      logger.error(
        { err: dbError, userId: claims.userId, socketId: socket.id },
        "Database error during socket handshake verification",
      );
      return next(new Error(ERROR_CODES.INTERNAL_SERVER_ERROR));
    }
  });

  // ==========================================================================
  // Connection Handler & Room Management
  // ==========================================================================
  io.on("connection", async (socket: AppSocket) => {
    const { userId, globalRole } = socket.data;

    // FR-RT-05: Auto-join personal user room user:{userId}
    const personalRoom = userRoom(userId);
    await socket.join(personalRoom);

    logger.info(
      { userId, globalRole, socketId: socket.id, personalRoom },
      "Real-time client connected and joined personal user room",
    );

    // ========================================================================
    // Project Room Subscription Handler (FR-RT-03, FR-RT-04, FR-RT-12)
    // ========================================================================
    socket.on("subscribe:project", async (payload, ack) => {
      try {
        if (!payload || !payload.projectId) {
          const errorPayload = {
            code: ERROR_CODES.INVALID_INPUT,
            message: "projectId is required for project room subscription",
          };
          socket.emit("error", errorPayload);
          if (typeof ack === "function") {
            ack({ ok: false, error: errorPayload });
          }
          return;
        }

        const { projectId } = payload;

        // Rule 9: Administrator bypasses project scope. No other role does.
        let isAuthorized = globalRole === "Administrator";

        if (!isAuthorized) {
          const membership = await prisma.projectMember.findUnique({
            where: {
              projectId_userId: {
                projectId,
                userId,
              },
            },
          });
          isAuthorized = Boolean(membership);
        }

        if (!isAuthorized) {
          const errorPayload = {
            code: ERROR_CODES.AUTHZ_NOT_PROJECT_MEMBER,
            message: `User is not an authorized member of project ${projectId}`,
          };
          logger.warn(
            { userId, projectId, globalRole },
            "Unauthorized project room subscription attempt rejected",
          );
          socket.emit("error", errorPayload);
          if (typeof ack === "function") {
            ack({ ok: false, error: errorPayload });
          }
          return;
        }

        const room = projectRoom(projectId);
        await socket.join(room);

        logger.debug(
          { userId, projectId, room, socketId: socket.id },
          "Socket successfully subscribed to project room",
        );

        if (typeof ack === "function") {
          ack({ ok: true, room });
        }
      } catch (err: unknown) {
        logger.error(
          { err, userId, payload },
          "Error occurred during subscribe:project execution",
        );
        const errorPayload = {
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Internal server error during room subscription",
        };
        socket.emit("error", errorPayload);
        if (typeof ack === "function") {
          ack({ ok: false, error: errorPayload });
        }
      }
    });

    // ========================================================================
    // Project Room Unsubscription Handler
    // ========================================================================
    socket.on("unsubscribe:project", async (payload, ack) => {
      try {
        if (!payload || !payload.projectId) {
          return;
        }

        const room = projectRoom(payload.projectId);
        await socket.leave(room);

        logger.debug(
          { userId, room, socketId: socket.id },
          "Socket unsubscribed from project room",
        );

        if (typeof ack === "function") {
          ack({ ok: true, room });
        }
      } catch (err: unknown) {
        logger.error(
          { err, userId, payload },
          "Error occurred during unsubscribe:project execution",
        );
      }
    });

    // ========================================================================
    // Lifecycle Event Logging
    // ========================================================================
    socket.on("disconnect", (reason) => {
      logger.info(
        { userId, socketId: socket.id, reason },
        "Real-time client disconnected",
      );
    });

    socket.on("error", (err) => {
      logger.error(
        { userId, socketId: socket.id, err },
        "Real-time socket error encountered",
      );
    });
  });

  // Start horizontal Pub/Sub event bridge
  await startRealtimeSubscriber(io as unknown as AppSocketServer);

  return io;
}
