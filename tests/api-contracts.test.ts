import { describe, expect, it } from "vitest";
import {
  ApiError,
  ErrorCode,
  toErrorEnvelope,
  UnauthorizedError,
  ValidationError,
  httpStatusFor
} from "../apps/api/src/errors";
import {
  AdviceResponseSchema,
  ApprovalRequestSchema,
  ApprovalResponseSchema,
  AuditEventSchema,
  CancelOpenOrdersResponseSchema,
  CapabilitiesResponseSchema,
  ErrorEnvelopeSchema,
  InternalAuthSchema,
  LearningItemSchema,
  LivenessResponseSchema,
  MAX_TEXT_LEN,
  OperatorAuthSchema,
  ProfilePatchRequestSchema,
  ProposalSchema,
  ReadinessResponseSchema,
  RequestIdSchema
} from "../apps/api/src/contracts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const SHA256 = "a".repeat(64);
const ISO = "2026-06-27T12:00:00.000Z";

describe("error taxonomy", () => {
  it("maps a known ApiError to a stable envelope and status", () => {
    const err = new ValidationError("bad field", { field: "side" });
    const envelope = toErrorEnvelope(err, REQUEST_ID);
    expect(envelope.error.code).toBe(ErrorCode.ValidationFailed);
    expect(envelope.error.requestId).toBe(REQUEST_ID);
    expect(envelope.error.message).toBe("bad field");
    expect(httpStatusFor(err)).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("sanitizes unknown errors into a generic internal envelope with no leakage", () => {
    const leaky = new Error("connection postgres://user:pw@host failed at /src/db.ts:42");
    const envelope = toErrorEnvelope(leaky, REQUEST_ID);
    expect(envelope.error.code).toBe(ErrorCode.Internal);
    expect(envelope.error.message).not.toContain("postgres://");
    expect(envelope.error.message).not.toContain("/src/db.ts");
    expect(envelope.error).not.toHaveProperty("stack");
    expect(httpStatusFor(leaky)).toBe(500);
    expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("UnauthorizedError carries 401 and the stable code", () => {
    const err = new UnauthorizedError();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(ErrorCode.Unauthorized);
    expect(err.httpStatus).toBe(401);
  });
});

describe("error envelope schema", () => {
  it("rejects unknown keys", () => {
    const bad = { error: { code: ErrorCode.Internal, message: "x", requestId: REQUEST_ID, extra: 1 } };
    expect(ErrorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an unstable error code", () => {
    const bad = { error: { code: "WAT", message: "x", requestId: REQUEST_ID } };
    expect(ErrorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("auth header contracts", () => {
  it("operator schema extracts a bearer token", () => {
    const parsed = OperatorAuthSchema.parse({ authorization: "Bearer secret-token-value" });
    expect(parsed.token).toBe("secret-token-value");
  });
  it("operator schema rejects a missing or non-bearer authorization", () => {
    expect(OperatorAuthSchema.safeParse({}).success).toBe(false);
    expect(OperatorAuthSchema.safeParse({ authorization: "secret-token-value" }).success).toBe(false);
  });
  it("internal schema uses a distinct header so operator tokens cannot satisfy it", () => {
    expect(InternalAuthSchema.safeParse({ authorization: "Bearer x" }).success).toBe(false);
    const parsed = InternalAuthSchema.parse({ "x-internal-token": "y".repeat(32) });
    expect(parsed.token).toBe("y".repeat(32));
  });
  it("internal schema rejects a short token", () => {
    expect(InternalAuthSchema.safeParse({ "x-internal-token": "short" }).success).toBe(false);
  });
});

describe("request id contract", () => {
  it("accepts a uuid and rejects junk", () => {
    expect(RequestIdSchema.safeParse(REQUEST_ID).success).toBe(true);
    expect(RequestIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("capability discovery contract", () => {
  it("accepts a full capability document", () => {
    const ok = {
      mode: "paper",
      version: "0.1.0",
      jurisdiction: "US",
      features: { liveTrading: false, advice: true, education: true, learning: true, backtest: true },
      enabledProducts: ["BTC-USD", "ETH-USD"]
    };
    expect(CapabilitiesResponseSchema.safeParse(ok).success).toBe(true);
  });
  it("rejects an unknown trading mode", () => {
    const bad = {
      mode: "margin",
      version: "0.1.0",
      jurisdiction: "US",
      features: { liveTrading: false, advice: true, education: true, learning: true, backtest: true },
      enabledProducts: []
    };
    expect(CapabilitiesResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("health contracts", () => {
  it("liveness is shallow", () => {
    expect(LivenessResponseSchema.safeParse({ status: "ok" }).success).toBe(true);
  });
  it("readiness reports dependency components and no secret fields", () => {
    const ok = {
      status: "ok",
      components: {
        database: { status: "ok", latencyMs: 3 },
        redis: { status: "ok", latencyMs: 1 },
        coinbase: { status: "degraded" },
        worker: { status: "ok", latencyMs: 0 }
      },
      checkedAt: ISO
    };
    expect(ReadinessResponseSchema.safeParse(ok).success).toBe(true);
    const leaky = { ...ok, databaseUrl: "postgres://secret" };
    expect(ReadinessResponseSchema.safeParse(leaky).success).toBe(false);
  });
});

describe("profile and learning contracts", () => {
  const validItem = {
    id: REQUEST_ID,
    scope: "explicit",
    key: "risk_tolerance",
    value: "conservative",
    confidence: 1,
    provenance: { source: "operator", observedAt: ISO, version: 1 },
    retentionUntil: null,
    status: "active"
  };
  it("accepts a fully-attributed learning item", () => {
    expect(LearningItemSchema.safeParse(validItem).success).toBe(true);
  });
  it("requires provenance, confidence, scope, and retention", () => {
    for (const field of ["provenance", "confidence", "scope", "retentionUntil"]) {
      const { [field]: _omitted, ...rest } = validItem as Record<string, unknown>;
      expect(LearningItemSchema.safeParse(rest).success).toBe(false);
    }
  });
  it("rejects secret-like extra keys", () => {
    expect(LearningItemSchema.safeParse({ ...validItem, privateKey: "x" }).success).toBe(false);
  });
  it("profile patch only accepts key and value", () => {
    expect(ProfilePatchRequestSchema.safeParse({ key: "goal", value: "retire" }).success).toBe(true);
    expect(ProfilePatchRequestSchema.safeParse({ key: "goal", value: "x", version: 2 }).success).toBe(false);
  });
});

describe("advice contract", () => {
  const base = {
    id: REQUEST_ID,
    profileVersion: 3,
    jurisdiction: "US",
    summary: "Consider dollar-cost averaging.",
    assumptions: ["long horizon"],
    alternatives: ["lump sum"],
    disclaimers: ["Not financial advice. You may lose money."],
    sources: [{ source: "sec.gov", observedAt: ISO, version: 1 }],
    createdAt: ISO
  };
  it("accepts sourced advice with disclaimers", () => {
    expect(AdviceResponseSchema.safeParse(base).success).toBe(true);
  });
  it("rejects advice with no disclaimers", () => {
    expect(AdviceResponseSchema.safeParse({ ...base, disclaimers: [] }).success).toBe(false);
  });
});

describe("proposal, approval, cancellation contracts", () => {
  const proposal = {
    id: REQUEST_ID,
    status: "pending",
    preview: {
      productId: "BTC-USD",
      side: "BUY",
      quoteSizeUsd: 25,
      baseSize: 0.0004,
      limitPrice: null,
      estimatedFeeUsd: 0.15,
      estimatedSlippageBps: 2
    },
    digest: SHA256,
    createdAt: ISO,
    expiresAt: ISO
  };
  it("accepts an exact proposal with a sha256 digest", () => {
    expect(ProposalSchema.safeParse(proposal).success).toBe(true);
  });
  it("rejects a proposal whose digest is not a sha256 hex", () => {
    expect(ProposalSchema.safeParse({ ...proposal, digest: "deadbeef" }).success).toBe(false);
  });
  it("approval requires the exact digest", () => {
    expect(ApprovalRequestSchema.safeParse({ digest: SHA256 }).success).toBe(true);
    expect(ApprovalRequestSchema.safeParse({}).success).toBe(false);
  });
  it("approval response is well-formed", () => {
    const ok = { proposalId: REQUEST_ID, status: "approved", decidedAt: ISO };
    expect(ApprovalResponseSchema.safeParse(ok).success).toBe(true);
  });
  it("cancellation response reports requested, cancelled, and failed", () => {
    const ok = { requested: 2, cancelled: ["o1"], failed: [{ orderId: "o2", code: ErrorCode.DependencyUnavailable }] };
    expect(CancelOpenOrdersResponseSchema.safeParse(ok).success).toBe(true);
  });
});

describe("audit contract", () => {
  it("accepts an audit event with correlation linkage", () => {
    const ok = {
      id: REQUEST_ID,
      type: "proposal.approved",
      actor: "operator",
      correlationId: REQUEST_ID,
      occurredAt: ISO,
      summary: "operator approved proposal"
    };
    expect(AuditEventSchema.safeParse(ok).success).toBe(true);
  });
});

describe("size limits", () => {
  it("rejects oversized free-text fields", () => {
    const tooLong = "x".repeat(MAX_TEXT_LEN + 1);
    const bad = {
      error: { code: ErrorCode.Internal, message: tooLong, requestId: REQUEST_ID }
    };
    expect(ErrorEnvelopeSchema.safeParse(bad).success).toBe(false);
  });
});
