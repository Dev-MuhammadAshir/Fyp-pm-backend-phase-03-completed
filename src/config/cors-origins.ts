/**
 * @file src/config/cors-origins.ts
 * @description Centralized CORS origin parsing and normalization.
 *
 * SRS NFR-SEC-05 requires environment-specific CORS allowlist. Both REST
 * (Express) and realtime (Socket.IO) boundaries MUST use the same policy.
 *
 * Parse and normalize CORS_ORIGIN.
 *
 * Normalization rules:
 *   - Split CORS_ORIGIN on commas
 *   - Trim whitespace from each entry
 *   - Strip trailing slashes (so "http://x:5173/" == "http://x:5173")
 *   - Drop empty entries
 *   - Preserve a wildcard "*" entry as-is (REST/Express convention)
 *
 * @param raw  Raw comma-separated env value
 * @param options.allowWildcard  If false and raw contains '*', throws.
 *   Should be `env.NODE_ENV !== "production"` at call site.
 * @throws Error when allowWildcard=false and raw contains '*'
 */
export function normalizeCorsOrigins(
  raw: string,
  options: { allowWildcard?: boolean } = {},
): string[] {
  if (!raw || raw.trim() === "") {
    return [];
  }

  const { allowWildcard = true } = options;

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => (origin === "*" ? "*" : origin.replace(/\/+$/, "")));

  if (!allowWildcard && origins.includes("*")) {
    throw new Error(
      "CORS wildcard '*' is forbidden in production. " +
        "Set CORS_ORIGIN to explicit comma-separated URLs.",
    );
  }

  return origins;
}

/**
 * Check whether a given request origin is allowed under the policy.
 * Handles the wildcard "*" case (any origin allowed).
 *
 * Used by both Express cors middleware and Socket.IO cors config.
 *
 * @param requestOrigin  Origin header from the incoming request (may be undefined)
 * @param allowedOrigins Normalized allowed origins (from normalizeCorsOrigins)
 * @returns true if request origin is allowed (or wildcard), false otherwise
 */
export function isOriginAllowed(
  requestOrigin: string | undefined,
  allowedOrigins: string[],
): boolean {
  // No origin (server-to-server, same-origin, or curl) — always allow
  if (!requestOrigin) {
    return true;
  }

  // Wildcard — allow all
  if (allowedOrigins.includes("*")) {
    return true;
  }

  // Normalize request origin the same way (strip trailing slash)
  const normalizedRequest = requestOrigin.replace(/\/+$/, "");

  return allowedOrigins.includes(normalizedRequest);
}
