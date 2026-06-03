"use client";
import type { Status } from "../lib/api";

interface Props { status: Status | undefined; }

export default function RiskConfig({ status }: Props) {
  const risk = status?.risk;
  return (
    <div className="border border-terminal-border bg-terminal-surface px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <span className="text-terminal-dim tracking-widest uppercase w-full mb-1">Risk Limits</span>
      {risk ? (
        <>
          <Item label="MAX NOTIONAL" value={`$${risk.maxTradeNotionalUsd}`} />
          <Item label="MAX EXPOSURE" value={`${risk.maxTotalExposurePct}%`} />
          <Item label="MAX DAILY LOSS" value={`${risk.maxDailyLossPct}%`} />
          <Item label="PRODUCT LIMIT" value={`${risk.maxProductExposurePct}%`} />
          <Item label="SHORTS" value={risk.allowShorts ? "YES" : "NO"} warn={risk.allowShorts} />
          <Item label="LEVERAGE" value={risk.allowLeverage ? "YES" : "NO"} warn={risk.allowLeverage} />
          <Item label="ORDER PREVIEW" value={risk.requireOrderPreview ? "REQ'D" : "OFF"} />
        </>
      ) : (
        <span className="text-terminal-dim">LOADING...</span>
      )}
    </div>
  );
}

function Item({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-terminal-dim">{label}</span>
      <span className={warn ? "text-terminal-red font-semibold" : "text-terminal-text"}>{value}</span>
    </div>
  );
}
