/**
 * @file src/types/express.d.ts
 * @description Global Express Request augmentation for authenticated user context.
 */

import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        globalRole: "Administrator" | "Project Manager" | "Team Member" | "Viewer";
        jti: string;
        isActive: true;
      };
    }
  }
}

export {};
