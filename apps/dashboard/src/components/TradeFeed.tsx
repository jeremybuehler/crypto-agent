"use client";
import type { Trade } from "../lib/api";
import ExplainButton from "./ExplainButton";

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function reason(t: { reasonCode: string | null }) {
  return (t.reasonCode ?? "—").replace(/_/g, " ");
}

interface Props {
  trades: Trade[];
  onExplain: (correlationId: string, label: string) => void;
}

export default function TradeFeed({ trades, onExplain }: Props) {
  return (
    <div className="border border-terminal-border bg-terminal-surface flex flex-col">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border px-4 py-2 flex items-center justify-between">
        <span>Trade Feed</span>
        <span className="text-terminal-dim">{trades.length} fills</span>
      </div>

      <div className="overflow-y-auto max-h-48 sm:max-h-56">
        {trades.length === 0 ? (
          <div className="px-4 py-6 text-terminal-dim text-xs text-center">
            AWAITING FILLS<span className="blink ml-1">▌</span>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-terminal-dim border-b border-terminal-border">
                <th className="text-left px-4 py-1 font-normal">TIME</th>
                <th className="text-left px-2 py-1 font-normal">SIDE</th>
                <th className="text-left px-2 py-1 font-normal">PRODUCT</th>
                <th className="text-right px-2 py-1 font-normal hidden sm:table-cell">NOTIONAL</th>
                <th className="text-right px-2 py-1 font-normal">PRICE</th>
                <th className="text-right px-2 py-1 font-normal hidden lg:table-cell">FEE</th>
                <th className="text-left px-4 py-1 font-normal hidden md:table-cell">WHY</th>
                <th className="text-right px-2 py-1 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.fillId} title={t.rationale ?? undefined} className="border-b border-terminal-border/50 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-1.5 text-terminal-dim whitespace-nowrap">
                    {new Date(t.filledAt).toLocaleTimeString("en-US", { hour12: false })}
                  </td>
                  <td className={`px-2 py-1.5 font-semibold ${t.side === "BUY" ? "text-terminal-green" : "text-terminal-red"}`}>
                    {t.side}
                  </td>
                  <td className="px-2 py-1.5 text-terminal-blue">{t.productId}</td>
                  <td className="px-2 py-1.5 text-right text-terminal-text hidden sm:table-cell">
                    ${fmt(t.quoteSizeUsd)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-terminal-text">
                    ${fmt(t.price, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-terminal-red hidden lg:table-cell">
                    ${fmt(t.feeUsd, 4)}
                  </td>
                  <td className="px-4 py-1.5 text-terminal-dim hidden md:table-cell whitespace-nowrap" title={t.rationale ?? undefined}>
                    {reason(t)}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {t.proposalId && <ExplainButton correlationId={t.proposalId} label="trade" onExplain={onExplain} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
