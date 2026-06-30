/**
 * Interactive proposal review. The worker creates a proposal (internal auth);
 * the operator lists, inspects, approves, or rejects it (operator auth).
 *
 * Approval is non-transferable: the operator must echo the exact digest of the
 * preview they are approving, and the decision is one-time and transactional in
 * the repository. The API computes the digest server-side from the worker's
 * preview so a tampered digest can never widen what gets approved.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { computeProposalDigest, type ProposalStatus, type StoredProposal } from "@agent/execution";
import type {
  CreateProposalInput,
  DecideProposalInput,
  DecisionResult,
  AuditEventInput
} from "@agent/persistence";
import {
  ApprovalRequestSchema,
  ApprovalResponseSchema,
  InternalProposalSchema,
  InternalProposalResponseSchema,
  ProposalListResponseSchema,
  ProposalSchema,
  RejectionRequestSchema
} from "../contracts.js";
import { ApprovalInvalidError, NotFoundError, ValidationError } from "../errors.js";

export interface ProposalRouteDeps {
  repo: {
    createProposal(input: CreateProposalInput): Promise<void>;
    getProposal(id: string): Promise<StoredProposal | null>;
    listProposals(limit: number, statuses?: ProposalStatus[]): Promise<StoredProposal[]>;
    decideProposal(input: DecideProposalInput): Promise<DecisionResult>;
    recordAuditEvent(event: AuditEventInput): Promise<void>;
  };
  requireOperator: preHandlerHookHandler;
  requireInternal: preHandlerHookHandler;
  now?: () => Date;
}

function toProposalResponse(proposal: StoredProposal) {
  return ProposalSchema.parse({
    id: proposal.id,
    status: proposal.status,
    preview: proposal.preview,
    digest: proposal.digest,
    createdAt: proposal.createdAt.toISOString(),
    expiresAt: proposal.expiresAt.toISOString()
  });
}

/** Map a one-time decision rejection to the stable error taxonomy. */
function decisionError(reason: Exclude<DecisionResult & { ok: false }, { ok: true }>["reason"]): Error {
  if (reason === "not_found") return new NotFoundError("Proposal not found.");
  return new ApprovalInvalidError();
}

export function registerProposalRoutes(app: FastifyInstance, deps: ProposalRouteDeps): void {
  const now = () => (deps.now ?? (() => new Date()))();

  app.post("/internal/proposal", { preHandler: deps.requireInternal }, async (request) => {
    const parsed = InternalProposalSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Proposal failed validation.");
    const body = parsed.data;

    const id = randomUUID();
    const digest = computeProposalDigest(body.preview);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + body.ttlSeconds * 1000);

    await deps.repo.createProposal({
      id,
      tradeIntentId: body.tradeIntentId ?? null,
      preview: body.preview,
      digest,
      correlationId: body.correlationId,
      createdAt,
      expiresAt
    });
    await deps.repo.recordAuditEvent({
      id: randomUUID(),
      type: "proposal.created",
      actor: "worker",
      correlationId: body.correlationId,
      occurredAt: createdAt,
      summary: `proposal for ${body.preview.side} ${body.preview.productId} ($${body.preview.quoteSizeUsd})`
    });

    return InternalProposalResponseSchema.parse({ id, digest, status: "pending", expiresAt: expiresAt.toISOString() });
  });

  app.get("/proposals", { preHandler: deps.requireOperator }, async () => {
    const proposals = await deps.repo.listProposals(50, ["pending"]);
    return ProposalListResponseSchema.parse({ proposals: proposals.map(toProposalResponse) });
  });

  app.get("/proposals/:id", { preHandler: deps.requireOperator }, async (request) => {
    const { id } = request.params as { id: string };
    const proposal = await deps.repo.getProposal(id);
    if (!proposal) throw new NotFoundError("Proposal not found.");
    return toProposalResponse(proposal);
  });

  app.post("/proposals/:id/approve", { preHandler: deps.requireOperator }, async (request) => {
    const { id } = request.params as { id: string };
    const parsed = ApprovalRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Approval failed validation.");

    const result = await deps.repo.decideProposal({
      proposalId: id,
      decision: "approved",
      digest: parsed.data.digest,
      correlationId: request.id,
      now: now()
    });
    if (!result.ok) throw decisionError(result.reason);

    await deps.repo.recordAuditEvent({
      id: randomUUID(),
      type: "proposal.approved",
      actor: "operator",
      correlationId: request.id,
      occurredAt: result.decidedAt,
      summary: `operator approved proposal ${id}`
    });
    return ApprovalResponseSchema.parse({ proposalId: id, status: result.status, decidedAt: result.decidedAt.toISOString() });
  });

  app.post("/proposals/:id/reject", { preHandler: deps.requireOperator }, async (request) => {
    const { id } = request.params as { id: string };
    const parsed = RejectionRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new ValidationError("Rejection failed validation.");

    const result = await deps.repo.decideProposal({
      proposalId: id,
      decision: "rejected",
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
      correlationId: request.id,
      now: now()
    });
    if (!result.ok) throw decisionError(result.reason);

    await deps.repo.recordAuditEvent({
      id: randomUUID(),
      type: "proposal.rejected",
      actor: "operator",
      correlationId: request.id,
      occurredAt: result.decidedAt,
      summary: `operator rejected proposal ${id}`
    });
    return ApprovalResponseSchema.parse({ proposalId: id, status: result.status, decidedAt: result.decidedAt.toISOString() });
  });
}
