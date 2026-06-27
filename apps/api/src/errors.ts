/**
 * Stable error taxonomy and sanitized diagnostics for the operator API.
 *
 * Two rules govern this module:
 *  1. Error codes are a closed, stable set. Clients and audits depend on them;
 *     never reuse a code for a different meaning.
 *  2. Diagnostics are sanitized at the boundary. Only `ApiError.publicMessage`
 *     ever reaches a client. Unknown errors collapse to a generic internal
 *     message so connection strings, stack traces, SQL, and provider payloads
 *     never leak (see docs/SECURITY.md "Logging and diagnostics").
 */

export const ErrorCode = {
  Unauthorized: "UNAUTHORIZED",
  Forbidden: "FORBIDDEN",
  ValidationFailed: "VALIDATION_FAILED",
  NotFound: "NOT_FOUND",
  Conflict: "CONFLICT",
  RateLimited: "RATE_LIMITED",
  PayloadTooLarge: "PAYLOAD_TOO_LARGE",
  DependencyUnavailable: "DEPENDENCY_UNAVAILABLE",
  KillSwitchActive: "KILL_SWITCH_ACTIVE",
  ApprovalInvalid: "APPROVAL_INVALID",
  Internal: "INTERNAL"
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** All stable codes, for building the response-envelope Zod enum. */
export const ERROR_CODES = Object.values(ErrorCode) as [ErrorCode, ...ErrorCode[]];

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/**
 * Base class for every error that is safe to surface to a client. The
 * `publicMessage` is intentionally distinct from the JS `message`: subclasses
 * may carry richer internal context in `message`/`cause` for server logs while
 * exposing only `publicMessage` over the wire.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, httpStatus: number, publicMessage: string, details?: unknown) {
    super(publicMessage);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.publicMessage = publicMessage;
    if (details !== undefined) this.details = details;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(publicMessage = "Authentication required.") {
    super(ErrorCode.Unauthorized, 401, publicMessage);
  }
}

export class ForbiddenError extends ApiError {
  constructor(publicMessage = "Not permitted.") {
    super(ErrorCode.Forbidden, 403, publicMessage);
  }
}

export class ValidationError extends ApiError {
  constructor(publicMessage = "Request failed validation.", details?: unknown) {
    super(ErrorCode.ValidationFailed, 400, publicMessage, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(publicMessage = "Not found.") {
    super(ErrorCode.NotFound, 404, publicMessage);
  }
}

export class ConflictError extends ApiError {
  constructor(publicMessage = "Conflicting state.") {
    super(ErrorCode.Conflict, 409, publicMessage);
  }
}

export class RateLimitedError extends ApiError {
  constructor(publicMessage = "Too many requests.") {
    super(ErrorCode.RateLimited, 429, publicMessage);
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(publicMessage = "Payload too large.") {
    super(ErrorCode.PayloadTooLarge, 413, publicMessage);
  }
}

export class DependencyUnavailableError extends ApiError {
  constructor(publicMessage = "A dependency is unavailable.") {
    super(ErrorCode.DependencyUnavailable, 503, publicMessage);
  }
}

export class KillSwitchActiveError extends ApiError {
  constructor(publicMessage = "Kill switch is active.") {
    super(ErrorCode.KillSwitchActive, 409, publicMessage);
  }
}

export class ApprovalInvalidError extends ApiError {
  constructor(publicMessage = "Approval is missing, expired, reused, or does not match the preview.") {
    super(ErrorCode.ApprovalInvalid, 409, publicMessage);
  }
}

export class InternalError extends ApiError {
  constructor(publicMessage = "Internal server error.") {
    super(ErrorCode.Internal, 500, publicMessage);
  }
}

/** HTTP status for any error, defaulting unknown throwables to 500. */
export function httpStatusFor(error: unknown): number {
  return error instanceof ApiError ? error.httpStatus : 500;
}

/**
 * Convert any thrown value into a client-safe envelope. Known `ApiError`s pass
 * through their stable code, public message, and optional structured details.
 * Everything else collapses to a generic internal error with no leaked cause.
 */
export function toErrorEnvelope(error: unknown, requestId: string): ErrorEnvelope {
  if (error instanceof ApiError) {
    return {
      error: {
        code: error.code,
        message: error.publicMessage,
        requestId,
        ...(error.details !== undefined ? { details: error.details } : {})
      }
    };
  }
  return {
    error: {
      code: ErrorCode.Internal,
      message: "Internal server error.",
      requestId
    }
  };
}
