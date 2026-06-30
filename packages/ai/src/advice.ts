/**
 * U.S.-first personalized advice that CANNOT execute. The advice service emits
 * a structured, sourced, disclaimer-bearing data object and has no reference to
 * any order, execution, or ops capability — the type system and dependency graph
 * make "advice places a trade" unrepresentable (PRD: advice has no execution
 * authority).
 *
 * The default provider is deterministic and conservative, so advice is available
 * (and testable) without an LLM. Because the question is never executed, prompt
 * injection cannot change the jurisdiction, disclaimers, or safety posture.
 */

export interface ConfirmedProfileFact {
  key: string;
  value: string;
  source: string;
  observedAt: Date;
  version: number;
}

export interface ConfirmedProfile {
  version: number;
  facts: ConfirmedProfileFact[];
}

export interface AdviceRequest {
  question: string;
  profile: ConfirmedProfile;
  jurisdiction: string;
}

export interface AdviceResult {
  jurisdiction: "US";
  profileVersion: number;
  summary: string;
  assumptions: string[];
  alternatives: string[];
  disclaimers: string[];
  sources: Array<{ source: string; observedAt: Date; version: number }>;
}

export class AdviceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdviceUnavailableError";
  }
}

export class UnsafeAdviceError extends Error {
  constructor(message = "This request asks for guidance we will not provide.") {
    super(message);
    this.name = "UnsafeAdviceError";
  }
}

const REQUIRED_DISCLAIMERS = [
  "Not financial, tax, or legal advice; consult a licensed professional.",
  "Crypto is volatile; you can lose your entire principal.",
  "Past performance does not predict future results."
];

// Requests we refuse outright: guaranteed-return claims, all-in/leverage urging,
// or attempts to make advice act (place/execute an order).
const UNSAFE_PATTERNS = [
  /guarantee|guaranteed|risk[\s-]?free|can'?t lose|sure thing/i,
  /\b(all[\s-]?in|max leverage|10x|100x|yolo)\b/i,
  /\b(place|execute|submit|buy now|sell now|send)\b.*\border\b/i,
  /\bexecute\b|\bplace a trade\b/i
];

export interface AdviceProvider {
  draft(request: AdviceRequest): { summary: string; assumptions: string[]; alternatives: string[] };
}

/** Deterministic, conservative advice — no LLM required. */
export class ConservativeAdviceProvider implements AdviceProvider {
  draft(request: AdviceRequest) {
    const risk = request.profile.facts.find((f) => /risk[_\s-]?tolerance/i.test(f.key))?.value ?? "unspecified";
    const horizon = request.profile.facts.find((f) => /horizon|time[_\s-]?frame/i.test(f.key))?.value ?? "unspecified";
    return {
      summary:
        `Based on a ${risk} risk tolerance and a ${horizon} horizon, a conservative, ` +
        `diversified, dollar-cost-averaged approach within your stated limits is generally more durable ` +
        `than concentrated timing bets. This is educational context, not a recommendation to transact.`,
      assumptions: [
        `Risk tolerance treated as "${risk}".`,
        `Time horizon treated as "${horizon}".`,
        "You will not exceed the position and loss limits configured in the system."
      ],
      alternatives: [
        "Hold and reassess after reviewing your written plan.",
        "Reduce position size to stay well within exposure limits.",
        "Consult a licensed fiduciary before acting."
      ]
    };
  }
}

export class AdviceService {
  constructor(private readonly provider: AdviceProvider = new ConservativeAdviceProvider()) {}

  generate(request: AdviceRequest): AdviceResult {
    if (request.jurisdiction !== "US") {
      throw new AdviceUnavailableError("Advice is only available for the US jurisdiction.");
    }
    if (request.profile.facts.length === 0) {
      throw new AdviceUnavailableError("A confirmed profile is required before advice can be given.");
    }
    if (UNSAFE_PATTERNS.some((re) => re.test(request.question))) {
      throw new UnsafeAdviceError();
    }

    const draft = this.provider.draft(request);
    return {
      jurisdiction: "US",
      profileVersion: request.profile.version,
      summary: draft.summary,
      assumptions: draft.assumptions,
      alternatives: draft.alternatives,
      disclaimers: REQUIRED_DISCLAIMERS,
      sources: request.profile.facts.map((f) => ({ source: f.source, observedAt: f.observedAt, version: f.version }))
    };
  }
}
