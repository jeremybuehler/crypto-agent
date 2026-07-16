"use client";
import useSWR from "swr";
import { fetcher, type Status, type Portfolio, type TradeList, type Metrics, type ProposalList, type CandlesResponse } from "../lib/api";
import Header from "../components/Header";
import PortfolioPanel from "../components/PortfolioPanel";
import LastTradePanel from "../components/LastTradePanel";
import OpsPanel from "../components/OpsPanel";
import ProposalsPanel from "../components/ProposalsPanel";
import CandleChart from "../components/CandleChart";
import TradeFeed from "../components/TradeFeed";
import RiskConfig from "../components/RiskConfig";
import AssistantPane, { type ExplainContext } from "../components/AssistantPane";
import { useState, useEffect, useCallback } from "react";

const POLL = 3000;

export default function Dashboard() {
  const { data: status, mutate: mutateStatus } = useSWR<Status>("/api/status", fetcher, { refreshInterval: POLL });
  const { data: portfolio } = useSWR<Portfolio>("/api/portfolio", fetcher, { refreshInterval: POLL });
  const { data: tradeList } = useSWR<TradeList>("/api/trades", fetcher, { refreshInterval: POLL });
  const { data: metrics } = useSWR<Metrics>("/api/metrics", fetcher, { refreshInterval: POLL });
  const { data: proposalList, mutate: mutateProposals } = useSWR<ProposalList>("/api/proposals", fetcher, {
    refreshInterval: POLL
  });
  const { data: candleData } = useSWR<CandlesResponse>("/api/candles?bucket=20&limit=60", fetcher, {
    refreshInterval: POLL
  });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => { if (status) setLastUpdated(new Date()); }, [status]);

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [explainContext, setExplainContext] = useState<ExplainContext | null>(null);

  const explain = useCallback((correlationId: string, label: string) => {
    setExplainContext({ correlationId, label });
    setAssistantOpen(true);
  }, []);

  const trades = tradeList?.trades ?? [];
  const lastTrade = trades[0];

  return (
    <div className="min-h-screen flex flex-col">
      <Header status={status} lastUpdated={lastUpdated} />

      <main className="flex-1 p-3 sm:p-4 flex flex-col gap-3">
        {/* Top row: 3 panels */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <PortfolioPanel portfolio={portfolio} metrics={metrics} />
          <LastTradePanel trade={lastTrade} onExplain={explain} />
          <OpsPanel status={status} onMutate={() => mutateStatus()} />
        </div>

        {/* Price chart with trade markers */}
        <CandleChart
          candles={candleData?.candles ?? []}
          trades={trades}
          productId={candleData?.productId ?? "BTC-USD"}
          bucketSeconds={candleData?.bucketSeconds ?? 20}
        />

        {/* Pending approvals */}
        <ProposalsPanel proposals={proposalList?.proposals ?? []} onDecision={() => mutateProposals()} onExplain={explain} />

        {/* Trade feed */}
        <TradeFeed trades={trades} onExplain={explain} />

        {/* Risk config */}
        <RiskConfig status={status} />
      </main>

      <footer className="border-t border-terminal-border px-4 py-2 text-terminal-dim text-xs flex justify-between">
        <span>Crypto Guy v0.1 · PAPER MODE</span>
        <span>POLLS EVERY 3S</span>
      </footer>

      {/* Floating launcher for the educational assistant */}
      {!assistantOpen && (
        <button
          onClick={() => setAssistantOpen(true)}
          className="fixed bottom-4 right-4 z-30 px-4 py-2 border border-terminal-blue bg-terminal-surface text-terminal-blue text-xs font-bold tracking-wider hover:bg-terminal-blue/10 shadow-lg"
        >
          ASK ⌵
        </button>
      )}

      <AssistantPane
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        context={explainContext}
        onContextConsumed={() => setExplainContext(null)}
      />
    </div>
  );
}
