"use client";
import type { Status } from "../lib/api";

interface Props { status: Status | undefined; lastUpdated: Date | null; }

export default function Header({ status, lastUpdated }: Props) {
  const mode = status?.mode?.toUpperCase() ?? "—";
  const isLive = mode === "LIVE";
  const isPaper = mode === "PAPER";

  return (
    <header className="border-b border-terminal-border px-4 py-2 flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-4">
        <span className="text-terminal-orange font-semibold tracking-widest text-sm uppercase">
          Crypto Guy
        </span>
        <span className="text-terminal-dim text-xs">Autonomous Crypto Trader</span>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <span className={`px-2 py-0.5 border font-semibold tracking-wider ${
          isLive
            ? "border-terminal-red text-terminal-red"
            : isPaper
            ? "border-terminal-green text-terminal-green"
            : "border-terminal-muted text-terminal-dim"
        }`}>
          {mode}
        </span>

        {status?.killSwitchEnabled && (
          <span className="px-2 py-0.5 bg-terminal-red text-black font-bold tracking-wider">
            ⚠ KILL SWITCH
          </span>
        )}
        {status?.paused && (
          <span className="px-2 py-0.5 border border-terminal-yellow text-terminal-yellow tracking-wider">
            ⏸ PAUSED
          </span>
        )}

        <span className="text-terminal-dim hidden sm:block">
          {lastUpdated
            ? `UPDATED ${lastUpdated.toLocaleTimeString("en-US", { hour12: false })}`
            : "CONNECTING..."}
        </span>
      </div>
    </header>
  );
}
