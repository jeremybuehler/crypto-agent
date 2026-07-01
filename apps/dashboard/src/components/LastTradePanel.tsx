"use client";
import type { Trade } from "../lib/api";

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface Props { trade: Trade | undefined; }

export default function LastTradePanel({ trade }: Props) {
  if (!trade) {
    return (
      <div className="border border-terminal-border bg-terminal-surface p-4 flex flex-col gap-3">
        <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border pb-2">
          Last Trade
        </div>
        <div className="text-terminal-dim text-xs flex items-center justify-center h-16">
          NO FILLS YET<span className="blink ml-1">▌</span>
        </div>
      </div>
    );
  }

  const isBuy = trade.side === "BUY";
  const sideColor = isBuy ? "text-terminal-green" : "text-terminal-red";
  const sideBg = isBuy ? "border-terminal-green text-terminal-green" : "border-terminal-red text-terminal-red";

  return (
    <div className="border border-terminal-border bg-terminal-surface p-4 flex flex-col gap-3">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border pb-2">
        Last Trade
      </div>

      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 border text-xs font-bold tracking-wider ${sideBg}`}>
          {trade.side}
        </span>
        <span className="text-terminal-blue font-semibold">{trade.productId}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-terminal-dim">NOTIONAL</span>
        <span className={`text-right font-semibold ${sideColor}`}>${fmt(trade.quoteSizeUsd)}</span>

        <span className="text-terminal-dim">PRICE</span>
        <span className="text-right text-terminal-text">${fmt(trade.price, 4)}</span>

        <span className="text-terminal-dim">BASE SIZE</span>
        <span className="text-right text-terminal-text">{fmt(trade.baseSize, 8)}</span>

        <span className="text-terminal-dim">FEE</span>
        <span className="text-right text-terminal-red">${fmt(trade.feeUsd, 4)}</span>

        <span className="text-terminal-dim">TIME</span>
        <span className="text-right text-terminal-dim">
          {new Date(trade.filledAt).toLocaleTimeString("en-US", { hour12: false })}
        </span>
      </div>

      <div className="border-t border-terminal-border pt-2 flex flex-col gap-1">
        <span className="text-terminal-dim text-xs tracking-widest uppercase">Rationale</span>
        <span className="text-terminal-text text-xs">
          {(trade.reasonCode ?? "unknown").replace(/_/g, " ")}
        </span>
        {trade.rationale && <span className="text-terminal-dim text-xs leading-snug">{trade.rationale}</span>}
      </div>
    </div>
  );
}
