import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { respondToPendingAction, sendAssistantMessage, type PendingActionSummary } from "../../lib/assistantApi";
import { loadLatestConversation, type ChatMessage } from "../../lib/conversationApi";
import { consumeAssistantPrefill } from "../../hooks/assistantPrefill";
import { haptic } from "../../telegram";

export function AssistantScreen({ db }: { db: SupabaseClient }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingActionSummary | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  // Read once on mount: e.g. "Ask the assistant" from cooking mode hands off a starter question.
  const [input, setInput] = useState(consumeAssistantPrefill);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLatestConversation(db)
      .then(({ conversationId, messages, pendingActionId }) => {
        setConversationId(conversationId ?? undefined);
        setMessages(messages);
        if (pendingActionId && messages.length > 0) {
          // The prompt text is already the last message shown; we just need the id to act on.
          setPending({ id: pendingActionId, prompt: messages[messages.length - 1].text });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your conversation."))
      .finally(() => setLoading(false));
  }, [db]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    setMessages((prev) => [...prev, { id: `local-${Date.now()}`, role: "user", text }]);
    setSending(true);
    try {
      const result = await sendAssistantMessage(text, conversationId);
      setConversationId(result.conversationId);
      setMessages((prev) => [...prev, { id: `local-${Date.now()}-a`, role: "assistant", text: result.reply }]);
      setPending(result.pendingAction ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the assistant.");
    } finally {
      setSending(false);
    }
  }

  async function respond(action: "confirm" | "cancel") {
    if (!pending) return;
    const id = pending.id;
    setPending(null);
    haptic(action === "confirm" ? "success" : "tap");
    try {
      const outcome = await respondToPendingAction(id, action);
      setMessages((prev) => [...prev, { id: `local-${Date.now()}-c`, role: "assistant", text: outcome.message }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the assistant.");
    }
  }

  return (
    <div className="screen assistant-screen">
      <h1>Assistant</h1>
      {error && <p className="error">{error}</p>}

      <div className="chat-log">
        {loading && <p className="muted">Loading…</p>}
        {!loading && messages.length === 0 && (
          <p className="muted">Ask for recipe ideas, or tell it what you'd like to cook.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "bubble user" : "bubble assistant"}>
            {m.text}
          </div>
        ))}
        {sending && <div className="bubble assistant muted">…</div>}
        {pending && (
          // The proposal's text is already the assistant bubble just above; this only adds
          // the actions, so the same sentence isn't shown twice.
          <div className="confirm-card">
            <div className="confirm-card-actions">
              <button className="button secondary compact" onClick={() => respond("cancel")}>
                Cancel
              </button>
              <button className="button compact" onClick={() => respond("confirm")}>
                Confirm
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="add-item-row chat-input-row">
        <input
          placeholder="Message the assistant…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button type="button" className="button compact" disabled={sending} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
