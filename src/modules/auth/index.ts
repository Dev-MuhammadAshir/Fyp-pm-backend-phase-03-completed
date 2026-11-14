/**
 * @file src/modules/auth/index.ts
 * @description Public surface for the authentication module.
 *
 * NON-NEGOTIABLE RULE:
 * External modules must import from this barrel file, never from internal paths.
 */

export * from "./auth.schemas.js";
export * from "./password.service.js";
export * from "./token.service.js";
export { authRepository } from "./auth.repository.js";
export { authService } from "./auth.service.js";
export { authController } from "./auth.controller.js";
