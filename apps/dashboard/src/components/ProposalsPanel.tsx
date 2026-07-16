"use client";
import { useState } from "react";
import { postJson, type Proposal } from "../lib/api";
import ExplainButton from "./ExplainButton";

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface Props {
  proposals: Proposal[];
  onDecision: () => void;
  onExplain: (correlationId: string, label: string) => void;
}

export default function ProposalsPanel({ proposals, onDecision, onExplain }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(p: Proposal, action: "approve" | "reject") {
    setBusy(p.id);
    try {
      await postJson(`/proposals/${p.id}/${action}`, action === "approve" ? { digest: p.digest } : {});
      onDecision();
    } catch {
      // Surfaced by the row staying; a real build would toast the error.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-4 py-2 flex items-center justify-between">
        <span>Pending Approvals</span>
        <span className="text-terminal-dim">{proposals.length}</span>
      </div>

      {proposals.length === 0 ? (
        <div className="px-4 py-6 text-terminal-dim text-xs text-center">
          NO PROPOSALS AWAITING APPROVAL<span className="blink ml-1">▌</span>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-terminal-border/50">
          {proposals.map((p) => (
            <div key={p.id} className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 border text-xs font-bold tracking-wider ${
                      p.preview.side === "BUY"
                        ? "border-terminal-green text-terminal-green"
                        : "border-terminal-red text-terminal-red"
                    }`}
                  >
                    {p.preview.side}
                  </span>
                  <span className="text-terminal-blue font-semibold">{p.preview.productId}</span>
                  <span className="text-terminal-text">${fmt(p.preview.quoteSizeUsd)}</span>
                </div>
                <div className="text-terminal-dim">
                  base {fmt(p.preview.baseSize, 8)} · est fee ${fmt(p.preview.estimatedFeeUsd, 4)} · expires{" "}
                  {new Date(p.expiresAt).toLocaleTimeString("en-US", { hour12: false })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ExplainButton correlationId={p.id} label="proposal" onExplain={onExplain} />
                <button
                  disabled={busy === p.id}
                  onClick={() => decide(p, "approve")}
                  className="px-3 py-1 border border-terminal-green text-terminal-green text-xs font-bold tracking-wider hover:bg-terminal-green/10 disabled:opacity-50"
                >
                  APPROVE
                </button>
                <button
                  disabled={busy === p.id}
                  onClick={() => decide(p, "reject")}
                  className="px-3 py-1 border border-terminal-red text-terminal-red text-xs font-bold tracking-wider hover:bg-terminal-red/10 disabled:opacity-50"
                >
                  REJECT
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
