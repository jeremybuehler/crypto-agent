/**
 * Boundary hardening for the operator API: explicit CORS, baseline security
 * headers, a lightweight in-memory rate limiter, correlation-id propagation,
 * and a sanitized error/not-found handler that emits only stable envelopes.
 *
 * Every error leaving this process goes through `toErrorEnvelope`, so raw
 * causes (connection strings, stack traces, dependency payloads) never reach a
 * client (docs/SECURITY.md "Logging and diagnostics").
 */
import cors from "@fastify/cors";
import type { AgentConfig } from "@agent/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  ApiError,
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  ValidationError,
  httpStatusFor,
  toErrorEnvelope
} from "../errors.js";

const LIVENESS_PATH = "/health";

export async function registerSecurity(app: FastifyInstance, config: AgentConfig): Promise<void> {
  const { allowedOrigins, rateLimitMax, rateLimitWindowMs } = config.security;

  await app.register(cors, {
    origin(origin, cb) {
      // No Origin header (same-origin requests, curl, server-to-server): allow.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.includes(origin));
    }
  });

  // Fixed-window per-client rate limiting. Single-operator scale; an in-memory
  // counter is sufficient and avoids a new dependency. Liveness is exempt.
  const windows = new Map<string, { count: number; resetAt: number }>();
  app.addHook("onRequest", async (request: FastifyRequest) => {
    if (request.url.split("?")[0] === LIVENESS_PATH) return;
    const now = Date.now();
    const key = request.ip;
    const entry = windows.get(key);
    if (!entry || now >= entry.resetAt) {
      windows.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > rateLimitMax) throw new RateLimitedError();
  });

  app.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    reply.header("x-request-id", request.id);
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-resource-policy", "same-origin");
    return payload;
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const error = new NotFoundError();
    reply.code(error.httpStatus).send(toErrorEnvelope(error, request.id));
  });

  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const normalized = normalizeError(error);
    if (!(normalized instanceof ApiError)) {
      // Unknown failure: log the full cause server-side (pino redacts secrets),
      // return a generic envelope.
      request.log.error({ err: error }, "unhandled API error");
    }
    reply.code(httpStatusFor(normalized)).send(toErrorEnvelope(normalized, request.id));
  });
}

function normalizeError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return new ValidationError("Request failed validation.");
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 413) return new PayloadTooLargeError();
    if (statusCode === 400) return new ValidationError("Malformed request.");
  }
  return error;
}
