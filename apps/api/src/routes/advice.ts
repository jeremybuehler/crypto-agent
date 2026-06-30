/**
 * Sourced personalized advice (operator auth). This route is deliberately
 * constructed with NO execution capability: it depends only on the read-side of
 * the repository (profile facts) and the AdviceService, which emits data. There
 * is no path from here to an order, a proposal approval, or the ops state — so
 * advice provably cannot transact (PRD: advice has no execution authority).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { AdviceService, AdviceUnavailableError, UnsafeAdviceError } from "@agent/ai";
import type { LearnedMemory, SaveAdviceInput } from "@agent/persistence";
import { AdviceRequestSchema, AdviceResponseSchema } from "../contracts.js";
import { ConflictError, ValidationError } from "../errors.js";

export interface AdviceRouteDeps {
  repo: {
    getProfile(): Promise<{ version: number; facts: LearnedMemory[]; pendingInsights: LearnedMemory[] }>;
    saveAdvice(input: SaveAdviceInput): Promise<void>;
  };
  requireOperator: preHandlerHookHandler;
  now?: () => Date;
  service?: AdviceService;
}

export function registerAdviceRoutes(app: FastifyInstance, deps: AdviceRouteDeps): void {
  const service = deps.service ?? new AdviceService();
  const now = () => (deps.now ?? (() => new Date()))();

  app.post("/advice", { preHandler: deps.requireOperator }, async (request) => {
    const parsed = AdviceRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError("Advice request failed validation.");

    const profile = await deps.repo.getProfile();
    let result;
    try {
      result = service.generate({
        question: parsed.data.question,
        jurisdiction: "US",
        profile: {
          version: profile.version,
          facts: profile.facts.map((f) => ({ key: f.key, value: f.value, source: f.source, observedAt: f.observedAt, version: f.version }))
        }
      });
    } catch (error) {
      if (error instanceof AdviceUnavailableError) throw new ConflictError(error.message);
      if (error instanceof UnsafeAdviceError) throw new ValidationError(error.message);
      throw error;
    }

    const id = randomUUID();
    const createdAt = now();
    const response = AdviceResponseSchema.parse({
      id,
      profileVersion: result.profileVersion,
      jurisdiction: "US",
      summary: result.summary,
      assumptions: result.assumptions,
      alternatives: result.alternatives,
      disclaimers: result.disclaimers,
      sources: result.sources.map((s) => ({ source: s.source, observedAt: s.observedAt.toISOString(), version: s.version })),
      createdAt: createdAt.toISOString()
    });

    await deps.repo.saveAdvice({
      id,
      profileVersion: result.profileVersion,
      question: parsed.data.question,
      summary: result.summary,
      payload: response,
      correlationId: request.id,
      createdAt
    });

    return response;
  });
}
