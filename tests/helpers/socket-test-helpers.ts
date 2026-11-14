import jwt from "jsonwebtoken";
import { io as ioc, Socket as ClientSocket } from "socket.io-client";
import { env } from "../../src/config/env.js";

export interface BuildJwtOverrides {
  expiresIn?: string | number;
  jwtid?: string;
  secret?: string;
  globalRole?: string;
}

/**
 * Builds and signs a real JWT access token using env.JWT_ACCESS_SECRET.
 */
export function buildTestJwt(
  userId: string,
  overrides?: BuildJwtOverrides,
): string {
  const secret = overrides?.secret ?? env.JWT_ACCESS_SECRET;
  const payload = {
    userId,
    globalRole: overrides?.globalRole ?? "Team Member",
  };

  const options: jwt.SignOptions = {
    expiresIn: (overrides?.expiresIn as jwt.SignOptions["expiresIn"]) ?? "15m",
  };

  if (overrides?.jwtid) {
    options.jwtid = overrides.jwtid;
  }

  return jwt.sign(payload, secret, options);
}

/**
 * Connects a real socket.io-client to the given server port with specified auth token.
 */
export function connectTestSocket(
  port: number,
  token?: string | null,
  options?: { extraHeaders?: Record<string, string>; forceNew?: boolean },
): ClientSocket {
  const socket = ioc(`http://127.0.0.1:${port}`, {
    autoConnect: true,
    forceNew: options?.forceNew ?? true,
    transports: ["websocket"],
    auth: token !== undefined && token !== null ? { token } : undefined,
    extraHeaders: options?.extraHeaders,
  });

  return socket;
}

/**
 * Waits for a specific event on a socket, resolving with the payload or rejecting on timeout.
 */
export function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  predicate?: (data: T) => boolean,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    function handler(data: T): void {
      if (!predicate || predicate(data)) {
        if (timer) clearTimeout(timer);
        socket.off(event, handler);
        resolve(data);
      }
    }

    timer = setTimeout(() => {
      socket.off(event, handler);
      reject(
        new Error(
          `Timeout waiting for event "${event}" after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    socket.on(event, handler);
  });
}

/**
 * Waits for a connect_error event on a socket, resolving with the error or rejecting on timeout.
 */
export function waitForConnectError(
  socket: ClientSocket,
  timeoutMs = 3000,
): Promise<Error> {
  return new Promise<Error>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;

    function handler(err: Error): void {
      if (timer) clearTimeout(timer);
      socket.off("connect_error", handler);
      resolve(err);
    }

    timer = setTimeout(() => {
      socket.off("connect_error", handler);
      reject(
        new Error(
          `Timeout waiting for connect_error after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    socket.on("connect_error", handler);
  });
}
