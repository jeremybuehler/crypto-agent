"use client";
import { useState } from "react";
import type { Status } from "../lib/api";
import { postOps } from "../lib/api";

interface Props {
  status: Status | undefined;
  onMutate: () => void;
}

export default function OpsPanel({ status, onMutate }: Props) {
  const [loading, setLoading] = useState<string | null>(null);

  async function act(path: string, label: string) {
    setLoading(label);
    try { await postOps(path); onMutate(); }
    catch (e) { console.error(e); }
    finally { setLoading(null); }
  }

  const paused = status?.paused ?? false;
  const killSwitch = status?.killSwitchEnabled ?? false;
  const isLive = status?.mode === "live";

  const mode = status?.mode?.toUpperCase() ?? "—";
  const modeColor = isLive ? "text-terminal-red border-terminal-red" : "text-terminal-blue border-terminal-blue";

  return (
    // self-start so the card sizes to its content instead of stretching to match
    // the taller Portfolio / Last-Trade cards in the same grid row.
    <div className="border border-terminal-border bg-terminal-surface p-4 flex flex-col gap-3 self-start">
      <div className="text-terminal-dim text-xs tracking-widest uppercase border-b border-terminal-border pb-2 flex items-center justify-between">
        <span>Ops Control</span>
        <span className={`px-1.5 py-0.5 border text-[10px] tracking-wider ${modeColor}`}>{mode}</span>
      </div>

      <div className="flex flex-col gap-2">
        {/* Pause / Resume */}
        <button
          onClick={() => act(paused ? "/ops/resume" : "/ops/pause", "pause")}
          disabled={loading !== null}
          className={`w-full py-2 px-3 text-xs font-semibold tracking-wider border transition-colors ${
            paused
              ? "border-terminal-green text-terminal-green hover:bg-terminal-green hover:text-black"
              : "border-terminal-yellow text-terminal-yellow hover:bg-terminal-yellow hover:text-black"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {loading === "pause" ? "..." : paused ? "▶ RESUME TRADING" : "⏸ PAUSE TRADING"}
        </button>

        {/* Kill Switch */}
        {!killSwitch ? (
          <button
            onClick={() => act("/ops/kill-switch", "kill")}
            disabled={loading !== null}
            className="w-full py-2 px-3 text-xs font-semibold tracking-wider border border-terminal-red text-terminal-red hover:bg-terminal-red hover:text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading === "kill" ? "..." : "⚠ ENABLE KILL SWITCH"}
          </button>
        ) : (
          <button
            onClick={() => !isLive && act("/ops/clear-kill-switch", "clear")}
            disabled={loading !== null || isLive}
            className="w-full py-2 px-3 text-xs font-semibold tracking-wider bg-terminal-red text-black hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLive ? "⚠ KILL SWITCH ACTIVE (live — clear manually)" : loading === "clear" ? "..." : "✕ CLEAR KILL SWITCH"}
          </button>
        )}
      </div>

      <div className="text-terminal-dim text-xs mt-1 flex flex-col gap-1">
        <div className="flex justify-between">
          <span>PRODUCTS</span>
          <span className="text-terminal-text">{status?.enabledProducts?.join(", ") ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span>STATUS</span>
          <span className={killSwitch ? "text-terminal-red" : paused ? "text-terminal-yellow" : "text-terminal-green"}>
            {killSwitch ? "HALTED" : paused ? "PAUSED" : "RUNNING"}
          </span>
        </div>
      </div>
    </div>
  );
}
