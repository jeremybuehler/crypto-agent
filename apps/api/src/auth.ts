/**
 * Authentication preHandlers for the operator API.
 *
 * Two distinct principals, two structurally distinct credentials:
 *  - The operator authenticates with `Authorization: Bearer <OPERATOR_API_TOKEN>`.
 *  - The worker authenticates with the dedicated `x-internal-token` header.
 *
 * Because the headers differ, an operator token can never satisfy an internal
 * route and vice versa. Comparison is constant-time. If the expected token is
 * not configured, every request fails closed.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { InternalAuthSchema, OperatorAuthSchema } from "./contracts.js";
import { UnauthorizedError } from "./errors.js";

function constantTimeEquals(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

export function requireOperator(expectedToken: string | undefined) {
  return async function authenticateOperator(request: FastifyRequest): Promise<void> {
    if (!expectedToken) throw new UnauthorizedError();
    const parsed = OperatorAuthSchema.safeParse(request.headers);
    if (!parsed.success || !constantTimeEquals(parsed.data.token, expectedToken)) {
      throw new UnauthorizedError();
    }
  };
}

export function requireInternal(expectedToken: string | undefined) {
  return async function authenticateInternal(request: FastifyRequest): Promise<void> {
    if (!expectedToken) throw new UnauthorizedError();
    const parsed = InternalAuthSchema.safeParse(request.headers);
    if (!parsed.success || !constantTimeEquals(parsed.data.token, expectedToken)) {
      throw new UnauthorizedError();
    }
  };
}
