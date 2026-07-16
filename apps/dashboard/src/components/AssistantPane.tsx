"use client";
/**
 * Slide-out educational assistant. Explains trades and concepts, grounded in
 * the account's real data via the API's read-only tool belt. It teaches; it
 * never trades, approves, or recommends investments. "Explain this" buttons
 * elsewhere open it pre-loaded with a trade's correlation id.
 */
import { useEffect, useRef, useState } from "react";
import { askAssistant, type Learner } from "../lib/api";

const LEARNERS: Learner[] = [
  { id: "jeremy", name: "Jeremy", level: "advanced" },
  { id: "hunter", name: "Hunter", level: "beginner" }
];
const LEARNER_KEY = "crypto-guy-learner";

interface ChatMessage {
  role: "learner" | "assistant";
  text: string;
  fallback?: boolean;
  error?: boolean;
}

export interface ExplainContext {
  correlationId: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Set by an "explain this" button; consumed once when the pane sends it. */
  context: ExplainContext | null;
  onContextConsumed: () => void;
}

export default function AssistantPane({ open, onClose, context, onContextConsumed }: Props) {
  const [learnerId, setLearnerId] = useState<string>(LEARNERS[0]!.id);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const learner = LEARNERS.find((l) => l.id === learnerId) ?? LEARNERS[0]!;

  useEffect(() => {
    const saved = window.localStorage.getItem(LEARNER_KEY);
    if (saved && LEARNERS.some((l) => l.id === saved)) setLearnerId(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LEARNER_KEY, learnerId);
  }, [learnerId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  // An explain-this click sends immediately with the trade context attached.
  useEffect(() => {
    if (open && context && !busy) {
      void send(`Explain this ${context.label} to me — why did it happen and what should I learn from it?`, context.correlationId);
      onContextConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, context]);

  async function send(question: string, correlationId?: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setMessages((prior) => [...prior, { role: "learner", text: trimmed }]);
    setInput("");
    setBusy(true);
    try {
      const result = await askAssistant(trimmed, learner, correlationId);
      setMessages((prior) => [...prior, { role: "assistant", text: result.answer, fallback: result.fallback }]);
    } catch {
      setMessages((prior) => [
        ...prior,
        { role: "assistant", text: "Could not reach the assistant — is the API running?", error: true }
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />}
      <aside
        aria-label="Educational assistant"
        className={`fixed top-0 right-0 h-full w-full sm:w-[28rem] z-50 border-l border-terminal-border bg-terminal-surface flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="border-b border-terminal-border px-4 py-2 flex items-center justify-between">
          <span className="text-terminal-dim text-xs tracking-widest uppercase">Ask the Assistant</span>
          <div className="flex items-center gap-2">
            <label htmlFor="learner-select" className="text-terminal-dim text-xs">
              LEARNER
            </label>
            <select
              id="learner-select"
              value={learnerId}
              onChange={(e) => setLearnerId(e.target.value)}
              className="bg-terminal-surface border border-terminal-border text-terminal-text text-xs px-2 py-1"
            >
              {LEARNERS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.level})
                </option>
              ))}
            </select>
            <button
              onClick={onClose}
              aria-label="Close assistant"
              className="px-2 py-1 border border-terminal-border text-terminal-dim text-xs hover:text-terminal-text"
            >
              ✕
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="text-terminal-dim text-xs leading-relaxed">
              <p className="mb-2">
                I explain what this system is doing and teach trading concepts using your actual trades. Try:
              </p>
              <ul className="list-disc pl-4 flex flex-col gap-1">
                <li>&ldquo;Why did our last trade lose money?&rdquo;</li>
                <li>&ldquo;What is MACD?&rdquo;</li>
                <li>&ldquo;How are we doing overall?&rdquo;</li>
                <li>Or click EXPLAIN on any trade or proposal.</li>
              </ul>
              <p className="mt-3 text-terminal-dim/70">
                I teach mechanics and history. I don&rsquo;t give investment advice or touch trading controls.
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`text-xs leading-relaxed whitespace-pre-wrap border px-3 py-2 ${
                message.role === "learner"
                  ? "border-terminal-blue/40 text-terminal-text self-end max-w-[90%]"
                  : message.error
                    ? "border-terminal-red text-terminal-red self-start max-w-full"
                    : "border-terminal-border text-terminal-text self-start max-w-full"
              }`}
            >
              {message.fallback && (
                <div className="text-terminal-dim text-[10px] tracking-widest uppercase mb-1">data-only mode</div>
              )}
              {message.text}
            </div>
          ))}
          {busy && (
            <div className="text-terminal-dim text-xs">
              thinking<span className="blink ml-1">▌</span>
            </div>
          )}
        </div>

        <form
          className="border-t border-terminal-border p-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask as ${learner.name}…`}
            aria-label="Ask the assistant"
            className="flex-1 bg-terminal-surface border border-terminal-border text-terminal-text text-xs px-3 py-2 placeholder:text-terminal-dim focus:outline-none focus:border-terminal-blue"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="px-3 py-2 border border-terminal-blue text-terminal-blue text-xs font-bold tracking-wider hover:bg-terminal-blue/10 disabled:opacity-50"
          >
            ASK
          </button>
        </form>
      </aside>
    </>
  );
}
