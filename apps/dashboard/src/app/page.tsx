"use client";
import useSWR from "swr";
import { fetcher, type Status, type Portfolio, type TradeList, type Metrics, type ProposalList } from "../lib/api";
import Header from "../components/Header";
import PortfolioPanel from "../components/PortfolioPanel";
import LastTradePanel from "../components/LastTradePanel";
import OpsPanel from "../components/OpsPanel";
import ProposalsPanel from "../components/ProposalsPanel";
import TradeFeed from "../components/TradeFeed";
import RiskConfig from "../components/RiskConfig";
import { useState, useEffect } from "react";

const POLL = 3000;

export default function Dashboard() {
  const { data: status, mutate: mutateStatus } = useSWR<Status>("/api/status", fetcher, { refreshInterval: POLL });
  const { data: portfolio } = useSWR<Portfolio>("/api/portfolio", fetcher, { refreshInterval: POLL });
  const { data: tradeList } = useSWR<TradeList>("/api/trades", fetcher, { refreshInterval: POLL });
  const { data: metrics } = useSWR<Metrics>("/api/metrics", fetcher, { refreshInterval: POLL });
  const { data: proposalList, mutate: mutateProposals } = useSWR<ProposalList>("/api/proposals", fetcher, {
    refreshInterval: POLL
  });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => { if (status) setLastUpdated(new Date()); }, [status]);

  const trades = tradeList?.trades ?? [];
  const lastTrade = trades[0];

  return (
    <div className="min-h-screen flex flex-col">
      <Header status={status} lastUpdated={lastUpdated} />

      <main className="flex-1 p-3 sm:p-4 flex flex-col gap-3">
        {/* Top row: 3 panels */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <PortfolioPanel portfolio={portfolio} metrics={metrics} />
          <LastTradePanel trade={lastTrade} />
          <OpsPanel status={status} onMutate={() => mutateStatus()} />
        </div>

        {/* Pending approvals */}
        <ProposalsPanel proposals={proposalList?.proposals ?? []} onDecision={() => mutateProposals()} />

        {/* Trade feed */}
        <TradeFeed trades={trades} />

        {/* Risk config */}
        <RiskConfig status={status} />
      </main>

      <footer className="border-t border-terminal-border px-4 py-2 text-terminal-dim text-xs flex justify-between">
        <span>Crypto Guy v0.1 · PAPER MODE</span>
        <span>POLLS EVERY 3S</span>
      </footer>
    </div>
  );
}
