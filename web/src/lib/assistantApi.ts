import { getAccessToken } from "../api";

export interface PendingActionSummary {
  id: string;
  prompt: string;
}

export interface AssistantTurnResponse {
  conversationId: string;
  reply: string;
  pendingAction?: PendingActionSummary;
}

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json();
}

export function sendAssistantMessage(message: string, conversationId?: string): Promise<AssistantTurnResponse> {
  return callApi("/api/assistant/message", { message, conversationId });
}

export interface ConfirmOutcome {
  status: string;
  message: string;
}

export function respondToPendingAction(pendingActionId: string, action: "confirm" | "cancel"): Promise<ConfirmOutcome> {
  return callApi("/api/assistant/confirm", { pendingActionId, action });
}
