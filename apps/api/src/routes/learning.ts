/**
 * Inspectable learning memory. The operator views, sets, corrects, rejects,
 * deletes, and exports learned facts (operator auth); the worker submits derived
 * observations as reviewable pending insights (internal auth). Secrets are
 * rejected at the repository boundary, so they never enter the store.
 */
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { SecretRejectedError, type CorrectResult, type LearnedMemory, type MemoryStatus, type UpsertMemoryInput } from "@agent/persistence";
import {
  InternalObservationSchema,
  ProfileCorrectRequestSchema,
  ProfilePatchRequestSchema,
  ProfileResponseSchema
} from "../contracts.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors.js";

export interface LearningRouteDeps {
  repo: {
    upsertMemory(input: UpsertMemoryInput): Promise<LearnedMemory>;
    getProfile(): Promise<{ version: number; facts: LearnedMemory[]; pendingInsights: LearnedMemory[] }>;
    correctMemory(input: { id: string; value: string; expectedVersion: number; actor: "operator" }): Promise<CorrectResult>;
    setMemoryStatus(id: string, status: MemoryStatus, actor: "operator"): Promise<boolean>;
    exportMemories(): Promise<LearnedMemory[]>;
  };
  requireOperator: preHandlerHookHandler;
  requireInternal: preHandlerHookHandler;
  now?: () => Date;
}

function toLearningItem(m: LearnedMemory) {
  return {
    id: m.id,
    scope: m.scope,
    key: m.key,
    value: m.value,
    confidence: m.confidence,
    provenance: { source: m.source, observedAt: m.observedAt.toISOString(), version: m.version },
    retentionUntil: m.retentionUntil ? m.retentionUntil.toISOString() : null,
    status: m.status
  };
}

export function registerLearningRoutes(app: FastifyInstance, deps: LearningRouteDeps): void {
  const now = () => (deps.now ?? (() => new Date()))();

  // A rejected secret is a client error (bad input), not a server fault.
  async function upsert(input: UpsertMemoryInput): Promise<LearnedMemory> {
    try {
      return await deps.repo.upsertMemory(input);
    } catch (error) {
      if (error instanceof SecretRejectedError) throw new ValidationError("Refusing to store a secret-like value.");
      throw error;
    }
  }

  app.get("/profile", { preHandler: deps.requireOperator }, async () => {
    const profile = await deps.repo.getProfile();
    return ProfileResponseSchema.parse({
      version: profile.version,
      facts: profile.facts.map(toLearningItem),
      pendingInsights: profile.pendingInsights.map(toLearningItem)
    });
  });

  app.post("/profile", { preHandler: deps.requireOperator }, async (request) => {
    const parsed = ProfilePatchRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Profile patch failed validation.");
    const memory = await upsert({
      key: parsed.data.key,
      value: parsed.data.value,
      scope: "explicit",
      confidence: 1,
      source: "operator",
      observedAt: now(),
      status: "active",
      actor: "operator"
    });
    return toLearningItem(memory);
  });

  app.post("/profile/:id/correct", { preHandler: deps.requireOperator }, async (request) => {
    const { id } = request.params as { id: string };
    const parsed = ProfileCorrectRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Correction failed validation.");
    const result = await deps.repo.correctMemory({ id, value: parsed.data.value, expectedVersion: parsed.data.expectedVersion, actor: "operator" });
    if (!result.ok) {
      if (result.reason === "not_found") throw new NotFoundError("Memory not found.");
      throw new ConflictError("Memory was modified concurrently; refetch and retry.");
    }
    return { id, version: result.version };
  });

  app.post("/profile/:id/reject", { preHandler: deps.requireOperator }, async (request) => {
    const { id } = request.params as { id: string };
    if (!(await deps.repo.setMemoryStatus(id, "rejected", "operator"))) throw new NotFoundError("Memory not found.");
    return { id, status: "rejected" as const };
  });

  app.delete("/profile/:id", { preHandler: deps.requireOperator }, async (request) => {
    const { id } = request.params as { id: string };
    if (!(await deps.repo.setMemoryStatus(id, "deleted", "operator"))) throw new NotFoundError("Memory not found.");
    return { id, status: "deleted" as const };
  });

  app.get("/profile/export", { preHandler: deps.requireOperator }, async () => {
    const memories = await deps.repo.exportMemories();
    return { memories: memories.map(toLearningItem) };
  });

  app.post("/internal/observe", { preHandler: deps.requireInternal }, async (request) => {
    const parsed = InternalObservationSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Observation failed validation.");
    // Derived inferences are never auto-trusted: they land as pending insights
    // for operator review (CLAUDE.md rule 10).
    const memory = await upsert({
      key: parsed.data.key,
      value: parsed.data.value,
      scope: "derived",
      confidence: parsed.data.confidence,
      source: parsed.data.source,
      observedAt: now(),
      status: "pending",
      actor: "worker"
    });
    return { id: memory.id, status: memory.status };
  });
}
