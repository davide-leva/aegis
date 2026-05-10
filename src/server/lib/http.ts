import type { Response } from "express";
import { ZodError } from "zod";

export function sendValidationError(res: Response, error: unknown) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: "Validation error",
      details: error.flatten()
    });
  }

  return res.status(500).json({
    error: error instanceof Error ? error.message : "Internal server error"
  });
}
