"use client";
/**
 * Small "explain this" affordance placed on trades and proposals. Clicking it
 * opens the assistant pane pre-loaded with the item's correlation id — the
 * learner clicks the confusing thing instead of formulating a question.
 */
interface Props {
  correlationId: string;
  label: string;
  onExplain: (correlationId: string, label: string) => void;
}

export default function ExplainButton({ correlationId, label, onExplain }: Props) {
  return (
    <button
      onClick={() => onExplain(correlationId, label)}
      title="Ask the assistant to explain this"
      className="px-2 py-0.5 border border-terminal-blue/50 text-terminal-blue text-[10px] font-bold tracking-wider hover:bg-terminal-blue/10"
    >
      EXPLAIN
    </button>
  );
}
