"use client";
import type { Portfolio, Metrics } from "../lib/api";

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

interface Props { portfolio: Portfolio | undefined; metrics: Metrics | undefined; }

export default function PortfolioPanel({ portfolio, metrics }: Props) {
  const pnl = metrics?.realizedPnl ?? 0;
  const pnlColor = pnl > 0 ? "text-terminal-green" : pnl < 0 ? "text-terminal-red" : "text-terminal-text";

  return (
    <div className="border border-terminal-border bg-terminal-surface p-4 flex flex-col gap-3">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border pb-2">
        Portfolio
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <span className="text-terminal-dim">EQUITY</span>
        <span className="text-right text-terminal-text font-semibold">
          ${fmt(portfolio?.equityUsd ?? 1000)}
        </span>

        <span className="text-terminal-dim">CASH</span>
        <span className="text-right text-terminal-text">
          ${fmt(portfolio?.cashUsd ?? 1000)}
        </span>

        <span className="text-terminal-dim">EXPOSURE</span>
        <span className="text-right text-terminal-text">
          {fmt(portfolio?.totalExposurePct ?? 0, 1)}%
        </span>

        <span className="text-terminal-dim">DAILY P&amp;L</span>
        <span className={`text-right font-semibold ${pnlColor}`}>
          {pnl >= 0 ? "+" : ""}${fmt(pnl)}
        </span>

        <span className="text-terminal-dim">TRADES</span>
        <span className="text-right text-terminal-text">
          {metrics?.totalTrades ?? 0}
        </span>

        <span className="text-terminal-dim">FEES PAID</span>
        <span className="text-right text-terminal-red">
          ${fmt(metrics?.totalFees ?? 0, 4)}
        </span>
      </div>

      {(portfolio?.positions?.length ?? 0) > 0 && (
        <>
          <div className="text-terminal-dim text-xs tracking-widest uppercase border-t border-terminal-border pt-2">
            Open Positions
          </div>
          {portfolio!.positions.map((pos) => (
            <div key={pos.productId} className="grid grid-cols-2 gap-x-4 text-xs">
              <span className="text-terminal-blue">{pos.productId}</span>
              <span className="text-right text-terminal-text">${fmt(pos.notionalUsd)}</span>
              <span className="text-terminal-dim">avg entry</span>
              <span className="text-right text-terminal-dim">${fmt(pos.averageEntryPrice, 2)}</span>
              <span className="text-terminal-dim">exposure</span>
              <span className="text-right text-terminal-dim">{fmt(pos.exposurePct, 1)}%</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
