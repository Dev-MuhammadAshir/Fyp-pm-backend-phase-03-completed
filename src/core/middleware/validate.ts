import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { ValidationError } from "../errors/AppError.js";

interface ValidationTargets {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

export function validate(schemas: ValidationTargets) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = (await schemas.query.parseAsync(
          req.query,
        )) as typeof req.query;
      }
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(
          req.params,
        )) as typeof req.params;
      }
      next();
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        const formattedErrors = err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
          rule: issue.code,
        }));
        next(new ValidationError("Request validation failed", formattedErrors));
      } else {
        next(err);
      }
    }
  };
}
