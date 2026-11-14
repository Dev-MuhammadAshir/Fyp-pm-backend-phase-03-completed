/**
 * @file src/routes/v1.ts
 * @description API v1 router composition layer.
 *
 * ARCHITECTURAL NOTE (Phase 3 Chunk 3E.1-R2):
 * The authRouter import comes from auth.routes.js directly, NOT from
 * modules/auth/index.js. Reason: the auth barrel previously re-exported
 * authRouter, which created a circular evaluation cycle
 * (authenticate.js → auth/index.js → auth.routes.js → authenticate.js).
 * Breaking the auth barrel's re-export of authRouter fixes the root
 * cause without touching authenticate.ts (which stays frozen per Rule #12).
 *
 * users/teams/projects barrel exports of their routers were NOT changed
 * in this chunk — their routers did not contribute to this specific cycle
 * (they only fail transitively because they import authenticate.js,
 * which now evaluates cleanly without triggering auth.routes.js).
 * Phase 13 cleanup candidate: uniformly remove router re-exports from
 * ALL module barrels for consistency.
 *
 * Routing composition (this file) is the ONLY layer that consumes routers.
 * This is the sole intentional exception to Rule #12 (cross-module imports
 * must go through index.ts). All other consumers import from barrels.
 */

import { Router } from "express";
import { healthRouter } from "./health.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { usersRouter } from "../modules/users/index.js";
import { teamsRouter } from "../modules/teams/index.js";
import { projectsRouter } from "../modules/projects/index.js";

export const v1Router = Router();

// Mount health checks
v1Router.use(healthRouter);

// Authentication & session routes
v1Router.use("/auth", authRouter);

// User administration & directory routes
v1Router.use("/users", usersRouter);

// Teams routes
v1Router.use("/teams", teamsRouter);

// Projects routes
v1Router.use("/projects", projectsRouter);

// Module routers will be mounted here in subsequent phases:
// Phase 2: /auth, /users
// Phase 3: /teams
// Phase 4: /projects
// Phase 5: /tasks
// Phase 6: /kanban, /dependencies
// Phase 7: /comments
// Phase 8: /notifications
// Phase 9: /attachments
// Phase 10: /analytics
// Phase 11: /audit
// Phase 12: /risks
