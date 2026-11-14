/**
 * @file src/modules/users/index.ts
 * @description Public surface for the users module.
 *
 * NON-NEGOTIABLE RULE:
 * External modules must import from this barrel file, never from internal paths.
 */

export * from "./users.schemas.js";
export { usersRepository } from "./users.repository.js";
export { usersService } from "./users.service.js";
export { usersController } from "./users.controller.js";
export { usersRouter } from "./users.routes.js";
